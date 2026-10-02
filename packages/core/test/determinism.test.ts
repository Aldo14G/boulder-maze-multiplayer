import { describe, expect, it } from 'vitest';
import {
  createGame,
  deserializeGame,
  serializeGame,
  stepGame,
} from '../src/index.js';
import type { Direction, PlayerCommand } from '../src/index.js';
import { BOULDER_MAZE_MAP, LOCAL_PLAYER_ID } from '../src/index.js';
import { miniMap } from './fixtures.js';
import { clearPellets, makeState, placePlayer, player, resetSeq, startPlaying } from './helpers.js';

/** A scripted tick-assigned input log: direction changes at fixed ticks. */
const SCRIPT: Array<{ at: number; direction: Direction }> = [
  { at: 130, direction: 'left' },
  { at: 160, direction: 'up' },
  { at: 200, direction: 'right' },
  { at: 250, direction: 'down' },
  { at: 320, direction: 'left' },
  { at: 400, direction: 'up' },
];

function runScripted(seed: number, ticks: number): ReturnType<typeof createGame> {
  const state = createGame(undefined, miniMap, seed);
  let seq = 0;
  for (let t = 1; t <= ticks; t++) {
    const commands: PlayerCommand[] = [];
    for (const s of SCRIPT) {
      if (s.at === state.tick + 1) {
        commands.push({ playerId: LOCAL_PLAYER_ID, direction: s.direction, seq: ++seq, tick: s.at });
      }
    }
    stepGame(state, commands);
  }
  return state;
}

describe('determinism', () => {
  it('replaying the same seed and input log reproduces identical state', () => {
    const a = runScripted(7, 500);
    const b = runScripted(7, 500);
    expect(serializeGame(a)).toBe(serializeGame(b));
  });

  it('different seeds/inputs can diverge but identical logs never do', () => {
    const a = runScripted(7, 500);
    const c = runScripted(8, 500);
    // rngState differs; gameplay itself stays deterministic
    expect(serializeGame(a)).not.toBe(serializeGame(c));
  });

  it('a JSON snapshot round-trip continues identically mid-edge, buffered turn, pending respawn', () => {
    resetSeq();
    const original = runScripted(7, 333);

    // ensure the fixture really contains the difficult branches
    const midEdge = Object.values(original.players).some((p) => p.pos.x % 60 !== 30 || p.pos.y % 60 !== 30);
    const buffered = Object.values(original.players).some((p) => p.bufferedDir !== null);
    const pendingRespawn = Object.values(original.boulders).some(
      (b) => b.status === 'pending' || b.status === 'destroyed',
    );
    expect(midEdge || buffered || pendingRespawn).toBe(true); // fixture sanity

    const restored = deserializeGame(serializeGame(original));
    for (let i = 0; i < 200; i++) stepGame(original, []);
    for (let i = 0; i < 200; i++) stepGame(restored, []);
    expect(serializeGame(restored)).toBe(serializeGame(original));
  });

  it('mid-edge position and buffered turn survive serialize/deserialize verbatim', () => {
    resetSeq();
    const state = makeState();
    startPlaying(state);
    clearPellets(state, [[1, 'normal']]);
    placePlayer(state, { x: 3, y: 4 }, 'right');
    stepGame(state, []); // move off the centre
    player(state).bufferedDir = 'down';
    const restored = deserializeGame(serializeGame(state));
    expect(restored.players[LOCAL_PLAYER_ID]!.pos).toEqual(state.players[LOCAL_PLAYER_ID]!.pos);
    expect(restored.players[LOCAL_PLAYER_ID]!.bufferedDir).toBe('down');
  });

  it('multiplayer: identical seed + generated input log reproduces identical state', () => {
    // property-style: for several seeds and input streams, two independent
    // replays of the same (seed, log) pair must serialize identically —
    // the invariant the shared-core prediction and reconciliation rely on.
    for (const seed of [1, 2, 3, 4, 5]) {
      for (const inputSeed of [11, 22]) {
        expect(serializeGame(runRandom(seed, inputSeed, 300))).toBe(
          serializeGame(runRandom(seed, inputSeed, 300)),
        );
      }
    }
  });
});

const MULTI_IDS = ['p-a', 'p-b', 'p-c', 'p-d'];
const DIRS: Direction[] = ['up', 'down', 'left', 'right'];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Four players, each randomly re-steering ~15% of ticks; a pure function of (seed, inputSeed). */
function runRandom(seed: number, inputSeed: number, ticks: number): ReturnType<typeof createGame> {
  const state = createGame(undefined, BOULDER_MAZE_MAP, seed, MULTI_IDS);
  const rand = mulberry32(inputSeed);
  const seq = new Map(MULTI_IDS.map((id) => [id, 0]));
  for (let t = 1; t <= ticks; t++) {
    const commands: PlayerCommand[] = [];
    for (const id of MULTI_IDS) {
      if (rand() < 0.15) {
        seq.set(id, seq.get(id)! + 1);
        commands.push({ playerId: id, direction: DIRS[Math.floor(rand() * 4)]!, seq: seq.get(id)!, tick: state.tick + 1 });
      }
    }
    stepGame(state, commands);
  }
  return state;
}
