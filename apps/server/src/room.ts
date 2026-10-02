import {
  BOULDER_MAZE_MAP,
  createGame,
  DEFAULT_CONFIG,
  forfeitPlayer,
  MAX_PLAYERS,
  snapshotState,
  stepGame,
} from '@boulder-maze/core';
import type { Direction, GameConfig, GameEvent, GameState, MazeMap, PlayerCommand } from '@boulder-maze/core';
import { PROTOCOL_VERSION } from './protocol.js';
import type { ClientMessage, LobbyPlayer, ServerMessage } from './protocol.js';

export interface RoomOptions {
  roomId?: string;
  config?: GameConfig;
  map?: MazeMap;
  /** Full snapshot cadence in ticks (3 ≈ 20 Hz at 60 tps). */
  snapshotEvery?: number;
  /** Seed for match n is `seedBase + n`, so replays are reproducible. */
  seedBase?: number;
}

export type Send = (playerId: string, message: ServerMessage) => void;

interface Seat extends LobbyPlayer {
  pending: { seq: number; direction: Direction } | null;
  lastSeq: number;
}

const MAX_FRAME_MS = 250;

/**
 * One match room. Transport-agnostic: the host feeds it client messages and
 * wall-clock time, and it emits server messages through `send`. The sim is
 * only ever advanced here — clients never own ticks, pause or restart.
 */
export class Room {
  readonly roomId: string;
  private readonly config: GameConfig;
  private readonly map: MazeMap;
  private readonly snapshotEvery: number;
  private readonly seedBase: number;
  private readonly seats = new Map<string, Seat>();
  private state: GameState | null = null;
  private accumulatorMs = 0;
  private matches = 0;
  private nextSeat = 1;

  constructor(private readonly send: Send, opts: RoomOptions = {}) {
    this.roomId = opts.roomId ?? 'room-1';
    this.config = opts.config ?? DEFAULT_CONFIG;
    this.map = opts.map ?? BOULDER_MAZE_MAP;
    this.snapshotEvery = opts.snapshotEvery ?? 3;
    this.seedBase = opts.seedBase ?? 1000;
  }

  get phase(): 'lobby' | 'running' | 'ended' {
    if (!this.state) return 'lobby';
    return this.state.phase === 'won' || this.state.phase === 'lost' ? 'ended' : 'running';
  }

  get tick(): number {
    return this.state?.tick ?? 0;
  }

  /** Authoritative view for tests and admin tooling; never hand it to clients. */
  debugState(): GameState | null {
    return this.state;
  }

  /** Allocates a player id for a fresh connection; returns null when the room cannot seat it. */
  connect(): string | null {
    if (this.phase === 'running') return null;
    const connected = [...this.seats.values()].filter((s) => s.connected).length;
    if (connected >= MAX_PLAYERS) return null;
    const id = `player-${this.nextSeat++}`;
    this.seats.set(id, { id, name: id, ready: false, connected: true, pending: null, lastSeq: 0 });
    return id;
  }

  disconnect(playerId: string): void {
    const seat = this.seats.get(playerId);
    if (!seat) return;
    if (this.phase === 'running' && this.state) {
      seat.connected = false;
      seat.ready = false;
      this.emitEvents(forfeitPlayer(this.state, playerId));
      if (this.state.phase === 'lost') this.broadcastSnapshot();
      this.broadcastLobby();
      return;
    }
    this.seats.delete(playerId);
    this.broadcastLobby();
  }

