import { describe, expect, it } from 'vitest';
import {
  allWalkableTiles,
  BOULDER_MAZE_MAP,
  createGame,
  isWalkable,
  validateMap,
  walkableNeighbors,
} from '../src/index.js';
import {
  badCharsMap,
  badChuteEntryMap,
  badChuteInwardMap,
  deadEndMap,
  disconnectedMap,
  malformedMap,
  miniMap,
  noSpawnMap,
  openAreaMap,
  orphanChuteMap,
} from './fixtures.js';

const codes = (m: Parameters<typeof validateMap>[0]) => validateMap(m).issues.map((i) => i.code);

describe('shipped map', () => {
  it('passes full validation', () => {
    const result = validateMap(BOULDER_MAZE_MAP);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('satisfies the structural rules explicitly', () => {
    const walkable = allWalkableTiles(BOULDER_MAZE_MAP);
    // every playable tile has >= 2 neighbours
    for (const t of walkable) {
      expect(walkableNeighbors(BOULDER_MAZE_MAP, t).length).toBeGreaterThanOrEqual(2);
    }
    // at least six junction tiles of degree >= 3
    const junctions = walkable.filter((t) => walkableNeighbors(BOULDER_MAZE_MAP, t).length >= 3);
    expect(junctions.length).toBeGreaterThanOrEqual(6);
    // super pellets and chutes
    const supers = BOULDER_MAZE_MAP.rows.join('').split('').filter((c) => c === 'o').length;
    expect(supers).toBe(4);
    expect(BOULDER_MAZE_MAP.chutes).toHaveLength(4);
    for (const chute of BOULDER_MAZE_MAP.chutes) {
      expect(isWalkable(BOULDER_MAZE_MAP, chute.entry)).toBe(true);
      expect(walkableNeighbors(BOULDER_MAZE_MAP, chute.entry).length).toBeGreaterThanOrEqual(2);
      expect(chute.entry.x === 1 || chute.entry.x === BOULDER_MAZE_MAP.width - 2).toBe(true);
    }
    expect(BOULDER_MAZE_MAP.version).toBe(1);
    expect(BOULDER_MAZE_MAP.id).toBe('boulder-maze');
  });

  it('has no wraparound: map borders are walls', () => {
    for (let x = 0; x < BOULDER_MAZE_MAP.width; x++) {
      expect(BOULDER_MAZE_MAP.rows[0]!.charAt(x)).toBe('#');
      expect(BOULDER_MAZE_MAP.rows[BOULDER_MAZE_MAP.height - 1]!.charAt(x)).toBe('#');
    }
    for (let y = 0; y < BOULDER_MAZE_MAP.height; y++) {
      expect(BOULDER_MAZE_MAP.rows[y]!.charAt(0)).toBe('#');
      expect(BOULDER_MAZE_MAP.rows[y]!.charAt(BOULDER_MAZE_MAP.width - 1)).toBe('#');
    }
  });
});

describe('invalid map fixtures', () => {
  it('reports disconnected tiles', () => {
    expect(codes(disconnectedMap)).toContain('disconnected');
  });

  it('reports dead ends', () => {
    expect(codes(deadEndMap)).toContain('dead-end');
  });

  it('reports fully walkable 2x2 blocks', () => {
    expect(codes(openAreaMap)).toContain('open-2x2');
  });

  it('reports chute entries on non-walkable tiles', () => {
    expect(codes(badChuteEntryMap)).toContain('chute-entry');
  });

  it('reports inward directions that hit a wall', () => {
    expect(codes(badChuteInwardMap)).toContain('chute-inward');
  });

  it('reports orphaned e tiles', () => {
    expect(codes(orphanChuteMap)).toContain('chute-orphan');
  });

  it('reports a missing player spawn', () => {
    expect(codes(noSpawnMap)).toContain('player-spawn');
  });

  it('reports malformed shapes and unknown characters', () => {
    expect(codes(malformedMap)).toContain('shape');
    expect(codes(badCharsMap)).toContain('unknown-tile');
  });

  it('issues carry tile coordinates', () => {
    const result = validateMap(deadEndMap);
    const deadEnd = result.issues.find((i) => i.code === 'dead-end')!;
    expect(deadEnd.tiles.length).toBeGreaterThan(0);
    expect(deadEnd.tiles[0]).toMatchObject({ x: 6, y: 3 });
  });
});

describe('createGame', () => {
  it('rejects an invalid map with actionable detail', () => {
    expect(() => createGame(undefined, deadEndMap)).toThrow(/dead-end/);
  });

  it('creates a ready-phase game with pellets on every eligible tile', () => {
    const state = createGame();
    expect(state.phase).toBe('ready');
    const walkable = allWalkableTiles(BOULDER_MAZE_MAP).length;
    // pellets excluded only on the player spawn and the four chute entries
    expect(state.pelletsRemaining).toBe(walkable - 1 - 4);
    expect(Object.keys(state.players)).toEqual(['player-1']);
    expect(Object.keys(state.boulders)).toHaveLength(4);
    expect(Object.values(state.boulders).every((b) => b.status === 'pending')).toBe(true);
  });

  it('accepts a small valid map', () => {
    const state = createGame(undefined, miniMap);
    expect(state.mapId).toBe('test-mini');
  });
});
