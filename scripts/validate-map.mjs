#!/usr/bin/env node
/**
 * Validates the shipped Boulder Maze map against every structural rule.
 * Requires packages/core to be built (`npm run build` — the root
 * `npm run validate` script builds first automatically).
 */
import { BOULDER_MAZE_MAP, validateMap } from '@boulder-maze/core';

const result = validateMap(BOULDER_MAZE_MAP);
if (result.ok) {
  console.log(`map '${BOULDER_MAZE_MAP.id}' v${BOULDER_MAZE_MAP.version}: OK (${BOULDER_MAZE_MAP.width}x${BOULDER_MAZE_MAP.height})`);
  process.exit(0);
}
console.error(`map '${BOULDER_MAZE_MAP.id}' is INVALID:`);
for (const issue of result.issues) {
  const where = issue.tiles.length ? ` [${issue.tiles.map((t) => `(${t.x},${t.y})`).join(' ')}]` : '';
  console.error(`  ${issue.code}: ${issue.message}${where}`);
}
process.exit(1);
