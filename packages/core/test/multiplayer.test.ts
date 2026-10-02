import { describe, expect, it } from 'vitest';
import {
  BOULDER_MAZE_MAP,
  createGame,
  DEFAULT_CONFIG,
  forfeitPlayer,
  MAX_PLAYERS,
  playerSpawns,
  posToTile,
  stepGame,
  tileIndex,
  validateMap,
} from '../src/index.js';
import { center, clearPellets, placeBoulder, resetSeq, startPlaying, suppressBoulders } from './helpers.js';
import { miniMap } from './fixtures.js';

const IDS = ['p-a', 'p-b', 'p-c', 'p-d'];

function multi(ids: readonly string[] = IDS.slice(0, 2), map = miniMap) {
  const state = createGame(DEFAULT_CONFIG, map, 7, ids);
  startPlaying(state);
  suppressBoulders(state);
  return state;
}

function place(state: ReturnType<typeof multi>, id: string, tile: { x: number; y: number }, dir: 'up' | 'down' | 'left' | 'right' | null = null) {
  const p = state.players[id]!;
  p.pos = center(tile, state.config);
  p.dir = dir;
  p.bufferedDir = null;
}

describe('multiplayer core', () => {
  it('shipped map v2 offers one spawn per supported player', () => {
    expect(BOULDER_MAZE_MAP.version).toBe(2);
    expect(playerSpawns(BOULDER_MAZE_MAP)).toHaveLength(MAX_PLAYERS);
    expect(validateMap(BOULDER_MAZE_MAP).ok).toBe(true);
  });

  it('creates one alive player per id on distinct spawns, in id order', () => {
    const state = createGame(DEFAULT_CONFIG, BOULDER_MAZE_MAP, 1, IDS);
    expect(Object.keys(state.players).sort()).toEqual([...IDS].sort());
    const tiles = new Set(IDS.map((id) => tileIndex(BOULDER_MAZE_MAP, posToTile(state.players[id]!.pos))));
    expect(tiles.size).toBe(IDS.length);
    for (const id of IDS) expect(state.players[id]!.alive).toBe(true);
  });

  it('keeps the single-player default intact', () => {
    const state = createGame();
    expect(Object.keys(state.players)).toEqual(['player-1']);
  });

  it('rejects more ids than spawns can host or duplicate ids', () => {
    expect(() => createGame(DEFAULT_CONFIG, BOULDER_MAZE_MAP, 1, [...IDS, 'p-e'])).toThrow(/players/);
    expect(() => createGame(DEFAULT_CONFIG, miniMap, 1, ['x', 'x'])).toThrow(/duplicate/);
  });

  it('a defeated player becomes a spectator and the run continues', () => {
    resetSeq();
    const state = multi();
    clearPellets(state, [[1, 'normal']]);
    place(state, 'p-a', { x: 4, y: 4 });
    place(state, 'p-b', { x: 11, y: 7 });
    placeBoulder(state, 'boulder-1', { x: 4, y: 4 }, 'left');
    const events = stepGame(state, []);
    expect(events.some((e) => e.type === 'playerDefeated' && e.playerId === 'p-a')).toBe(true);
    expect(state.players['p-a']!.alive).toBe(false);
    expect(state.players['p-b']!.alive).toBe(true);
    expect(state.phase).toBe('playing');
  });

  it('the run is lost only when every player is defeated', () => {
    resetSeq();
    const state = multi();
    clearPellets(state, [[1, 'normal']]);
    place(state, 'p-a', { x: 4, y: 4 });
    place(state, 'p-b', { x: 8, y: 4 });
    placeBoulder(state, 'boulder-1', { x: 4, y: 4 }, 'left');
    stepGame(state, []);
    expect(state.phase).toBe('playing');
    state.boulders['boulder-1']!.pos = center({ x: 8, y: 4 }, state.config);
    stepGame(state, []);
    expect(state.players['p-b']!.alive).toBe(false);
    expect(state.phase).toBe('lost');
  });

  it('spectators neither move, collect pellets nor touch boulders', () => {
    resetSeq();
    const state = multi();
    const idx = tileIndex(miniMap, { x: 6, y: 4 });
    clearPellets(state, [[idx, 'normal'], [1, 'normal']]);
    place(state, 'p-a', { x: 5, y: 4 }, 'right');
    state.players['p-a']!.alive = false;
    place(state, 'p-b', { x: 11, y: 7 });
    placeBoulder(state, 'boulder-1', { x: 5, y: 4 }, 'left');
    const before = { ...state.players['p-a']!.pos };
    const events = stepGame(state, []);
    expect(state.players['p-a']!.pos).toEqual(before);
    expect(state.pellets[idx]).toBe('normal');
    expect(events.some((e) => e.type === 'playerDefeated')).toBe(false);
    expect(state.phase).toBe('playing');
  });

  it('the team wins when the last pellet falls, credited to the collector', () => {
    resetSeq();
    const state = multi();
    const last = tileIndex(miniMap, { x: 5, y: 7 });
    clearPellets(state, [[last, 'normal']]);
    place(state, 'p-a', { x: 1, y: 1 });
    place(state, 'p-b', { x: 5, y: 7 }, 'right');
    const events = stepGame(state, []);
    expect(state.phase).toBe('won');
    expect(events.find((e) => e.type === 'gameWon')).toMatchObject({ playerId: 'p-b' });
  });

  it('forfeiting removes a player from play and can end the run', () => {
    resetSeq();
    const state = multi();
    clearPellets(state, [[1, 'normal']]);
    let events = forfeitPlayer(state, 'p-a');
    expect(events).toEqual([expect.objectContaining({ type: 'playerForfeited', playerId: 'p-a' })]);
    expect(state.players['p-a']!.alive).toBe(false);
    expect(state.phase).toBe('playing');
    expect(forfeitPlayer(state, 'p-a')).toEqual([]); // idempotent
    expect(forfeitPlayer(state, 'ghost')).toEqual([]);
    events = forfeitPlayer(state, 'p-b');
    expect(events.some((e) => e.type === 'playerForfeited')).toBe(true);
    expect(state.phase).toBe('lost');
    expect(stepGame(state, [])).toEqual([]);
  });

  it('boulders chase the nearest alive player', () => {
    resetSeq();
    const state = multi();
    clearPellets(state, [[1, 'normal']]);
    // p-a sorts first but is dead and sits right next to the boulder
    place(state, 'p-a', { x: 2, y: 4 });
    state.players['p-a']!.alive = false;
    place(state, 'p-b', { x: 11, y: 4 });
    placeBoulder(state, 'boulder-1', { x: 4, y: 4 }, 'up');
    for (let i = 0; i < 40; i++) stepGame(state, []);
    const b = state.boulders['boulder-1']!;
    expect(b.pos.x).toBeGreaterThan(center({ x: 4, y: 4 }).x); // moved toward p-b, not p-a
  });
});
