import { DEFAULT_CONFIG } from './config.js';
import type { GameConfig } from './config.js';
import {
  BOULDER_MAZE_MAP,
} from './mapData.js';
import type { MazeMap } from './map.js';
import {
  isWalkable,
  playerSpawns,
  PELLET,
  SUPER_PELLET,
  tileIndex,
} from './map.js';
import { seedRng } from './rng.js';
import type { Direction, TilePos, Vec } from './types.js';
import { DIRECTIONS, DIR_VECTORS, OPPOSITE } from './types.js';
import { validateMap } from './validate.js';

export type GamePhase = 'ready' | 'playing' | 'won' | 'lost';
export type BoulderStatus = 'pending' | 'active' | 'destroyed';
export type PelletKind = 'normal' | 'super';

/**
 * Entity positions are integer sub-tile units: `unitsPerTile` (60) units per
 * tile, so a tile centre sits at `tile * T + T/2`. Speeds divide T evenly,
 * meaning every entity always lands exactly on tile centres and boundaries —
 * no floating point anywhere in the simulation.
 */
export interface PlayerState {
  id: string;
  pos: Vec;
  dir: Direction | null;
  /** Most recent desired direction; consumed at the next legal tile centre. */
  bufferedDir: Direction | null;
  score: number;
  /** Remaining drill ticks; 0 = unpowered. */
  powerTicks: number;
  lastCommandSeq: number;
}

export interface BoulderState {
  id: string;
  chuteId: string;
  pos: Vec;
  dir: Direction | null;
  /** pending = waiting in the chute; destroyed = inside the respawn delay. */
  status: BoulderStatus;
  respawnTicksRemaining: number;
  /** Tick at which a pending boulder may activate. */
  releaseAtTick: number;
  warningShown: boolean;
}

export interface GameState {
  mapId: string;
  mapVersion: number;
  tick: number;
  phase: GamePhase;
  readyUntilTick: number;
  config: GameConfig;
  map: MazeMap;
  players: Record<string, PlayerState>;
  boulders: Record<string, BoulderState>;
  /** Remaining pellets keyed by tile index (y * width + x). */
  pellets: Record<number, PelletKind>;
  pelletsRemaining: number;
  nextEventSeq: number;
  rngState: number;
}

export interface PlayerCommand {
  readonly playerId: string;
  readonly direction: Direction;
  /** Per-player monotonically increasing sequence number. */
  readonly seq: number;
  /** The tick this command applies to; must equal state.tick + 1. */
  readonly tick: number;
}

export type GameEvent =
  | { seq: number; tick: number; type: 'gameStarted' }
  | { seq: number; tick: number; type: 'pelletCollected'; playerId: string; tile: number; score: number }
  | { seq: number; tick: number; type: 'superPelletCollected'; playerId: string; tile: number }
  | { seq: number; tick: number; type: 'powerStarted'; playerId: string }
  | { seq: number; tick: number; type: 'powerEnded'; playerId: string }
  | { seq: number; tick: number; type: 'boulderDestroyed'; boulderId: string; playerId: string }
  | { seq: number; tick: number; type: 'chuteWarning'; boulderId: string; chuteId: string }
  | { seq: number; tick: number; type: 'boulderReleased'; boulderId: string; chuteId: string }
  | { seq: number; tick: number; type: 'playerDefeated'; playerId: string; boulderId: string }
  | { seq: number; tick: number; type: 'gameWon'; playerId: string }
  | { seq: number; tick: number; type: 'commandRejected'; playerId: string; commandSeq: number; reason: string };

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
type EventInput = DistributiveOmit<GameEvent, 'seq' | 'tick'>;
type Emit = (e: EventInput) => void;

// ---------------------------------------------------------------------------
// construction
// ---------------------------------------------------------------------------

export const LOCAL_PLAYER_ID = 'player-1';

