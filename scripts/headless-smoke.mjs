#!/usr/bin/env node
/**
 * Headless smoke test: proves @boulder-maze/core runs in a real Node process
 * (no browser, no DOM, no Phaser). Advances a seeded game 1200 ticks with a
 * scripted input log and asserts basic invariants. Run: npm run smoke
 */
import {
  BOULDER_MAZE_MAP,
  createGame,
  deserializeGame,
  isWalkable,
  LOCAL_PLAYER_ID,
  posToTile,
  serializeGame,
  stepGame,
} from '@boulder-maze/core';

const DIRS = ['left', 'up', 'right', 'down'];
const state = createGame(undefined, BOULDER_MAZE_MAP, 42);
let seq = 0;
let events = 0;

for (let t = 1; t <= 1200; t++) {
  const commands = [];
  if (t % 47 === 0) {
    commands.push({ playerId: LOCAL_PLAYER_ID, direction: DIRS[(t / 47) % 4 | 0], seq: ++seq, tick: t });
  }
  events += stepGame(state, commands).length;
  for (const p of Object.values(state.players)) {
    const tile = posToTile(p.pos, state.config);
    if (!isWalkable(state.map, tile)) {
      console.error(`FAIL: player inside wall at (${tile.x},${tile.y}) on tick ${t}`);
      process.exit(1);
    }
  }
}

// snapshot round-trip mid-run
const restored = deserializeGame(serializeGame(state));
for (let i = 0; i < 60; i++) stepGame(state, []);
for (let i = 0; i < 60; i++) stepGame(restored, []);
if (serializeGame(restored) !== serializeGame(state)) {
  console.error('FAIL: snapshot round-trip diverged');
  process.exit(1);
}

const player = state.players[LOCAL_PLAYER_ID];
console.log(
  `smoke OK: tick=${state.tick} phase=${state.phase} score=${player.score} ` +
    `pellets=${state.pelletsRemaining} events=${events}`,
);
