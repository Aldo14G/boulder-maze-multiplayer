import {
  createGame,
  DEFAULT_CONFIG,
  BOULDER_MAZE_MAP,
  snapshotState,
  stepGame,
  LOCAL_PLAYER_ID,
} from '@boulder-maze/core';
import type {
  Direction,
  GameConfig,
  GameEvent,
  GameState,
  PlayerCommand,
} from '@boulder-maze/core';

/**
 * The GameSession contract: the one boundary between a driver (browser or
 * future network peer) and the authoritative simulation.
 *
 * A remote session will need explicit authority — the server owns ticks,
 * commands arrive tick-assigned, and pause/restart are authority-owned
 * policies, not local flags. A browser client must never silently own the
 * server clock, so none of the local lifecycle controls below (pause,
 * restart, resume) should be assumed to carry over.
 */
export interface GameSession {
  /** Latest movement intent for the controlled player. */
  submitDirection(direction: Direction): void;
  /** Detached, JSON-safe copy of the authoritative state for rendering. */
  snapshot(): GameState;
  /** Events produced since the previous drain (for FX; never for gameplay). */
  drainEvents(): GameEvent[];
  pause(): void;
  resume(): void;
  restart(): void;
  readonly paused: boolean;
  readonly phase: GameState['phase'];
}

const TICK_MS = 1000 / DEFAULT_CONFIG.tickRate;
/** Never catch up more than a quarter second of simulation at once. */
const MAX_FRAME_MS = 250;

/**
 * LocalGameSession is the sole owner of simulation advancement. It assigns
 * local input intents to the next simulation tick and steps the game at a
 * fixed 60 Hz from a render-rate-independent accumulator — frame pacing and
 * keyboard repeat rates never change game speed.
 */
export class LocalGameSession implements GameSession {
  private state: GameState;
  private accumulatorMs = 0;
  private inputSeq = 0;
  private desiredDir: Direction | null = null;
  private eventBacklog: GameEvent[] = [];
  // Frozen until the first Start so the run cannot play out under the title overlay.
  private _paused = true;

  constructor(
    private readonly config: GameConfig = DEFAULT_CONFIG,
    seed = 1,
  ) {
    this.state = createGame(config, BOULDER_MAZE_MAP, seed);
  }

  get paused(): boolean {
    return this._paused;
  }

  get phase(): GameState['phase'] {
    return this.state.phase;
  }

  submitDirection(direction: Direction): void {
    this.desiredDir = direction;
  }

  /** Called once per render frame by the scene. */
  advance(frameDeltaMs: number): void {
    if (this._paused) return;
    if (this.state.phase === 'won' || this.state.phase === 'lost') return;

    this.accumulatorMs += Math.min(frameDeltaMs, MAX_FRAME_MS);
    while (this.accumulatorMs >= TICK_MS) {
      this.accumulatorMs -= TICK_MS;
      const commands: PlayerCommand[] = [];
      if (this.desiredDir !== null) {
        commands.push({
          playerId: LOCAL_PLAYER_ID,
          direction: this.desiredDir,
          seq: ++this.inputSeq,
          tick: this.state.tick + 1,
        });
      }
      const events = stepGame(this.state, commands);
      if (events.length > 0) this.eventBacklog.push(...events);
    }
  }

  snapshot(): GameState {
    return snapshotState(this.state);
  }

  drainEvents(): GameEvent[] {
    const out = this.eventBacklog;
    this.eventBacklog = [];
    return out;
  }

  pause(): void {
    this._paused = true;
  }

  resume(): void {
    // dropping accumulated time avoids a catch-up burst on resume
    this.accumulatorMs = 0;
    this._paused = false;
  }

  /** Fresh run on the same map and default seed. */
  restart(): void {
    this.state = createGame(this.config, BOULDER_MAZE_MAP, 1);
    this.accumulatorMs = 0;
    this.inputSeq = 0;
    this.desiredDir = null;
    this.eventBacklog = [];
    this._paused = false;
  }

  /** Focus loss: held keys must not leak input into the next session stretch. */
  onFocusLost(): void {
    this.desiredDir = null;
    this.pause();
  }

  /** Test-only inspection hook; used by the Playwright smoke suite. */
  debugState(): GameState {
    return this.state;
  }
}
