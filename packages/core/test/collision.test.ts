import { describe, expect, it } from 'vitest';
import { stepGame } from '../src/index.js';
import {
  center,
  clearPellets,
  makeState,
  placeBoulder,
  placeBoulderAt,
  placePlayer,
  player,
  resetSeq,
  startPlaying,
} from './helpers.js';
import { DEFAULT_CONFIG } from '../src/index.js';
import { miniMap } from './fixtures.js';

function baseState() {
  resetSeq();
  const state = makeState();
  startPlaying(state);
  clearPellets(state, [[1, 'normal']]);
  return state;
}

describe('contact', () => {
  it('unpowered contact with an active boulder is lethal', () => {
    const state = baseState();
    placePlayer(state, { x: 4, y: 4 }, 'right');
    placeBoulder(state, 'boulder-1', { x: 8, y: 4 }, 'left');
    let events: ReturnType<typeof stepGame> = [];
    for (let i = 0; i < 30 && state.phase === 'playing'; i++) {
      events = events.concat(stepGame(state, []));
    }
    expect(state.phase).toBe('lost');
    expect(events.some((e) => e.type === 'playerDefeated' && e.boulderId === 'boulder-1')).toBe(true);
  });

  it('a stationary overlap is still contact', () => {
    const state = baseState();
    placePlayer(state, { x: 4, y: 4 }, null);
    placeBoulderAt(state, 'boulder-1', center({ x: 4, y: 4 }), 'left');
    const events = stepGame(state, []);
    expect(events.some((e) => e.type === 'playerDefeated')).toBe(true);
    expect(state.phase).toBe('lost');
  });

  it('catches opposing entities that cross inside one tick (swept segments)', () => {
    const fast = { ...DEFAULT_CONFIG, boulderSpeed: 95 };
    const state = makeState(miniMap, fast);
    resetSeq();
    startPlaying(state);
    clearPellets(state, [[1, 'normal']]);
    // player: tile (2,4) centre moving right at 5/tick -> [150,155]
    // boulder: x=200 moving left at 95/tick -> [200,105]
    // endpoints land 50 units apart (> contactRadius 24) yet the swept
    // segments overlap -> the crossing is contact, not a pass-through.
    placePlayer(state, { x: 2, y: 4 }, 'right');
    placeBoulderAt(state, 'boulder-1', { x: 200, y: 4 * 60 + 30 }, 'left');
    const events = stepGame(state, []);
    expect(events.some((e) => e.type === 'playerDefeated')).toBe(true);
    expect(state.phase).toBe('lost');
    // sanity: endpoints really did finish on opposite sides
    expect(player(state).pos.x).toBe(155);
    expect(state.boulders['boulder-1']!.pos.x).toBe(105);
  });

  it('detects no contact through walls between parallel corridors', () => {
    const state = makeState();
    resetSeq();
    startPlaying(state);
    clearPellets(state, [[1, 'normal']]);
    // mini map: corridor row y=4 and the ring row y=1, wall rows between
    placePlayer(state, { x: 6, y: 4 }, 'left');
    placeBoulder(state, 'boulder-1', { x: 6, y: 1 }, 'left');
    let events: ReturnType<typeof stepGame> = [];
    for (let i = 0; i < 30; i++) events = events.concat(stepGame(state, []));
    expect(events.some((e) => e.type === 'playerDefeated')).toBe(false);
    expect(state.phase).toBe('playing');
  });

  it('destroyed boulders cause no contact', () => {
    const state = baseState();
    placePlayer(state, { x: 4, y: 4 }, 'right');
    const b = state.boulders['boulder-1']!;
    b.status = 'destroyed';
    b.pos = center({ x: 4, y: 4 });
    const events = stepGame(state, []);
    expect(events.some((e) => e.type === 'playerDefeated')).toBe(false);
    expect(state.phase).toBe('playing');
  });
});
