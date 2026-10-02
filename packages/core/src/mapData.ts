import type { MazeMap } from './map.js';

/**
 * The shipped Boulder Maze map: a 25x21 lattice of one-tile-wide loops.
 * Legend — see map.ts. No wraparound tunnels in this baseline.
 *
 * Chute entries (west side: rows 10 and 17; east side: rows 3 and 10) feed
 * directly into the boundary corridors; every entry tile has degree >= 3.
 *
 * v2: four player spawns on the bottom row (x = 6, 10, 14, 18) so up to
 * MAX_PLAYERS start on distinct tiles, all far from the chute entries.
 */
export const BOULDER_MAZE_MAP: MazeMap = {
  id: 'boulder-maze',
  version: 2,
  width: 25,
  height: 21,
  rows: [
    '#########################',
    '#o.....................o#',
    '#.##.#######.#######.##.#',
    '#.##.#######...........e#',
    '#.##.#######.#######.##.#',
    '#.##.................##.#',
    '#.##.###.###.###.###.##.#',
    '#.##.###.........###.##.#',
    '#.##.###.###.###.###.##.#',
    '#.##.###.###.###.###.##.#',
    '#e.....................e#',
    '#.##.###.###.###.###.##.#',
    '#.##.###.###.###.###.##.#',
    '#.##.....###.###.....##.#',
    '#.##.###.###.###.###.##.#',
    '#.##.................##.#',
    '#.##.#######.#######.##.#',
    '#e...........#######.##.#',
    '#.##.#######.#######.##.#',
    '#o....P...P...P...P....o#',
    '#########################',
  ],
  chutes: [
    { id: 'chute-west-high', entry: { x: 1, y: 10 }, inward: 'right' },
    { id: 'chute-west-low', entry: { x: 1, y: 17 }, inward: 'right' },
    { id: 'chute-east-high', entry: { x: 23, y: 3 }, inward: 'left' },
    { id: 'chute-east-low', entry: { x: 23, y: 10 }, inward: 'left' },
  ],
};
