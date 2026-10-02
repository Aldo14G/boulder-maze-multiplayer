import type { Direction, GameEvent, GameState } from '@boulder-maze/core';

/** Bump whenever a frame shape changes; clients must match exactly. */
export const PROTOCOL_VERSION = 1;

export interface LobbyPlayer {
  id: string;
  name: string;
  ready: boolean;
  connected: boolean;
}

export type ClientMessage =
  | { t: 'join'; name: string; protocol: number; mapId: string; mapVersion: number }
  | { t: 'ready'; ready: boolean }
  | { t: 'input'; seq: number; direction: Direction }
  | { t: 'resync' }
  | { t: 'ping'; sentAt: number };

export type ServerMessage =
  | { t: 'welcome'; playerId: string; roomId: string; protocol: number }
  | { t: 'lobby'; players: LobbyPlayer[]; phase: 'lobby' | 'running' | 'ended' }
  | { t: 'start'; state: GameState }
  | { t: 'snapshot'; state: GameState }
  | { t: 'delta'; delta: StateDelta }
  | { t: 'events'; tick: number; events: GameEvent[] }
  | { t: 'pong'; sentAt: number; serverTick: number }
  | { t: 'reject'; reason: string };

/**
 * Everything that can change between two authoritative ticks, minus the
 * static map and the pellets that are still there. Players and boulders are
 * small enough to ship whole; pellets only ever disappear.
 */
export interface StateDelta {
  baseTick: number;
  tick: number;
  phase: GameState['phase'];
  readyUntilTick: number;
  players: GameState['players'];
  boulders: GameState['boulders'];
  pelletsRemoved: number[];
  pelletsRemaining: number;
  nextEventSeq: number;
  rngState: number;
}

export function makeDelta(prev: GameState, next: GameState): StateDelta {
  const pelletsRemoved: number[] = [];
  for (const idx of Object.keys(prev.pellets)) if (!(idx in next.pellets)) pelletsRemoved.push(Number(idx));
  return {
    baseTick: prev.tick,
    tick: next.tick,
    phase: next.phase,
    readyUntilTick: next.readyUntilTick,
    players: next.players,
    boulders: next.boulders,
    pelletsRemoved,
    pelletsRemaining: next.pelletsRemaining,
    nextEventSeq: next.nextEventSeq,
    rngState: next.rngState,
  };
}

/** Returns the next state, or null when `base` is not the delta's base tick (caller should resync). */
export function applyDelta(base: GameState, delta: StateDelta): GameState | null {
  if (base.tick !== delta.baseTick) return null;
  const pellets = { ...base.pellets };
  for (const idx of delta.pelletsRemoved) delete pellets[idx];
  const { baseTick: _base, pelletsRemoved: _removed, ...rest } = delta;
  return { ...base, ...rest, pellets };
}

const DIRECTIONS: ReadonlySet<string> = new Set(['up', 'down', 'left', 'right']);

/** Narrow an untrusted wire frame; `null` means drop it. */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== 'object') return null;
  const m = data as Record<string, unknown>;
  switch (m['t']) {
    case 'join':
      return typeof m['name'] === 'string' &&
        m['name'].length > 0 &&
        m['name'].length <= 24 &&
        Number.isInteger(m['protocol']) &&
        typeof m['mapId'] === 'string' &&
        Number.isInteger(m['mapVersion'])
        ? { t: 'join', name: m['name'], protocol: m['protocol'] as number, mapId: m['mapId'], mapVersion: m['mapVersion'] as number }
        : null;
    case 'ready':
      return typeof m['ready'] === 'boolean' ? { t: 'ready', ready: m['ready'] } : null;
    case 'input':
      return Number.isInteger(m['seq']) && (m['seq'] as number) > 0 && typeof m['direction'] === 'string' && DIRECTIONS.has(m['direction'])
        ? { t: 'input', seq: m['seq'] as number, direction: m['direction'] as Direction }
        : null;
    case 'resync':
      return { t: 'resync' };
    case 'ping':
      return typeof m['sentAt'] === 'number' ? { t: 'ping', sentAt: m['sentAt'] } : null;
    default:
      return null;
  }
}
