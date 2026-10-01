import { describe, expect, it } from 'vitest';
import { stepGame, tileIndex } from '../src/index.js';
import {
  center,
  clearPellets,
  cmd,
  makeState,
  placeBoulder,
  placeBoulderAt,
  placePlayer,
  player,
  resetSeq,
  startPlaying,
} from './helpers.js';
import { miniMap } from './fixtures.js';

describe('game flow', () => {
  it('counts down the ready phase with no movement, then starts', () => {
    resetSeq();
    const state = makeState();
    const spawn = player(state).pos;
    expect(state.phase).toBe('ready');
    for (let i = 0; i < state.readyUntilTick - 1; i++) {
      expect(stepGame(state, []).every((e) => e.type !== 'gameStarted')).toBe(true);
    }
    expect(player(state).pos).toEqual(spawn); // frozen during countdown
    const events = stepGame(state, []);
    expect(state.phase).toBe('playing');
    expect(events.some((e) => e.type === 'gameStarted')).toBe(true);
  });

  it('collecting the final pellet wins the run', () => {
    resetSeq();
    const state = makeState();
    startPlaying(state);
    const last = tileIndex(miniMap, { x: 5, y: 7 });
    clearPellets(state, [[last, 'normal']]);
    placePlayer(state, { x: 5, y: 7 }, 'right');
    const events = stepGame(state, []);
    expect(state.pelletsRemaining).toBe(0);
    expect(state.phase).toBe('won');
    expect(events.some((e) => e.type === 'gameWon')).toBe(true);
  });

  it('fatal contact beats a simultaneous final pellet', () => {
    resetSeq();
    const state = makeState();
    startPlaying(state);
    const last = tileIndex(miniMap, { x: 6, y: 7 });
    clearPellets(state, [[last, 'normal']]);
    // player enters the last-pellet tile this tick; boulder overlaps it too
    placePlayer(state, { x: 5, y: 7 }, 'right');
    player(state).pos = { x: 6 * 60 - 1, y: 7 * 60 + 30 };
    placeBoulderAt(state, 'boulder-1', { x: 6 * 60 + 10, y: 7 * 60 + 30 }, 'left');
    const events = stepGame(state, []);
    expect(state.pelletsRemaining).toBe(0); // pellet was collected
    expect(state.phase).toBe('lost'); // but contact took precedence
    expect(events.some((e) => e.type === 'playerDefeated')).toBe(true);
    expect(events.some((e) => e.type === 'gameWon')).toBe(false);
  });

  it('stops the simulation on a terminal outcome', () => {
    resetSeq();
    const state = makeState();
    startPlaying(state);
    clearPellets(state);
    placePlayer(state, { x: 4, y: 4 }, null);
    placeBoulder(state, 'boulder-1', { x: 4, y: 4 }, 'left');
    stepGame(state, []);
    expect(state.phase).toBe('lost');
    const tick = state.tick;
    const snapshot = JSON.stringify(state);
    expect(stepGame(state, [])).toEqual([]);
    expect(state.tick).toBe(tick);
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});
