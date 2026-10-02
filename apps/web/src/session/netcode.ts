import { snapshotState, stepGame } from '@boulder-maze/core';
import type { Direction, GameState, PlayerCommand, Vec } from '@boulder-maze/core';

export interface PendingInput {
  seq: number;
  direction: Direction;
}

/**
 * Client-side prediction on top of the shared deterministic core.
 *
 * The server owns the truth; the client re-runs `stepGame` from the latest
 * authoritative snapshot, replaying its own not-yet-acknowledged inputs, so
 * the local triangle reacts instantly while everything else is corrected
 * the moment the next snapshot lands.
 */

/** Inputs the server has already folded into `auth` are no longer pending. */
export function unacknowledged(auth: GameState, me: string, pending: readonly PendingInput[]): PendingInput[] {
  const acked = auth.players[me]?.lastCommandSeq ?? 0;
  return pending.filter((p) => p.seq > acked);
}

/**
 * Re-simulate from `auth` up to `auth.tick + leadTicks`, feeding one pending
 * input per tick in order — the same cadence the server applies them with.
 * Returns the predicted state and how many pending inputs were consumed.
 */
export function predict(auth: GameState, me: string, pending: readonly PendingInput[], leadTicks: number): GameState {
  const state = snapshotState(auth);
  let next = 0;
  for (let i = 0; i < leadTicks; i++) {
    const commands: PlayerCommand[] = [];
    const input = pending[next];
    if (input) {
      commands.push({ playerId: me, direction: input.direction, seq: input.seq, tick: state.tick + 1 });
      next += 1;
    }
    stepGame(state, commands);
  }
  return state;
}

/** Advance a predicted state one tick, applying at most one pending input. */
export function stepPredicted(state: GameState, me: string, input: PendingInput | undefined): void {
  const commands: PlayerCommand[] = input ? [{ playerId: me, direction: input.direction, seq: input.seq, tick: state.tick + 1 }] : [];
  stepGame(state, commands);
}

const SNAP_DISTANCE_UNITS = 120; // > 2 tiles in one interval means a teleport (chute respawn), not motion

function lerpVec(a: Vec, b: Vec, t: number): Vec {
  if (Math.abs(b.x - a.x) + Math.abs(b.y - a.y) > SNAP_DISTANCE_UNITS) return { ...b };
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * Interpolated positions for remote entities between two authoritative
 * snapshots (`t` in [0, 1]). Everything but `pos` comes from `s1`.
 */
export function interpolate(s0: GameState, s1: GameState, t: number): GameState {
  const k = Math.max(0, Math.min(1, t));
  const players: GameState['players'] = {};
  for (const [id, p1] of Object.entries(s1.players)) {
    const p0 = s0.players[id];
    players[id] = p0 ? { ...p1, pos: lerpVec(p0.pos, p1.pos, k) } : p1;
  }
  const boulders: GameState['boulders'] = {};
  for (const [id, b1] of Object.entries(s1.boulders)) {
    const b0 = s0.boulders[id];
    boulders[id] = b0 && b0.status === 'active' && b1.status === 'active' ? { ...b1, pos: lerpVec(b0.pos, b1.pos, k) } : b1;
  }
  return { ...s1, players, boulders };
}

/**
 * What the renderer sees: the predicted world (so local pickups and turns
 * feel instant) with remote players and boulders taken from the smoothed
 * authoritative timeline, and the phase/outcome always from the authority.
 */
export function composeView(predicted: GameState, smoothed: GameState, auth: GameState, me: string): GameState {
  const players: GameState['players'] = { ...smoothed.players };
  if (predicted.players[me]) players[me] = predicted.players[me];
  return {
    ...predicted,
    phase: auth.phase,
    players,
    boulders: smoothed.boulders,
  };
}

/** Half the round trip in ticks plus a small cushion, clamped to sane bounds. */
export function leadTicksFor(rttMs: number, tickMs: number): number {
  return Math.max(2, Math.min(30, Math.ceil(rttMs / 2 / tickMs) + 2));
}
