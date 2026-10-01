import { describe, expect, it } from 'vitest';
import { stepGame, tileIndex } from '../src/index.js';
import {
  clearPellets,
  cmd,
  makeState,
  placePlayer,
  player,
  resetSeq,
  startPlaying,
  suppressBoulders,
} from './helpers.js';
import { miniMap } from './fixtures.js';

describe('pellets', () => {
  it('collects a normal pellet exactly once with score and remaining updates', () => {
    resetSeq();
    const state = makeState();
    startPlaying(state);
    suppressBoulders(state);
    const target = tileIndex(miniMap, { x: 3, y: 7 });
    clearPellets(state, [[target, 'normal']]);
    placePlayer(state, { x: 2, y: 7 }, 'right');

    const scoreBefore = player(state).score;
    let events = stepGame(state, []);
    while (player(state).pos.x < 3 * state.config.unitsPerTile) {
      events = events.concat(stepGame(state, []));
    }
    expect(events.some((e) => e.type === 'pelletCollected' && e.tile === target)).toBe(true);
    expect(player(state).score).toBe(scoreBefore + 10);
    expect(state.pelletsRemaining).toBe(0);
    expect(state.pellets[target]).toBeUndefined();

    // stepping over the same tile again collects nothing
    for (let i = 0; i < 60; i++) events = events.concat(stepGame(state, []));
    expect(events.filter((e) => e.type === 'pelletCollected')).toHaveLength(1);
    expect(player(state).score).toBe(scoreBefore + 10);
  });

  it('a Super Pellet scores 50 and activates the drill', () => {
    resetSeq();
    const state = makeState();
    startPlaying(state);
    suppressBoulders(state);
    const target = tileIndex(miniMap, { x: 2, y: 7 });
    clearPellets(state, [[target, 'super'], [tileIndex(miniMap, { x: 5, y: 7 }), 'normal']]);
    placePlayer(state, { x: 2, y: 7 }, 'right');

    const events = stepGame(state, []);
    expect(events.some((e) => e.type === 'superPelletCollected' && e.tile === target)).toBe(true);
    expect(events.some((e) => e.type === 'powerStarted')).toBe(true);
    expect(player(state).score).toBe(50);
    expect(player(state).powerTicks).toBe(state.config.powerTicks);
  });

  it('places no pellets on the player spawn or chute entries', () => {
    const state = makeState();
    expect(state.pellets[tileIndex(miniMap, { x: 6, y: 7 })]).toBeUndefined(); // spawn
    expect(state.pellets[tileIndex(miniMap, { x: 1, y: 4 })]).toBeUndefined(); // chute entry
  });
});
