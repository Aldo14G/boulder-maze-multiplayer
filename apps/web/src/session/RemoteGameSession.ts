import { BOULDER_MAZE_MAP, createGame } from '@boulder-maze/core';
import type { Direction, GameEvent, GameState } from '@boulder-maze/core';
import { PROTOCOL_VERSION } from '@boulder-maze/server/protocol';
import type { ClientMessage, LobbyPlayer, ServerMessage } from '@boulder-maze/server/protocol';
import type { GameSession } from './LocalGameSession.js';

export type ConnectionStatus = 'connecting' | 'lobby' | 'running' | 'ended' | 'rejected' | 'closed';

export interface RemoteSessionCallbacks {
  onLobby?: (players: LobbyPlayer[], phase: 'lobby' | 'running' | 'ended') => void;
  onStart?: () => void;
  onStatus?: (status: ConnectionStatus, detail?: string) => void;
}

/**
 * GameSession backed by the authoritative server. This slice renders server
 * snapshots as they arrive; pause/resume are inert because the server owns
 * the clock, and restart means "I am ready for the next match".
 */
export class RemoteGameSession implements GameSession {
  private readonly ws: WebSocket;
  private state: GameState;
  private eventBacklog: GameEvent[] = [];
  private inputSeq = 0;
  private lastSentDir: Direction | null = null;
  private _localPlayerId: string | null = null;
  private _status: ConnectionStatus = 'connecting';
  lobby: LobbyPlayer[] = [];

  constructor(
    url: string,
    private readonly name: string,
    private readonly cb: RemoteSessionCallbacks = {},
  ) {
    // Placeholder so the scene can draw the board before the first snapshot.
    this.state = createGame(undefined, BOULDER_MAZE_MAP, 1);
    this.state.players = {};
    this.ws = new WebSocket(url);
    this.ws.addEventListener('open', () => {
      this.send({ t: 'join', name: this.name, protocol: PROTOCOL_VERSION, mapId: BOULDER_MAZE_MAP.id, mapVersion: BOULDER_MAZE_MAP.version });
    });
    this.ws.addEventListener('message', (ev) => this.onMessage(JSON.parse(String(ev.data)) as ServerMessage));
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
    return this.state.phase;
  }

  submitDirection(direction: Direction): void {
    if (this._status !== 'running' || !this._localPlayerId) return;
    const me = this.state.players[this._localPlayerId];
    if (!me?.alive) return;
    // Re-send only when the intent changes or the sim already consumed it.
    if (direction === this.lastSentDir && me.bufferedDir === direction) return;
    this.lastSentDir = direction;
    this.send({ t: 'input', seq: ++this.inputSeq, direction });
  }

  advance(): void {}

  snapshot(): GameState {
    return this.state;
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

  onFocusLost(): void {
    this.lastSentDir = null;
  }

  close(): void {
    this.ws.close();
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
        this.state = msg.state;
        this.inputSeq = 0;
        this.lastSentDir = null;
        this.eventBacklog = [];
        this.setStatus('running');
        this.cb.onStart?.();
        return;
      case 'snapshot':
        if (msg.state.tick >= this.state.tick) this.state = msg.state;
        if (msg.state.phase === 'won' || msg.state.phase === 'lost') this.setStatus('ended');
        return;
      case 'events':
        this.eventBacklog.push(...msg.events);
        return;
      case 'reject':
        this.setStatus('rejected', msg.reason);
        return;
      case 'pong':
        return;
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
