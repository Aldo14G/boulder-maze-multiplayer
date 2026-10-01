import type { MazeMap } from '../src/map.js';

/**
 * Purpose-built maps for exercising validation failures and small gameplay
 * scenarios. The shipped map lives in src/mapData.ts — these are test-only.
 */

/** Small fully valid map: two interior vertical corridors inside a ring. */
export const miniMap: MazeMap = {
  id: 'test-mini',
  version: 1,
  width: 13,
  height: 9,
  rows: [
    '#############',
    '#o.........o#',
    '#.##.###.##.#',
    '#.##.###.##.#',
    '#e..........#',
    '#.##.###.##.#',
    '#.##.###.##.#',
    '#.....P.....#',
    '#############',
  ],
  chutes: [{ id: 'chute-west', entry: { x: 1, y: 4 }, inward: 'right' }],
};

/** Two isolated rings — violates connectivity. */
export const disconnectedMap: MazeMap = {
  id: 'test-disconnected',
  version: 1,
  width: 13,
  height: 9,
  rows: [
    '#############',
    '#...........#',
    '#.#########.#',
    '#.###...###.#',
    '#.###.#.###.#',
    '#.###...###.#',
    '#.#########.#',
    '#......P....#',
    '#############',
  ],
  chutes: [{ id: 'chute-a', entry: { x: 1, y: 1 }, inward: 'right' }],
};

/** Corridor stub ending in a dead end at (6,3). */
export const deadEndMap: MazeMap = {
  id: 'test-dead-end',
  version: 1,
  width: 13,
  height: 9,
  rows: [
    '#############',
    '#...........#',
    '#.####.####.#',
    '#.####.####.#',
    '#.#########.#',
    '#.#########.#',
    '#.#########.#',
    '#......P....#',
    '#############',
  ],
  chutes: [{ id: 'chute-a', entry: { x: 1, y: 1 }, inward: 'right' }],
};

/** Ring with a walkable 2x2 bulge at (6..7, 2..3). */
export const openAreaMap: MazeMap = {
  id: 'test-open-2x2',
  version: 1,
  width: 13,
  height: 9,
  rows: [
    '#############',
    '#...........#',
    '#.####..###.#',
    '#.####..###.#',
    '#.#########.#',
    '#.#########.#',
    '#.#########.#',
    '#......P....#',
    '#############',
  ],
  chutes: [{ id: 'chute-a', entry: { x: 1, y: 4 }, inward: 'right' }],
};

/** Chute entry references a wall tile. */
export const badChuteEntryMap: MazeMap = {
  ...miniMap,
  id: 'test-bad-chute-entry',
  chutes: [{ id: 'chute-bad', entry: { x: 3, y: 3 }, inward: 'down' }],
};

/** Chute entry is walkable but inward points at a wall. */
export const badChuteInwardMap: MazeMap = {
  ...miniMap,
  id: 'test-bad-chute-inward',
  chutes: [{ id: 'chute-bad', entry: { x: 1, y: 2 }, inward: 'left' }],
};

/** A chute-entry 'e' tile with no matching chute metadata. */
export const orphanChuteMap: MazeMap = {
  ...miniMap,
  id: 'test-orphan-chute',
  chutes: [],
};

/** Map with no player spawn at all. */
export const noSpawnMap: MazeMap = {
  ...miniMap,
  id: 'test-no-spawn',
  rows: miniMap.rows.map((r) => r.replace('P', '.')),
};

/** Declared height does not match the row count. */
export const malformedMap: MazeMap = {
  id: 'test-malformed',
  version: 1,
  width: 5,
  height: 3,
  rows: ['#####', '#.?P#', '#####', 'extra'],
  chutes: [],
};

/** Unknown tile character inside an otherwise shaped grid. */
export const badCharsMap: MazeMap = {
  id: 'test-bad-chars',
  version: 1,
  width: 13,
  height: 9,
  rows: miniMap.rows.map((r) => r.replace('P', '?')),
  chutes: miniMap.chutes,
};
