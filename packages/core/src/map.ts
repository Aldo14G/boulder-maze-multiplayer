import type { Direction, TilePos } from './types.js';
import { DIR_VECTORS } from './types.js';

/**
 * Tile legend for the shipped maze (stored as readable rows in mapData.ts):
 *   '#'  wall
 *   '.'  walkable corridor tile containing a normal pellet
 *   'o'  walkable corridor tile containing a Super Pellet
 *   'P'  walkable corridor tile, player spawn (no pellet)
 *   'e'  walkable corridor tile, boulder chute entry (no pellet)
 *
 * Chutes are pure metadata (id + entry tile + inward direction); the chute
 * artwork drawn outside the maze is presentation only. The player can stand
 * on an entry tile but can never leave the board through a chute.
 */
export interface ChuteMeta {
  readonly id: string;
  /** Walkable boundary tile the boulder emerges onto. */
  readonly entry: TilePos;
  /** Direction the boulder travels when it enters the maze. */
  readonly inward: Direction;
}

export interface MazeMap {
  readonly id: string;
  readonly version: number;
  readonly width: number;
  readonly height: number;
  /** height strings of exactly width characters. */
  readonly rows: readonly string[];
  readonly chutes: readonly ChuteMeta[];
}

export const WALL = '#';
export const PELLET = '.';
export const SUPER_PELLET = 'o';
export const PLAYER_SPAWN = 'P';
export const CHUTE_ENTRY = 'e';

const WALKABLE_TILES: ReadonlySet<string> = new Set([PELLET, SUPER_PELLET, PLAYER_SPAWN, CHUTE_ENTRY]);
const KNOWN_TILES: ReadonlySet<string> = new Set([WALL, ...WALKABLE_TILES]);

export function tileIndex(map: MazeMap, pos: TilePos): number {
  return pos.y * map.width + pos.x;
}

export function tileAt(map: MazeMap, pos: TilePos): string {
  if (pos.x < 0 || pos.y < 0 || pos.x >= map.width || pos.y >= map.height) return WALL;
  return map.rows[pos.y]!.charAt(pos.x);
}

export function isWalkable(map: MazeMap, pos: TilePos): boolean {
  return WALKABLE_TILES.has(tileAt(map, pos));
}

export function isKnownTileChar(ch: string): boolean {
  return KNOWN_TILES.has(ch);
}

/** Orthogonal walkable neighbour tiles of `pos`. */
export function walkableNeighbors(map: MazeMap, pos: TilePos): TilePos[] {
  const out: TilePos[] = [];
  for (const v of Object.values(DIR_VECTORS)) {
    const n = { x: pos.x + v.x, y: pos.y + v.y };
    if (isWalkable(map, n)) out.push(n);
  }
  return out;
}

export function walkableDegree(map: MazeMap, pos: TilePos): number {
  return walkableNeighbors(map, pos).length;
}

export function allWalkableTiles(map: MazeMap): TilePos[] {
  const out: TilePos[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (WALKABLE_TILES.has(map.rows[y]!.charAt(x))) out.push({ x, y });
    }
  }
  return out;
}

export function playerSpawns(map: MazeMap): TilePos[] {
  const out: TilePos[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.rows[y]!.charAt(x) === PLAYER_SPAWN) out.push({ x, y });
    }
  }
  return out;
}

export function directionVector(dir: Direction): { dx: number; dy: number } {
  const v = DIR_VECTORS[dir];
  return { dx: v.x, dy: v.y };
}
