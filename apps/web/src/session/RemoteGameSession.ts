import { BOULDER_MAZE_MAP, createGame } from '@boulder-maze/core';
import type { Direction, GameEvent, GameState } from '@boulder-maze/core';
import { applyDelta, PROTOCOL_VERSION } from '@boulder-maze/server/protocol';
import type { ClientMessage, LobbyPlayer, ServerMessage } from '@boulder-maze/server/protocol';
import type { GameSession } from './LocalGameSession.js';
import { composeView, interpolate, leadTicksFor, predict, stepPredicted, unacknowledged } from './netcode.js';
import type { PendingInput } from './netcode.js';

export type ConnectionStatus = 'connecting' | 'lobby' | 'running' | 'ended' | 'rejected' | 'closed';

export interface RemoteSessionCallbacks {
  onLobby?: (players: LobbyPlayer[], phase: 'lobby' | 'running' | 'ended') => void;
  onStart?: () => void;
  onStatus?: (status: ConnectionStatus, detail?: string) => void;
}

export interface NetStats {
  rttMs: number;
  leadTicks: number;
  /** predicted tick minus latest authoritative tick */
  aheadTicks: number;
  /** Position error corrected on the last reconciliation, in sub-tile units. */
  lastCorrectionUnits: number;
  snapshotsPerSecond: number;
  kbPerSecond: number;
  resyncs: number;
  prediction: boolean;
}

interface Stamped {
  state: GameState;
  at: number;
}

const INTERP_DELAY_TICKS = 6; // two snapshot intervals at snapshotEvery=3
const PING_INTERVAL_MS = 1000;
const MAX_FRAME_MS = 250;

/**
 * GameSession backed by the authoritative server. With prediction on, the
 * local player is simulated ahead with the shared core and reconciled on
 * every snapshot; remote entities are interpolated between snapshots. With
 * prediction off, raw snapshots are rendered as they arrive (for the demo).
 */
export class RemoteGameSession implements GameSession {
  private readonly ws: WebSocket;
  private readonly tickMs: number;
  private auth: GameState;
  private history: Stamped[] = [];
  private predicted: GameState | null = null;
  private pending: PendingInput[] = [];
  private nextToApply = 0;
  private accumulatorMs = 0;
  private eventBacklog: GameEvent[] = [];
  private inputSeq = 0;
  private lastSentDir: Direction | null = null;
  private _localPlayerId: string | null = null;
  private _status: ConnectionStatus = 'connecting';
  private rttMs = 0;
  private lastCorrection = 0;
  private snapshotTimes: number[] = [];
  private bytesLog: Array<{ at: number; bytes: number }> = [];
  private resyncs = 0;
  private resyncPending = false;
  private tickOffset = 0; // server tick ≈ now / tickMs + tickOffset
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  prediction = true;
  lobby: LobbyPlayer[] = [];

  constructor(
    url: string,
    private readonly name: string,
    private readonly cb: RemoteSessionCallbacks = {},
  ) {
    // Placeholder so the scene can draw the board before the first snapshot.
    this.auth = createGame(undefined, BOULDER_MAZE_MAP, 1);
    this.auth.players = {};
    this.tickMs = 1000 / this.auth.config.tickRate;
    this.ws = new WebSocket(url);
    this.ws.addEventListener('open', () => {
      this.send({ t: 'join', name: this.name, protocol: PROTOCOL_VERSION, mapId: BOULDER_MAZE_MAP.id, mapVersion: BOULDER_MAZE_MAP.version });
      this.pingTimer = setInterval(() => this.send({ t: 'ping', sentAt: performance.now() }), PING_INTERVAL_MS);
    });
    this.ws.addEventListener('message', (ev) => {
      const raw = String(ev.data);
      this.bytesLog.push({ at: performance.now(), bytes: raw.length });
      this.onMessage(JSON.parse(raw) as ServerMessage);
    });
    this.ws.addEventListener('close', () => this.setStatus('closed'));
    this.ws.addEventListener('error', () => this.setStatus('closed', 'connection error'));
  }

  get localPlayerId(): string | null {
    return this._localPlayerId;
  }

  get status(): ConnectionStatus {
    return this._status;
  }

  get paused(): boolean {
    return false;
  }

  get phase(): GameState['phase'] {
    return this.auth.phase;
  }

  get stats(): NetStats {
    const now = performance.now();
    this.snapshotTimes = this.snapshotTimes.filter((t) => now - t < 1000);
    this.bytesLog = this.bytesLog.filter((b) => now - b.at < 1000);
    return {
      rttMs: Math.round(this.rttMs),
      leadTicks: this.leadTicks,
      aheadTicks: this.predicted ? this.predicted.tick - this.auth.tick : 0,
      lastCorrectionUnits: Math.round(this.lastCorrection),
      snapshotsPerSecond: this.snapshotTimes.length,
      kbPerSecond: Math.round(this.bytesLog.reduce((s, b) => s + b.bytes, 0) / 1024),
      resyncs: this.resyncs,
      prediction: this.prediction,
    };
  }

  private get leadTicks(): number {
    return leadTicksFor(this.rttMs, this.tickMs);
  }

  submitDirection(direction: Direction): void {
    if (this._status !== 'running' || !this._localPlayerId) return;
    const me = (this.predicted ?? this.auth).players[this._localPlayerId];
    if (!me?.alive) return;
    // Re-send only when the intent changes or the sim already consumed it.
    if (direction === this.lastSentDir && me.bufferedDir === direction) return;
    this.lastSentDir = direction;
    const input = { seq: ++this.inputSeq, direction };
    this.pending.push(input);
    this.send({ t: 'input', ...input });
  }