  handle(playerId: string, msg: ClientMessage): void {
    const seat = this.seats.get(playerId);
    if (!seat || !seat.connected) return;
    switch (msg.t) {
      case 'join': {
        if (msg.protocol !== PROTOCOL_VERSION) return this.reject(playerId, `protocol ${msg.protocol} != ${PROTOCOL_VERSION}`);
        if (msg.mapId !== this.map.id || msg.mapVersion !== this.map.version) {
          return this.reject(playerId, `map ${msg.mapId}@${msg.mapVersion} != ${this.map.id}@${this.map.version}`);
        }
        seat.name = msg.name;
        this.send(playerId, { t: 'welcome', playerId, roomId: this.roomId, protocol: PROTOCOL_VERSION });
        this.broadcastLobby();
        return;
      }
      case 'ready': {
        if (this.phase === 'running') return;
        seat.ready = msg.ready;
        this.broadcastLobby();
        this.maybeStart();
        return;
      }
      case 'input': {
        if (this.phase !== 'running' || !this.state) return;
        if (msg.seq <= seat.lastSeq) return; // stale or replayed intent
        if (!this.state.players[playerId]?.alive) return;
        seat.lastSeq = msg.seq;
        seat.pending = { seq: msg.seq, direction: msg.direction };
        return;
      }
      case 'resync': {
        if (this.state) this.send(playerId, { t: 'snapshot', state: snapshotState(this.state) });
        return;
      }
      case 'ping':
        this.send(playerId, { t: 'pong', sentAt: msg.sentAt, serverTick: this.tick });
        return;
    }
  }

  /** Advance wall-clock time; steps whole ticks at the fixed rate like LocalGameSession. */
  advance(frameDeltaMs: number): void {
    if (this.phase !== 'running' || !this.state) return;
    const tickMs = 1000 / this.config.tickRate;
    this.accumulatorMs += Math.min(frameDeltaMs, MAX_FRAME_MS);
    while (this.accumulatorMs >= tickMs && this.phase === 'running') {
      this.accumulatorMs -= tickMs;
      this.stepOnce();
    }
  }

  private stepOnce(): void {
    const state = this.state!;
    const commands: PlayerCommand[] = [];
    for (const seat of this.seats.values()) {
      if (!seat.pending) continue;
      commands.push({ playerId: seat.id, direction: seat.pending.direction, seq: seat.pending.seq, tick: state.tick + 1 });
      seat.pending = null;
    }
    this.emitEvents(stepGame(state, commands));
    const terminal = state.phase === 'won' || state.phase === 'lost';
    if (terminal || state.tick % this.snapshotEvery === 0) this.broadcastSnapshot();
    if (terminal) {
      for (const seat of this.seats.values()) seat.ready = false;
      this.broadcastLobby();
    }
  }

  private maybeStart(): void {
    const seated = [...this.seats.values()].filter((s) => s.connected);
    if (seated.length === 0 || !seated.every((s) => s.ready)) return;
    for (const [id, seat] of this.seats) if (!seat.connected) this.seats.delete(id);
    this.matches += 1;
    this.state = createGame(this.config, this.map, this.seedBase + this.matches, seated.map((s) => s.id));
    this.accumulatorMs = 0;
    for (const seat of seated) {
      seat.pending = null;
      seat.lastSeq = 0;
    }
    const snapshot = snapshotState(this.state);
    for (const seat of seated) this.send(seat.id, { t: 'start', state: snapshot });
    this.broadcastLobby();
  }

  private emitEvents(events: GameEvent[]): void {
    if (events.length === 0) return;
    this.broadcast({ t: 'events', tick: this.tick, events });
  }

  private broadcastSnapshot(): void {
    if (!this.state) return;
    this.broadcast({ t: 'snapshot', state: snapshotState(this.state) });
  }

  private broadcastLobby(): void {
    const players: LobbyPlayer[] = [...this.seats.values()].map(({ id, name, ready, connected }) => ({ id, name, ready, connected }));
    this.broadcast({ t: 'lobby', players, phase: this.phase });
  }

  private broadcast(message: ServerMessage): void {
    for (const seat of this.seats.values()) if (seat.connected) this.send(seat.id, message);
  }

  private reject(playerId: string, reason: string): void {
    this.send(playerId, { t: 'reject', reason });
  }
}
