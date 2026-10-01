import { describe, expect, it } from 'vitest';
import { stepGame, tileIndex } from '../src/index.js';
import {
  clearPellets,
  makeState,
  placeBoulder,
  placeBoulderAt,
  placePlayer,
  player,
  resetSeq,
  startPlaying,
  suppressBoulders,
} from './helpers.js';
import { miniMap } from './fixtures.js';

function poweredState() {
  resetSeq();
  const state = makeState();
  startPlaying(state);
  suppressBoulders(state);
  clearPellets(state, [[tileIndex(miniMap, { x: 5, y: 7 }), 'normal']]);
  placePlayer(state, { x: 6, y: 7 }, null);
  player(state).powerTicks = state.config.powerTicks;
  return state;
}

describe('drill power', () => {
  it('a second Super Pellet resets the duration instead of adding', () => {
    resetSeq();
    const state = makeState();
    startPlaying(state);
    suppressBoulders(state);
    const a = tileIndex(miniMap, { x: 2, y: 7 });
    const b = tileIndex(miniMap, { x: 1, y: 1 });
    clearPellets(state, [[a, 'super'], [b, 'super'], [tileIndex(miniMap, { x: 5, y: 7 }), 'normal']]);

    placePlayer(state, { x: 2, y: 7 }, 'right');
    stepGame(state, []);
    expect(player(state).powerTicks).toBe(480);
    for (let i = 0; i < 100; i++) stepGame(state, []); // ~1.7 s pass

    // teleport onto the second pellet tile
    placePlayer(state, { x: 1, y: 1 }, 'right');
    stepGame(state, []);
    expect(player(state).powerTicks).toBe(480); // reset, not 480 + remainder
  });

  it('expires on the exact tick boundary and emits powerEnded once', () => {
    const state = poweredState();
    player(state).powerTicks = 3;
    let events = stepGame(state, []);
    expect(player(state).powerTicks).toBe(2);
    expect(events.some((e) => e.type === 'powerEnded')).toBe(false);
    events = events.concat(stepGame(state, []));
    events = events.concat(stepGame(state, []));
    expect(player(state).powerTicks).toBe(0);
    expect(events.filter((e) => e.type === 'powerEnded')).toHaveLength(1);
    // stays 0, no repeat events
    events = stepGame(state, []);
    expect(player(state).powerTicks).toBe(0);
    expect(events.some((e) => e.type === 'powerEnded')).toBe(false);
  });

  it('powered contact destroys the boulder for 200 points', () => {
    const state = poweredState();
    player(state).powerTicks = 100;
    // boulder already mid-edge, bearing down on the player — no junction
    // decision can route it away before contact
    placeBoulderAt(state, 'boulder-1', { x: 420, y: 7 * 60 + 30 }, 'left');
    let events: ReturnType<typeof stepGame> = [];
    for (let i = 0; i < 30 && !events.some((e) => e.type === 'boulderDestroyed'); i++) {
      events = events.concat(stepGame(state, []));
    }
    expect(events.some((e) => e.type === 'boulderDestroyed' && e.boulderId === 'boulder-1')).toBe(true);
    expect(state.boulders['boulder-1']!.status).toBe('destroyed');
    expect(player(state).score).toBe(200);
    expect(state.phase).toBe('playing');
  });

  it('a Super Pellet collected this tick arms the drill before contact resolution', () => {
    resetSeq();
    const state = makeState();
    startPlaying(state);
    const pelletTile = { x: 6, y: 7 };
    clearPellets(state, [[tileIndex(miniMap, pelletTile), 'super'], [tileIndex(miniMap, { x: 1, y: 1 }), 'normal']]);
    // player enters the pellet tile this tick; boulder already sits inside it
    placePlayer(state, { x: 5, y: 7 }, 'right');
    player(state).pos = { x: 6 * 60 - 1, y: 7 * 60 + 30 }; // 1 unit before the boundary
    placeBoulderAt(state, 'boulder-1', { x: 6 * 60 + 10, y: 7 * 60 + 30 }, 'left');

    const events = stepGame(state, []);
    expect(events.some((e) => e.type === 'powerStarted')).toBe(true);
    expect(events.some((e) => e.type === 'boulderDestroyed')).toBe(true);
    expect(events.some((e) => e.type === 'playerDefeated')).toBe(false);
    expect(state.phase).toBe('playing');
  });

  it('drill does not excavate: walls and pellets are untouched by powered movement', () => {
    const state = poweredState();
    const pelletsBefore = state.pelletsRemaining;
    const mapBefore = state.map.rows.join('');
    for (let i = 0; i < 60; i++) stepGame(state, []);
    expect(state.map.rows.join('')).toBe(mapBefore);
    expect(state.pelletsRemaining).toBeLessThanOrEqual(pelletsBefore);
  });
});
