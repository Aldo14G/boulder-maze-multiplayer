import {
  createGame,
  DEFAULT_CONFIG,
  LOCAL_PLAYER_ID,
} from '../src/index.js';
import type { Direction, GameConfig, GameState, MazeMap, PelletKind, PlayerCommand, Vec } from '../src/index.js';
import { miniMap } from './fixtures.js';

export const T = DEFAULT_CONFIG.unitsPerTile;
export const CENTER = T / 2;

export function center(tile: { x: number; y: number }, cfg: GameConfig = DEFAULT_CONFIG): Vec {
  const t = cfg.unitsPerTile;
  return { x: tile.x * t + t / 2, y: tile.y * t + t / 2 };
}

export function makeState(
  map: MazeMap = miniMap,
  cfg: GameConfig = DEFAULT_CONFIG,
  seed = 7,
): GameState {
  return createGame(cfg, map, seed);
}

/** Jump straight to the playing phase, bypassing the ready countdown. */
export function startPlaying(state: GameState): void {
  state.tick = state.readyUntilTick;
  state.phase = 'playing';
}

/** Keep all boulders pending forever so they cannot interfere with a scenario. */
export function suppressBoulders(state: GameState): void {
  for (const b of Object.values(state.boulders)) b.releaseAtTick = Number.MAX_SAFE_INTEGER;
}

/** Remove every pellet except the ones listed (avoids accidental wins). */
export function clearPellets(state: GameState, keep: Array<[number, PelletKind]> = []): void {
  state.pellets = {};
  for (const [idx, kind] of keep) state.pellets[idx] = kind;
  state.pelletsRemaining = keep.length;
}

export function placePlayer(
  state: GameState,
  tile: { x: number; y: number },
  dir: Direction | null = null,
): void {
  const p = state.players[LOCAL_PLAYER_ID]!;
  p.pos = center(tile, state.config);
  p.dir = dir;
  p.bufferedDir = null;
}

export function placePlayerAt(state: GameState, pos: Vec, dir: Direction | null = null): void {
  const p = state.players[LOCAL_PLAYER_ID]!;
  p.pos = pos;
  p.dir = dir;
  p.bufferedDir = null;
}

export function placeBoulder(
  state: GameState,
  id: string,
  tile: { x: number; y: number },
  dir: Direction,
): void {
  const b = state.boulders[id]!;
  b.status = 'active';
  b.pos = center(tile, state.config);
  b.dir = dir;
}

export function placeBoulderAt(
  state: GameState,
  id: string,
  pos: Vec,
  dir: Direction,
): void {
  const b = state.boulders[id]!;
  b.status = 'active';
  b.pos = pos;
  b.dir = dir;
}

let seq = 0;
export function resetSeq(): void {
  seq = 0;
}

export function cmd(state: GameState, direction: Direction): PlayerCommand {
  seq += 1;
  return { playerId: LOCAL_PLAYER_ID, direction, seq, tick: state.tick + 1 };
}

export function player(state: GameState) {
  return state.players[LOCAL_PLAYER_ID]!;
}

export function tileOf(pos: Vec, cfg: GameConfig = DEFAULT_CONFIG) {
  const t = cfg.unitsPerTile;
  return { x: Math.floor(pos.x / t), y: Math.floor(pos.y / t) };
}
