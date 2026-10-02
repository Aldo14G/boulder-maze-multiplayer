import { describe, expect, it } from 'vitest';
import { BOULDER_MAZE_MAP, createGame, DEFAULT_CONFIG, stepGame } from '@boulder-maze/core';
import type { GameState, PlayerCommand } from '@boulder-maze/core';
import { composeView, interpolate, leadTicksFor, predict, unacknowledged } from '../src/session/netcode.js';

const ME = 'player-1';
const OTHER = 'player-2';

function running(): GameState {
  const s = createGame(DEFAULT_CONFIG, BOULDER_MAZE_MAP, 3, [ME, OTHER]);
  for (const b of Object.values(s.boulders)) b.releaseAtTick = Number.MAX_SAFE_INTEGER;
  while (s.phase === 'ready') stepGame(s, []);
  return s;
}

describe('prediction', () => {
  it('replays only unacknowledged inputs and lands exactly where the server will', () => {
    const server = running();
    const pending = [
      { seq: 1, direction: 'left' as const },
      { seq: 2, direction: 'up' as const },
    ];
    // server applies seq 1 at tick+1 and seq 2 at tick+2, then runs 8 more ticks
    const expected = JSON.parse(JSON.stringify(server)) as GameState;
    const cmds: PlayerCommand[] = pending.map((p, i) => ({ playerId: ME, direction: p.direction, seq: p.seq, tick: expected.tick + 1 + i }));
    for (let i = 0; i < 10; i++) stepGame(expected, cmds.filter((c) => c.tick === expected.tick + 1));

    const predicted = predict(server, ME, pending, 10);
    expect(predicted.tick).toBe(server.tick + 10);
    expect(predicted.players[ME]!.pos).toEqual(expected.players[ME]!.pos);
    expect(predicted.players[ME]!.lastCommandSeq).toBe(2);
    expect(server.tick).toBe(expected.tick - 10); // input state untouched
  });

  it('drops inputs the authoritative snapshot already consumed', () => {
    const auth = running();
    auth.players[ME]!.lastCommandSeq = 4;
    const left = unacknowledged(auth, ME, [{ seq: 3, direction: 'up' }, { seq: 4, direction: 'up' }, { seq: 5, direction: 'left' }]);
    expect(left.map((p) => p.seq)).toEqual([5]);
  });

  it('lead grows with latency but stays bounded', () => {
    const tickMs = 1000 / 60;
    expect(leadTicksFor(0, tickMs)).toBe(2);
    expect(leadTicksFor(100, tickMs)).toBe(5);
    expect(leadTicksFor(5000, tickMs)).toBe(30);
  });
});

describe('interpolation and view', () => {
  it('lerps remote positions and snaps on teleports', () => {
    const s0 = running();
    const s1 = JSON.parse(JSON.stringify(s0)) as GameState;
    s1.players[OTHER]!.pos = { x: s0.players[OTHER]!.pos.x - 10, y: s0.players[OTHER]!.pos.y };
    const half = interpolate(s0, s1, 0.5);
    expect(half.players[OTHER]!.pos.x).toBe(s0.players[OTHER]!.pos.x - 5);

    s1.players[OTHER]!.pos = { x: s0.players[OTHER]!.pos.x - 600, y: s0.players[OTHER]!.pos.y };
    expect(interpolate(s0, s1, 0.5).players[OTHER]!.pos).toEqual(s1.players[OTHER]!.pos);
  });

  it('shows my predicted triangle, everyone else smoothed, and the authority’s phase', () => {
    const auth = running();
    const predicted = predict(auth, ME, [{ seq: 1, direction: 'left' }], 6);
    const smoothed = interpolate(auth, auth, 1);
    auth.phase = 'lost';
    const view = composeView(predicted, smoothed, auth, ME);
    expect(view.players[ME]!.pos).toEqual(predicted.players[ME]!.pos);
    expect(view.players[OTHER]!.pos).toEqual(auth.players[OTHER]!.pos);
    expect(view.phase).toBe('lost');
    expect(view.tick).toBe(predicted.tick);
  });
});
