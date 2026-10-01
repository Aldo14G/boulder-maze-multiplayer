import {
  allWalkableTiles,
  CHUTE_ENTRY,
  directionVector,
  isKnownTileChar,
  isWalkable,
  PELLET,
  playerSpawns,
  SUPER_PELLET,
  tileIndex,
  walkableNeighbors,
  WALL,
} from './map.js';
import type { MazeMap } from './map.js';
import type { TilePos } from './types.js';
import { DIR_VECTORS } from './types.js';

export interface MapIssue {
  /** Machine-readable rule identifier. */
  readonly code: string;
  readonly message: string;
  /** Offending tile coordinates, when applicable. */
  readonly tiles: readonly TilePos[];
}

export interface MapValidationResult {
  readonly ok: boolean;
  readonly issues: readonly MapIssue[];
}

function issue(code: string, message: string, tiles: TilePos[] = []): MapIssue {
  return { code, message, tiles };
}

const fmt = (t: TilePos) => `(${t.x},${t.y})`;

/**
 * Enforces the maze contract in code:
 *  - rectangular grid of known tile characters
 *  - every walkable tile has >= 2 walkable neighbours (no dead ends, and
 *    therefore no isolated stubs)
 *  - all walkable tiles form one connected component
 *  - no fully walkable 2x2 block (objective corridor-width check)
 *  - at least `minJunctions` tiles of degree 3 or 4
 *  - exactly one player spawn, on a walkable tile
 *  - every chute entry is walkable with degree >= 2, and its inward
 *    direction points into a walkable tile
 */