export function createGame(
  config: GameConfig = DEFAULT_CONFIG,
  map: MazeMap = BOULDER_MAZE_MAP,
  seed = 1,
): GameState {
  const validation = validateMap(map);
  if (!validation.ok) {
    const detail = validation.issues.map((i) => `${i.code}: ${i.message}`).join('\n');
    throw new Error(`invalid map '${map.id}':\n${detail}`);
  }
  if (map.chutes.length === 0) throw new Error(`map '${map.id}' defines no boulder chutes`);

  const spawn = playerSpawns(map)[0]!;
  const players: Record<string, PlayerState> = {
    [LOCAL_PLAYER_ID]: {
      id: LOCAL_PLAYER_ID,
      pos: tileCenter(spawn, config),
      dir: null,
      bufferedDir: null,
      score: 0,
      powerTicks: 0,
      lastCommandSeq: 0,
    },
  };

  const readyUntilTick = config.readyTicks;
  const boulders: Record<string, BoulderState> = {};
  map.chutes.forEach((chute, i) => {
    const id = `boulder-${i + 1}`;
    boulders[id] = {
      id,
      chuteId: chute.id,
      pos: tileCenter(chute.entry, config),
      dir: null,
      status: 'pending',
      respawnTicksRemaining: 0,
      releaseAtTick: readyUntilTick + i * config.releaseGapTicks,
      warningShown: false,
    };
  });

  const pellets: Record<number, PelletKind> = {};
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const ch = map.rows[y]!.charAt(x);
      if (ch === PELLET) pellets[y * map.width + x] = 'normal';
      else if (ch === SUPER_PELLET) pellets[y * map.width + x] = 'super';
    }
  }

  return {
    mapId: map.id,
    mapVersion: map.version,
    tick: 0,
    phase: 'ready',
    readyUntilTick,
    config,
    map,
    players,
    boulders,
    pellets,
    pelletsRemaining: Object.keys(pellets).length,
    nextEventSeq: 1,
    rngState: seedRng(seed),
  };
}

// ---------------------------------------------------------------------------
// tick pipeline
//
// Deterministic order inside stepGame:
//   1. tick advances; due commands are applied in (tick, playerId, seq) order,
//      stale/duplicate/future commands are rejected with an event
//   2. 'ready' phase counts down into 'playing'
//   3. entity movement (players by id, then boulders by id)
//   4. pickups / Super Pellet activation
//   5. boulder contact resolution (swept-segment check)
//   6. terminal outcome (a simultaneous fatal contact beats the final pellet)
//   7. timers: power countdown, respawn delays, chute warnings/releases
// ---------------------------------------------------------------------------

