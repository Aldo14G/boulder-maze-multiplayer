import { describe, expect, it } from 'vitest';
import { BOULDER_MAZE_MAP, createGame, stepGame } from '../src/index.js';
import {
  center,
  clearPellets,
  makeState,
  placePlayer,
  player,
  resetSeq,
  startPlaying,
} from './helpers.js';
import { miniMap } from './fixtures.js';

describe('boulder release and respawn', () => {
  it('staggers initial releases through the four chutes after the ready countdown', () => {
    resetSeq();
    const state = createGame(); // shipped map, spawn far from all entries
    const released: Array<{ tick: number; boulderId: string; pos: unknown; dir: unknown }> = [];
    for (let i = 0; i < state.readyUntilTick + 4 * state.config.releaseGapTicks + 5; i++) {
      for (const e of stepGame(state, [])) {
        if (e.type === 'boulderReleased') {
          const b = state.boulders[e.boulderId]!;
          released.push({ tick: e.tick, boulderId: e.boulderId, pos: { ...b.pos }, dir: b.dir });
        }
      }
    }
    expect(released.map((r) => r.boulderId)).toEqual(['boulder-1', 'boulder-2', 'boulder-3', 'boulder-4']);
    expect(released[0]!.tick).toBe(state.readyUntilTick);
    // releases happen no earlier than scheduled; chute-area safety may delay
    // one further (a released boulder's path can cross the next entry zone)
    const due = (i: number) => state.readyUntilTick + i * state.config.releaseGapTicks;
    released.forEach((r, i) => expect(r.tick).toBeGreaterThanOrEqual(due(i)));
    // each boulder emerges on its own chute entry tile, heading inward
    for (const r of released) {
      const chute = BOULDER_MAZE_MAP.chutes.find((c) => c.id === state.boulders[r.boulderId]!.chuteId)!;
      expect(r.pos).toEqual(center(chute.entry));
      expect(r.dir).toBe(chute.inward);
    }
  });

  it('delays activation while the player overlaps the entry area', () => {
    resetSeq();
    const state = makeState();
    startPlaying(state);
    // park the player on the single mini chute entry (1,4)
    placePlayer(state, { x: 1, y: 4 }, null);
    const b = state.boulders['boulder-1']!;
    b.releaseAtTick = state.tick; // due now, but blocked by the player
    for (let i = 0; i < 30; i++) stepGame(state, []);
    expect(b.status).toBe('pending');
    // move the player away -> releases on the next clear tick
    placePlayer(state, { x: 6, y: 7 }, null);
    const events = stepGame(state, []);
    expect(events.some((e) => e.type === 'boulderReleased')).toBe(true);
    expect(b.status).toBe('active');
    expect(b.pos).toEqual(center({ x: 1, y: 4 }));
    expect(b.dir).toBe('right');
  });

  it('destroyed boulders wait 3 s, warn, then re-enter through their chute', () => {
    resetSeq();
    const state = makeState();
    startPlaying(state);
    clearPellets(state, [[1, 'normal']]);
    placePlayer(state, { x: 6, y: 7 }, null);
    const b = state.boulders['boulder-1']!;
    b.status = 'destroyed';
    b.respawnTicksRemaining = state.config.respawnTicks;

    // exactly respawnTicks steps -> becomes pending
    let pendingAt = -1;
    for (let i = 0; i < state.config.respawnTicks + state.config.chuteWarnTicks + 5; i++) {
      const events = stepGame(state, []);
      if (b.status === 'pending' && pendingAt === -1) pendingAt = state.tick;
      if (events.some((e) => e.type === 'boulderReleased')) break;
    }
    expect(pendingAt).toBeGreaterThanOrEqual(state.config.respawnTicks);
    expect(b.status).toBe('active'); // area was clear -> released after warning window
    expect(b.pos).toEqual(center({ x: 1, y: 4 }));
  });

  it('emits a chute warning before activation', () => {
    resetSeq();
    const state = makeState();
    const warnTicks: number[] = [];
    const releaseTicks: number[] = [];
    for (let i = 0; i < state.readyUntilTick + 60; i++) {
      for (const e of stepGame(state, [])) {
        if (e.type === 'chuteWarning') warnTicks.push(e.tick);
        if (e.type === 'boulderReleased') releaseTicks.push(e.tick);
      }
    }
    expect(warnTicks.length).toBeGreaterThan(0);
    expect(Math.min(...releaseTicks) - Math.min(...warnTicks)).toBeGreaterThan(0);
  });
});