export function validateMap(map: MazeMap, minJunctions = 6): MapValidationResult {
  const issues: MapIssue[] = [];

  // ---- shape / characters -------------------------------------------------
  if (map.width <= 0 || map.height <= 0 || map.rows.length !== map.height) {
    issues.push(issue('shape', `map declares ${map.width}x${map.height} but has ${map.rows.length} rows`));
    return { ok: false, issues };
  }
  const badChars: TilePos[] = [];
  let rectangular = true;
  for (let y = 0; y < map.height; y++) {
    const row = map.rows[y]!;
    if (row.length !== map.width) {
      rectangular = false;
      issues.push(issue('shape', `row ${y} has length ${row.length}, expected ${map.width}`));
      continue;
    }
    for (let x = 0; x < map.width; x++) {
      if (!isKnownTileChar(row.charAt(x))) badChars.push({ x, y });
    }
  }
  if (badChars.length > 0) {
    issues.push(issue('unknown-tile', `unknown tile characters at ${badChars.map(fmt).join(' ')}`, badChars));
  }
  if (!rectangular || badChars.length > 0) return { ok: false, issues };

  const walkable = allWalkableTiles(map);
  if (walkable.length === 0) {
    issues.push(issue('empty', 'map has no walkable tiles'));
    return { ok: false, issues };
  }

  // ---- no dead ends --------------------------------------------------------
  const deadEnds = walkable.filter((t) => walkableNeighbors(map, t).length < 2);
  if (deadEnds.length > 0) {
    issues.push(
      issue('dead-end', `walkable tiles with fewer than 2 walkable neighbours: ${deadEnds.map(fmt).join(' ')}`, deadEnds),
    );
  }

  // ---- connectivity --------------------------------------------------------
  const component = floodComponent(map, walkable[0]!);
  const disconnected = walkable.filter((t) => !component.has(tileIndex(map, t)));
  if (disconnected.length > 0) {
    issues.push(
      issue(
        'disconnected',
        `walkable tiles not reachable from ${fmt(walkable[0]!)}: ${disconnected.map(fmt).join(' ')}`,
        disconnected,
      ),
    );
  }

  // ---- no 2x2 open blocks --------------------------------------------------
  const blocks: TilePos[] = [];
  for (let y = 0; y < map.height - 1; y++) {
    for (let x = 0; x < map.width - 1; x++) {
      const block = [
        { x, y },
        { x: x + 1, y },
        { x, y: y + 1 },
        { x: x + 1, y: y + 1 },
      ];
      if (block.every((t) => isWalkable(map, t))) blocks.push({ x, y });
    }
  }
  if (blocks.length > 0) {
    issues.push(
      issue('open-2x2', `fully walkable 2x2 blocks anchored at ${blocks.map(fmt).join(' ')}`, blocks),
    );
  }

  // ---- junction density ----------------------------------------------------
  const junctions = walkable.filter((t) => walkableNeighbors(map, t).length >= 3);
  if (junctions.length < minJunctions) {
    issues.push(
      issue('junctions', `only ${junctions.length} tiles of degree >= 3 (need >= ${minJunctions})`, junctions),
    );
  }

  // ---- player spawn ---------------------------------------------------------
  const spawns = playerSpawns(map);
  if (spawns.length !== 1) {
    issues.push(issue('player-spawn', `expected exactly 1 player spawn ('P'), found ${spawns.length}`, spawns));
  }

  // ---- chutes ----------------------------------------------------------------
  const seenChuteIds = new Set<string>();
  for (const chute of map.chutes) {
    if (seenChuteIds.has(chute.id)) {
      issues.push(issue('chute-id', `duplicate chute id '${chute.id}'`, [chute.entry]));
    }
    seenChuteIds.add(chute.id);
    if (!isWalkable(map, chute.entry)) {
      issues.push(
        issue('chute-entry', `chute '${chute.id}' entry ${fmt(chute.entry)} is not a walkable tile`, [chute.entry]),
      );
      continue;
    }
    if (walkableNeighbors(map, chute.entry).length < 2) {
      issues.push(
        issue(
          'chute-entry-degree',
          `chute '${chute.id}' entry ${fmt(chute.entry)} has fewer than 2 walkable neighbours`,
          [chute.entry],
        ),
      );
    }
    const { dx, dy } = directionVector(chute.inward);
    const ahead = { x: chute.entry.x + dx, y: chute.entry.y + dy };
    if (!isWalkable(map, ahead)) {
      issues.push(
        issue(
          'chute-inward',
          `chute '${chute.id}' inward direction leads into a non-walkable tile ${fmt(ahead)}`,
          [chute.entry, ahead],
        ),
      );
    }
  }
  for (const entry of walkable.filter((t) => tileCharAt(map, t) === CHUTE_ENTRY)) {
    if (!map.chutes.some((c) => c.entry.x === entry.x && c.entry.y === entry.y)) {
      issues.push(issue('chute-orphan', `'${CHUTE_ENTRY}' tile ${fmt(entry)} has no matching chute metadata`, [entry]));
    }
  }

  // ---- pellet sanity ---------------------------------------------------------
  const superCount = walkable.filter((t) => tileCharAt(map, t) === SUPER_PELLET).length;
  if (superCount === 0) {
    issues.push(issue('super-pellets', 'map places no Super Pellets', []));
  }
  const pelletCount = walkable.filter((t) => tileCharAt(map, t) === PELLET).length;
  if (pelletCount === 0) {
    issues.push(issue('pellets', 'map places no normal pellets', []));
  }

  return { ok: issues.length === 0, issues };
}

function tileCharAt(map: MazeMap, pos: TilePos): string {
  return map.rows[pos.y]!.charAt(pos.x);
}

function floodComponent(map: MazeMap, start: TilePos): Set<number> {
  const seen = new Set<number>();
  const stack: TilePos[] = [start];
  while (stack.length > 0) {
    const t = stack.pop()!;
    const idx = tileIndex(map, t);
    if (seen.has(idx) || !isWalkable(map, t)) continue;
    seen.add(idx);
    for (const v of Object.values(DIR_VECTORS)) {
      stack.push({ x: t.x + v.x, y: t.y + v.y });
    }
  }
  return seen;
}