export function stepGame(state: GameState, commands: readonly PlayerCommand[]): GameEvent[] {
  // Terminal states are frozen: the simulation has stopped.
  if (state.phase === 'won' || state.phase === 'lost') return [];

  const events: GameEvent[] = [];
  const emit: Emit = (e) => {
    events.push({ ...e, seq: state.nextEventSeq++, tick: state.tick } as GameEvent);
  };
  const cfg = state.config;

  state.tick += 1;

  // 1. commands
  const sorted = [...commands].sort(
    (a, b) => a.tick - b.tick || a.playerId.localeCompare(b.playerId) || a.seq - b.seq,
  );
  for (const cmd of sorted) {
    const player = state.players[cmd.playerId];
    if (!player) {
      emit({ type: 'commandRejected', playerId: cmd.playerId, commandSeq: cmd.seq, reason: 'unknown-player' });
      continue;
    }
    if (cmd.tick < state.tick) {
      emit({ type: 'commandRejected', playerId: cmd.playerId, commandSeq: cmd.seq, reason: 'late' });
      continue;
    }
    if (cmd.tick > state.tick) {
      emit({ type: 'commandRejected', playerId: cmd.playerId, commandSeq: cmd.seq, reason: 'future' });
      continue;
    }
    if (cmd.seq <= player.lastCommandSeq) {
      emit({ type: 'commandRejected', playerId: cmd.playerId, commandSeq: cmd.seq, reason: 'duplicate' });
      continue;
    }
    player.bufferedDir = cmd.direction;
    player.lastCommandSeq = cmd.seq;
  }

  // 2. ready countdown
  if (state.phase === 'ready') {
    if (state.tick >= state.readyUntilTick) {
      state.phase = 'playing';
      emit({ type: 'gameStarted' });
      updatePendingBoulders(state, emit);
      return events; // no movement on the transition tick
    }
    updatePendingBoulders(state, emit);
    return events;
  }
  if (state.phase !== 'playing') return events;

  // 3. movement — capture pre-move positions for swept contact checks
  const prevPos = new Map<string, Vec>();
  for (const id of sortedPlayerIds(state)) prevPos.set(id, state.players[id]!.pos);
  for (const id of sortedBoulderIds(state)) prevPos.set(id, state.boulders[id]!.pos);

  const playerTile = primaryPlayerTile(state);
  const distField = bfsDistances(state.map, playerTile);
  const powered = Object.values(state.players).some((p) => p.powerTicks > 0);
  const bends = new Map<string, Vec | null>();
  for (const id of sortedPlayerIds(state)) {
    bends.set(id, movePlayer(state, state.players[id]!));
  }
  for (const id of sortedBoulderIds(state)) {
    const boulder = state.boulders[id]!;
    if (boulder.status === 'active') bends.set(id, moveBoulder(state, boulder, distField, powered));
  }

  // 4. pickups (Super Pellet activates before contact resolution)
  const powerStartedThisTick = new Set<string>();
  for (const id of sortedPlayerIds(state)) {
    const player = state.players[id]!;
    const idx = tileIndex(state.map, posToTile(player.pos, cfg));
    const kind = state.pellets[idx];
    if (!kind) continue;
    delete state.pellets[idx];
    state.pelletsRemaining -= 1;
    if (kind === 'super') {
      player.score += cfg.superPelletScore;
      player.powerTicks = cfg.powerTicks; // resets, does not add
      powerStartedThisTick.add(id);
      emit({ type: 'superPelletCollected', playerId: id, tile: idx });
      emit({ type: 'powerStarted', playerId: id });
    } else {
      player.score += cfg.normalPelletScore;
      emit({ type: 'pelletCollected', playerId: id, tile: idx, score: player.score });
    }
  }

  // 5. contact resolution — swept segments catch mid-tick crossings
  let defeated = false;
  for (const pid of sortedPlayerIds(state)) {
    const player = state.players[pid]!;
    const p0 = prevPos.get(pid)!;
    for (const bid of sortedBoulderIds(state)) {
      const boulder = state.boulders[bid]!;
      if (boulder.status !== 'active') continue;
      const b0 = prevPos.get(bid)!;
      const d = pathMinDistance(
        p0,
        player.pos,
        bends.get(pid) ?? null,
        b0,
        boulder.pos,
        bends.get(bid) ?? null,
      );
      if (d > cfg.contactRadius) continue;
      if (player.powerTicks > 0) {
        boulder.status = 'destroyed';
        boulder.dir = null;
        boulder.respawnTicksRemaining = cfg.respawnTicks;
        player.score += cfg.boulderScore;
        emit({ type: 'boulderDestroyed', boulderId: bid, playerId: pid });
      } else {
        state.phase = 'lost';
        emit({ type: 'playerDefeated', playerId: pid, boulderId: bid });
        defeated = true;
        break;
      }
    }
    if (defeated) break;
  }
  if (defeated) return events;

  // 6. terminal win check — fatal contact above already took precedence
  if (state.pelletsRemaining === 0) {
    state.phase = 'won';
    emit({ type: 'gameWon', playerId: sortedPlayerIds(state)[0]! });
    return events;
  }

  // 7. timers
  for (const id of sortedPlayerIds(state)) {
    const player = state.players[id]!;
    // the collection tick itself does not consume power duration
    if (player.powerTicks > 0 && !powerStartedThisTick.has(id)) {
      player.powerTicks -= 1;
      if (player.powerTicks === 0) emit({ type: 'powerEnded', playerId: id });
    }
  }
  for (const id of sortedBoulderIds(state)) {
    const boulder = state.boulders[id]!;
    if (boulder.status === 'destroyed') {
      boulder.respawnTicksRemaining -= 1;
      if (boulder.respawnTicksRemaining <= 0) {
        boulder.status = 'pending';
        // warning window before the boulder may re-enter through its chute
        boulder.releaseAtTick = state.tick + cfg.chuteWarnTicks;
        boulder.warningShown = false;
      }
    }
  }
  updatePendingBoulders(state, emit);

  return events;
}

