import { describe, expect, it } from 'vitest';
import { isWalkable, posToTile, stepGame, tileIndex } from '../src/index.js';
import {
  clearPellets,
  makeState,
  placeBoulder,
  placeBoulderAt,
  placePlayer,
  player,
  resetSeq,
  startPlaying,
} from './helpers.js';
import { miniMap } from './fixtures.js';

describe('boulder AI', () => {
  it('chases the player along shortest paths', () => {
    resetSeq();
    const state = makeState();
    startPlaying(state);
    clearPellets(state, [[1, 'normal']]);
    placePlayer(state, { x: 11, y: 7 }, null);
    placeBoulder(state, 'boulder-1', { x: 1, y: 7 }, 'right');
    const b = state.boulders['boulder-1']!;
    const startDist = Math.abs(b.pos.x - player(state).pos.x);
    for (let i = 0; i < 40; i++) stepGame(state, []);
    expect(Math.abs(b.pos.x - player(state).pos.x)).toBeLessThan(startDist);
  });

  it('flees the player while the drill is active', () => {
    resetSeq();
    const state = makeState();
    startPlaying(state);
    clearPellets(state, [[1, 'normal']]);
    placePlayer(state, { x: 1, y: 7 }, null);
    player(state).powerTicks = state.config.powerTicks;
    placeBoulder(state, 'boulder-1', { x: 3, y: 7 }, 'left'); // heading toward player
    const b = state.boulders['boulder-1']!;
    // over the next junction decisions it should increase distance
    const d0 = Math.abs(b.pos.x - player(state).pos.x);
    for (let i = 0; i < 60; i++) stepGame(state, []);
    const d1 = Math.hypot(b.pos.x - player(state).pos.x, b.pos.y - player(state).pos.y);
    expect(d1).toBeGreaterThan(d0 - 30);
    expect(state.phase).toBe('playing'); // never caught
  });

  it('decisions at junctions are deterministic', () => {
    const run = () => {
      const state = makeState();
      startPlaying(state);
      clearPellets(state, [[1, 'normal']]);
      placePlayer(state, { x: 11, y: 7 }, null);
      placeBoulder(state, 'boulder-1', { x: 4, y: 1 }, 'right');
      for (let i = 0; i < 60; i++) stepGame(state, []);
      return JSON.stringify(state.boulders);
    };
    expect(run()).toBe(run());
  });

  it('re-aligns and keeps deciding after drifting off tile centers', () => {
    // Regression: powered speed changes mid-edge can leave a boulder off
    // center alignment. Decisions must fire at *crossed* centers, or the
    // boulder slides in a straight line through walls forever.
    resetSeq();
    const state = makeState();
    startPlaying(state);
    clearPellets(state, [[1, 'normal']]);
    placePlayer(state, { x: 6, y: 7 }, null);
    // x=96 is between centers (90 and 150) on the y=4 corridor
    placeBoulderAt(state, 'boulder-1', { x: 96, y: 270 }, 'right');
    const b = state.boulders['boulder-1']!;
    for (let i = 0; i < 300; i++) {
      stepGame(state, []);
      const t = posToTile(b.pos, state.config);
      expect(
        t.x >= 0 && t.x < miniMap.width && t.y >= 0 && t.y < miniMap.height,
      ).toBe(true);
      expect(isWalkable(miniMap, t)).toBe(true);
    }
  });
});