  /** Steps the predicted world at the fixed rate; the authority is never advanced here. */
  advance(frameDeltaMs: number): void {
    if (!this.prediction || !this.predicted || !this._localPlayerId || this._status !== 'running') return;
    this.accumulatorMs += Math.min(frameDeltaMs, MAX_FRAME_MS);
    while (this.accumulatorMs >= this.tickMs) {
      this.accumulatorMs -= this.tickMs;
      // never run away from the authority: wait for snapshots if too far ahead
      if (this.predicted.tick - this.auth.tick >= this.leadTicks + INTERP_DELAY_TICKS) break;
      stepPredicted(this.predicted, this._localPlayerId, this.pending[this.nextToApply]);
      if (this.pending[this.nextToApply]) this.nextToApply += 1;
    }
  }

  snapshot(): GameState {
    if (!this.prediction || !this.predicted || !this._localPlayerId) return this.auth;
    return composeView(this.predicted, this.smoothedAuthority(), this.auth, this._localPlayerId);
  }

  drainEvents(): GameEvent[] {
    const out = this.eventBacklog;
    this.eventBacklog = [];
    return out;
  }

  pause(): void {}

  resume(): void {}

  /** Authority-owned restart: flag readiness and wait for the server's `start`. */
  restart(): void {
    this.setReady(true);
  }

  setReady(ready: boolean): void {
    this.send({ t: 'ready', ready });
  }

  setPrediction(on: boolean): void {
    this.prediction = on;
    if (on) this.reconcile();
  }

  onFocusLost(): void {
    this.lastSentDir = null;
  }

  close(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws.close();
  }

  // ------------------------------------------------------------ authority

  private acceptAuthoritative(state: GameState): void {
    if (state.tick < this.auth.tick) return;
    const now = performance.now();
    this.auth = state;
    this.history.push({ state, at: now });
    if (this.history.length > 12) this.history.shift();
    this.snapshotTimes.push(now);
    this.tickOffset = state.tick - now / this.tickMs;
    this.reconcile();
  }

  private reconcile(): void {
    const me = this._localPlayerId;
    if (!me || !this.prediction || this._status !== 'running') return;
    const before = this.predicted?.players[me]?.pos;
    this.pending = unacknowledged(this.auth, me, this.pending);
    this.predicted = predict(this.auth, me, this.pending, this.leadTicks);
    this.nextToApply = Math.min(this.pending.length, this.leadTicks);
    const after = this.predicted.players[me]?.pos;
    this.lastCorrection = before && after ? Math.hypot(after.x - before.x, after.y - before.y) : 0;
  }

  /** Authoritative timeline rendered INTERP_DELAY_TICKS behind the estimated server tick. */
  private smoothedAuthority(): GameState {
    const h = this.history;
    if (h.length < 2) return this.auth;
    const renderTick = performance.now() / this.tickMs + this.tickOffset - INTERP_DELAY_TICKS;
    for (let i = h.length - 1; i > 0; i--) {
      const s0 = h[i - 1]!.state;
      const s1 = h[i]!.state;
      if (renderTick >= s0.tick) {
        const span = s1.tick - s0.tick || 1;
        return interpolate(s0, s1, (renderTick - s0.tick) / span);
      }
    }
    return h[0]!.state;
  }

  private onMessage(msg: ServerMessage): void {
    switch (msg.t) {
      case 'welcome':
        this._localPlayerId = msg.playerId;
        this.setStatus('lobby');
        return;
      case 'lobby':
        this.lobby = msg.players;
        this.cb.onLobby?.(msg.players, msg.phase);
        return;
      case 'start':
        this.history = [];
        this.pending = [];
        this.nextToApply = 0;
        this.inputSeq = 0;
        this.lastSentDir = null;
        this.eventBacklog = [];
        this.accumulatorMs = 0;
        this.predicted = null;
        this.setStatus('running');
        this.acceptAuthoritative(msg.state);
        this.cb.onStart?.();
        return;
      case 'snapshot':
        this.resyncPending = false;
        this.acceptAuthoritative(msg.state);
        if (msg.state.phase === 'won' || msg.state.phase === 'lost') this.setStatus('ended');
        return;
      case 'delta': {
        if (this.resyncPending) return; // wait for the keyframe we asked for
        const next = applyDelta(this.auth, msg.delta);
        if (!next) {
          // gap in the stream (dropped/reordered frame): ask for the shared base once
          this.resyncPending = true;
          this.resyncs += 1;
          this.send({ t: 'resync' });
          return;
        }
        this.acceptAuthoritative(next);
        if (next.phase === 'won' || next.phase === 'lost') this.setStatus('ended');
        return;
      }
      case 'events':
        this.eventBacklog.push(...msg.events);
        return;
      case 'reject':
        this.setStatus('rejected', msg.reason);
        return;
      case 'pong': {
        const sample = performance.now() - msg.sentAt;
        this.rttMs = this.rttMs === 0 ? sample : this.rttMs * 0.8 + sample * 0.2;
        return;
      }
    }
  }

  private setStatus(status: ConnectionStatus, detail?: string): void {
    this._status = status;
    this.cb.onStatus?.(status, detail);
  }

  private send(msg: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