// ---------------------------------------------------------------------------
// serialization — the whole state is plain JSON data
// ---------------------------------------------------------------------------

export function serializeGame(state: GameState): string {
  return JSON.stringify(state);
}

export function deserializeGame(json: string | unknown): GameState {
  const parsed = typeof json === 'string' ? (JSON.parse(json) as GameState) : (json as GameState);
  if (typeof parsed.tick !== 'number' || !parsed.players || !parsed.boulders || !parsed.map) {
    throw new Error('deserializeGame: malformed state');
  }
  return parsed;
}

/** Detached copy for renderers — they must never mutate authoritative state. */
export function snapshotState(state: GameState): GameState {
  return deserializeGame(serializeGame(state));
}

// ---------------------------------------------------------------------------
// movement
// ---------------------------------------------------------------------------

function tileCenter(tile: TilePos, cfg: GameConfig): Vec {
  const T = cfg.unitsPerTile;
  return { x: tile.x * T + T / 2, y: tile.y * T + T / 2 };
}

function atTileCenter(pos: Vec, cfg: GameConfig): boolean {
  const T = cfg.unitsPerTile;
  return pos.x % T === T / 2 && pos.y % T === T / 2;
}

export function posToTile(pos: Vec, cfg: GameConfig = DEFAULT_CONFIG): TilePos {
  const T = cfg.unitsPerTile;
  return { x: Math.floor(pos.x / T), y: Math.floor(pos.y / T) };
}

function nextTile(tile: TilePos, dir: Direction): TilePos {
  const v = DIR_VECTORS[dir];
  return { x: tile.x + v.x, y: tile.y + v.y };
}

interface MoveResult {
  pos: Vec;
  dir: Direction | null;
  /**
   * The tile center where the entity turned mid-tick, if it did. The tick's
   * path is then the polyline prev → bend → pos; null means a straight path.
   */
  bend: Vec | null;
}

/** Units from `axis` to the next tile center in `sign`'s direction, in (0, T]. */
function distToCenter(axis: number, sign: 1 | -1, T: number): number {
  const rel = (((axis - T / 2) % T) + T) % T; // units past the previous center
  const d = sign === 1 ? (T - rel) % T : rel;
  return d === 0 ? T : d;
}

/**
 * Move an entity up to `speed` units. Direction decisions are made at every
 * tile center the entity *crosses*, not only when it lands exactly on one —
 * so an entity knocked off center alignment (e.g. a mid-edge speed change
 * when drill power starts or ends) re-aligns at the next center instead of
 * sliding straight through walls forever. `decide` runs at each center and
 * returns the direction to take (null = stop). Speeds are always < T, so at
 * most two decisions can happen in a tick and a single `bend` is enough.
 */
function advanceAlongMaze(
  pos: Vec,
  dir: Direction | null,
  speed: number,
  cfg: GameConfig,
  decide: (tile: TilePos, dir: Direction | null) => Direction | null,
): MoveResult {
  const p = { ...pos };
  let d = dir;
  let bend: Vec | null = null;
  let budget = speed;
  while (budget > 0) {
    if (atTileCenter(p, cfg)) {
      const next = decide(posToTile(p, cfg), d);
      if (next !== d && bend === null && (p.x !== pos.x || p.y !== pos.y)) bend = { ...p };
      d = next;
      if (!d) break;
    }
    if (!d) break; // stopped entities only ever rest at centers
    const v = DIR_VECTORS[d];
    const axis = v.x !== 0 ? p.x : p.y;
    const sign = (v.x !== 0 ? v.x : v.y) as 1 | -1;
    const step = Math.min(budget, distToCenter(axis, sign, cfg.unitsPerTile));
    p.x += v.x * step;
    p.y += v.y * step;
    budget -= step;
  }
  return { pos: p, dir: d, bend };
}

