import { describe, expect, it } from 'vitest';
import { isWalkable, stepGame } from '../src/index.js';
import {
  center,
  cmd,
  makeState,
  placePlayer,
  player,
  resetSeq,
  startPlaying,
  suppressBoulders,
  T,
  tileOf,
} from './helpers.js';
import { miniMap } from './fixtures.js';

function setup(tile: { x: number; y: number }, dir: 'right' | 'left' | 'up' | 'down' | null) {
  resetSeq();
  const state = makeState();
  startPlaying(state);
  suppressBoulders(state);
  placePlayer(state, tile, dir);
  return state;
}

describe('player movement', () => {
  it('moves in whole speed increments and lands on tile centres', () => {
    const state = setup({ x: 1, y: 7 }, 'right');
    stepGame(state, []);
    expect(player(state).pos.x).toBe(center({ x: 1, y: 7 }).x + state.config.playerSpeed);
    // corridor y=7 runs x=1..11; wall at x=12 -> player must stop at (11,7)
    for (let i = 0; i < 200; i++) stepGame(state, []);
    expect(player(state).pos).toEqual(center({ x: 11, y: 7 }));
    expect(player(state).dir).toBeNull();
    for (let i = 0; i < 10; i++) stepGame(state, []);
    expect(player(state).pos).toEqual(center({ x: 11, y: 7 }));
  });

  it('buffers an early turn and executes it at the next legal centre', () => {
    // 'up' is legal only at x ∈ {1,4,8,11} on row 4 — start where it is not
    const state = setup({ x: 2, y: 4 }, 'right');
    stepGame(state, [cmd(state, 'up')]);
    for (let i = 0; i < 200 && player(state).dir === 'right'; i++) stepGame(state, []);
    expect(player(state).dir).toBe('up');
    expect(tileOf(player(state).pos)).toEqual({ x: 4, y: 4 });
  });

  it('keeps going straight when the buffered turn is still illegal at a centre', () => {
    const state = setup({ x: 2, y: 4 }, 'right');
    stepGame(state, [cmd(state, 'up')]);
    // reach centre of (3,4): 'up' is a wall there — must continue right
    while (player(state).pos.x !== center({ x: 3, y: 4 }).x) stepGame(state, []);
    expect(player(state).dir).toBe('right');
  });

  it('reverses immediately mid-corridor without teleporting', () => {
    const state = setup({ x: 2, y: 4 }, 'right');
    // step until mid-edge (not on a centre)
    while (player(state).pos.x % T === T / 2) stepGame(state, []);
    const before = player(state).pos.x;
    stepGame(state, [cmd(state, 'left')]);
    expect(player(state).dir).toBe('left');
    expect(player(state).pos.x).toBe(before - state.config.playerSpeed);
  });

  it('a stopped player starts moving once a legal buffered direction exists', () => {
    const state = setup({ x: 11, y: 7 }, null); // facing the wall, stopped
    stepGame(state, [cmd(state, 'up')]);
    expect(player(state).dir).toBe('up');
    expect(player(state).pos.y).toBeLessThan(center({ x: 11, y: 7 }).y);
  });

  it('never moves diagonally, clips corners, or enters walls — long random walk', () => {
    const state = makeState();
    startPlaying(state);
    suppressBoulders(state);
    resetSeq();
    const dirs = ['up', 'left', 'down', 'right'] as const;
    let k = 0;
    for (let i = 0; i < 800; i++) {
      const commands = i % 13 === 0 ? [cmd(state, dirs[k++ % 4]!)] : [];
      const prev = player(state).pos;
      stepGame(state, commands);
      const cur = player(state).pos;
      const movedX = cur.x !== prev.x;
      const movedY = cur.y !== prev.y;
      expect(movedX && movedY).toBe(false); // never diagonal
      expect(isWalkable(miniMap, tileOf(cur))).toBe(true); // never inside a wall
    }
  });
});