function movePlayer(state: GameState, player: PlayerState): Vec | null {
  const cfg = state.config;
  const map = state.map;

  // Immediate reversal anywhere along the corridor.
  if (player.dir && player.bufferedDir === OPPOSITE[player.dir]) {
    player.dir = player.bufferedDir;
    player.bufferedDir = null;
  }

  const result = advanceAlongMaze(player.pos, player.dir, cfg.playerSpeed, cfg, (tile, cur) => {
    if (player.bufferedDir && isWalkable(map, nextTile(tile, player.bufferedDir))) {
      const chosen = player.bufferedDir;
      player.bufferedDir = null;
      return chosen;
    }
    if (cur && isWalkable(map, nextTile(tile, cur))) return cur;
    return null;
  });
  player.pos = result.pos;
  player.dir = result.dir;
  return result.bend;
}

/** Chase: pick the legal neighbour with the smallest BFS distance to the player. */
function moveBoulder(
  state: GameState,
  boulder: BoulderState,
  distField: ReadonlyMap<number, number>,
  powered: boolean,
): Vec | null {
  const cfg = state.config;
  const map = state.map;

  const speed = powered ? cfg.poweredBoulderSpeed : cfg.boulderSpeed;
  const result = advanceAlongMaze(boulder.pos, boulder.dir, speed, cfg, (tile, cur) => {
    let options = DIRECTIONS.filter((d) => isWalkable(map, nextTile(tile, d)));
    // never reverse while chasing; while fleeing, all legal routes count
    if (!powered) {
      const forward = options.filter((d) => !cur || d !== OPPOSITE[cur]);
      if (forward.length > 0) options = forward;
    }

    // deterministic tie-break: direction order rotated by boulder index
    const rotation = Number.parseInt(boulder.id.split('-')[1] ?? '0', 10);
    const ranked = [...options].sort((a, b) => {
      const da = distField.get(tileIndex(map, nextTile(tile, a))) ?? Number.MAX_SAFE_INTEGER;
      const db = distField.get(tileIndex(map, nextTile(tile, b))) ?? Number.MAX_SAFE_INTEGER;
      if (da !== db) return powered ? db - da : da - db;
      return orderIndex(a, rotation) - orderIndex(b, rotation);
    });
    return ranked[0] ?? null;
  });
  boulder.pos = result.pos;
  boulder.dir = result.dir;
  return result.bend;
}

function orderIndex(dir: Direction, rotation: number): number {
  const i = DIRECTIONS.indexOf(dir);
  return (i - rotation + DIRECTIONS.length) % DIRECTIONS.length;
}

// ---------------------------------------------------------------------------
// chutes: warnings, safety, release
// ---------------------------------------------------------------------------

function updatePendingBoulders(state: GameState, emit: Emit): void {
  const cfg = state.config;
  for (const id of sortedBoulderIds(state)) {
    const boulder = state.boulders[id]!;
    if (boulder.status !== 'pending') continue;
    if (!boulder.warningShown && state.tick >= boulder.releaseAtTick - cfg.chuteWarnTicks) {
      boulder.warningShown = true;
      emit({ type: 'chuteWarning', boulderId: id, chuteId: boulder.chuteId });
    }
    if (state.tick >= boulder.releaseAtTick && chuteAreaClear(state, boulder.chuteId)) {
      const chute = state.map.chutes.find((c) => c.id === boulder.chuteId)!;
      boulder.status = 'active';
      boulder.pos = tileCenter(chute.entry, cfg);
      boulder.dir = chute.inward;
      emit({ type: 'boulderReleased', boulderId: id, chuteId: boulder.chuteId });
    }
  }
}

/**
 * A boulder may not materialise while a player or an active boulder overlaps
 * the entry tile or any of its orthogonal neighbours.
 */
function chuteAreaClear(state: GameState, chuteId: string): boolean {
  const chute = state.map.chutes.find((c) => c.id === chuteId)!;
  const zone = new Set<number>();
  zone.add(tileIndex(state.map, chute.entry));
  for (const v of Object.values(DIR_VECTORS)) {
    const t = { x: chute.entry.x + v.x, y: chute.entry.y + v.y };
    if (isWalkable(state.map, t)) zone.add(tileIndex(state.map, t));
  }
  for (const player of Object.values(state.players)) {
    if (zone.has(tileIndex(state.map, posToTile(player.pos, state.config)))) return false;
  }
  for (const other of Object.values(state.boulders)) {
    if (other.status !== 'active') continue;
    if (zone.has(tileIndex(state.map, posToTile(other.pos, state.config)))) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function sortedPlayerIds(state: GameState): string[] {
  return Object.keys(state.players).sort();
}

function sortedBoulderIds(state: GameState): string[] {
  return Object.keys(state.boulders).sort();
}

function primaryPlayerTile(state: GameState): TilePos {
  const first = state.players[sortedPlayerIds(state)[0]!]!;
  return posToTile(first.pos, state.config);
}

/** BFS distances from `start` over the walkable-tile graph (tile indices). */
function bfsDistances(map: MazeMap, start: TilePos): Map<number, number> {
  const dist = new Map<number, number>();
  const startIdx = tileIndex(map, start);
  if (!isWalkable(map, start)) return dist;
  dist.set(startIdx, 0);
  const queue: TilePos[] = [start];
  for (let i = 0; i < queue.length; i++) {
    const t = queue[i]!;
    const d = dist.get(tileIndex(map, t))!;
    for (const v of Object.values(DIR_VECTORS)) {
      const n = { x: t.x + v.x, y: t.y + v.y };
      const ni = tileIndex(map, n);
      if (isWalkable(map, n) && !dist.has(ni)) {
        dist.set(ni, d + 1);
        queue.push(n);
      }
    }
  }
  return dist;
}

/**
 * Minimum distance between two entities' tick paths. Each path is one
 * segment, or two when the entity turned at a crossed center (`bend`).
 */
function pathMinDistance(
  a0: Vec,
  a1: Vec,
  aBend: Vec | null,
  b0: Vec,
  b1: Vec,
  bBend: Vec | null,
): number {
  const segsA: [Vec, Vec][] = aBend ? [[a0, aBend], [aBend, a1]] : [[a0, a1]];
  const segsB: [Vec, Vec][] = bBend ? [[b0, bBend], [bBend, b1]] : [[b0, b1]];
  let min = Number.POSITIVE_INFINITY;
  for (const [s0, s1] of segsA) {
    for (const [t0, t1] of segsB) min = Math.min(min, segSegDistance(s0, s1, t0, t1));
  }
  return min;
}

// segment-segment distance (squared then sqrt once); 0 when segments cross
function segSegDistance(a0: Vec, a1: Vec, b0: Vec, b1: Vec): number {
  if (segmentsIntersect(a0, a1, b0, b1)) return 0;
  const d = Math.min(
    pointSegDistance(a0, b0, b1),
    pointSegDistance(a1, b0, b1),
    pointSegDistance(b0, a0, a1),
    pointSegDistance(b1, a0, a1),
  );
  return d;
}

function segmentsIntersect(a0: Vec, a1: Vec, b0: Vec, b1: Vec): boolean {
  const d1 = cross(b0, b1, a0);
  const d2 = cross(b0, b1, a1);
  const d3 = cross(a0, a1, b0);
  const d4 = cross(a0, a1, b1);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  if (d1 === 0 && onSegment(b0, b1, a0)) return true;
  if (d2 === 0 && onSegment(b0, b1, a1)) return true;
  if (d3 === 0 && onSegment(a0, a1, b0)) return true;
  if (d4 === 0 && onSegment(a0, a1, b1)) return true;
  return false;
}

function cross(o: Vec, a: Vec, b: Vec): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function onSegment(p: Vec, q: Vec, r: Vec): boolean {
  return (
    Math.min(p.x, q.x) <= r.x &&
    r.x <= Math.max(p.x, q.x) &&
    Math.min(p.y, q.y) <= r.y &&
    r.y <= Math.max(p.y, q.y)
  );
}

function pointSegDistance(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
