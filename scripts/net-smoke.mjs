#!/usr/bin/env node
/**
 * Network smoke: boots the authoritative server on an ephemeral port, connects
 * two real WebSocket clients, plays a few seconds with scripted input, and
 * asserts both clients observe identical authoritative state at the same tick
 * (pellets, boulders, players, outcome). Run: npm run test:net
 */
import { BOULDER_MAZE_MAP } from '@boulder-maze/core';
import { PROTOCOL_VERSION, startServer } from '@boulder-maze/server';

const server = await startServer(0, { snapshotEvery: 3 });
const url = `ws://127.0.0.1:${server.port}`;
const DIRS = ['left', 'up', 'right', 'down'];

function client(name) {
  const ws = new WebSocket(url);
  const c = { name, ws, playerId: null, snapshots: new Map(), events: 0, rejected: null, seq: 0 };
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.t === 'welcome') c.playerId = msg.playerId;
    if (msg.t === 'reject') c.rejected = msg.reason;
    if (msg.t === 'start' || msg.t === 'snapshot') c.snapshots.set(msg.state.tick, msg.state);
    if (msg.t === 'events') c.events += msg.events.length;
  });
  c.open = new Promise((res) => ws.addEventListener('open', res));
  c.send = (m) => ws.send(JSON.stringify(m));
  return c;
}

const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  process.exitCode = 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const a = client('ana');
const b = client('bob');
await Promise.all([a.open, b.open]);
for (const c of [a, b]) c.send({ t: 'join', name: c.name, protocol: PROTOCOL_VERSION, mapId: BOULDER_MAZE_MAP.id, mapVersion: BOULDER_MAZE_MAP.version });
await sleep(50);
if (!a.playerId || !b.playerId) fail(`welcome missing: ${a.playerId} / ${b.playerId}`);
for (const c of [a, b]) c.send({ t: 'ready', ready: true });

for (let i = 0; i < 40; i++) {
  await sleep(50);
  a.send({ t: 'input', seq: ++a.seq, direction: DIRS[i % 4] });
  if (i % 3 === 0) b.send({ t: 'input', seq: ++b.seq, direction: DIRS[(i + 2) % 4] });
}
await sleep(100);

const shared = [...a.snapshots.keys()].filter((t) => b.snapshots.has(t));
if (shared.length < 20) fail(`too few shared snapshot ticks: ${shared.length}`);
for (const t of shared) {
  const sa = a.snapshots.get(t);
  const sb = b.snapshots.get(t);
  if (JSON.stringify(sa) !== JSON.stringify(sb)) fail(`state diverged at tick ${t}`);
}
const last = a.snapshots.get(Math.max(...shared));
if (!last || Object.keys(last.players).length !== 2) fail('expected two players in authoritative state');
if (last.tick < 100) fail(`server barely advanced: tick=${last.tick}`);
const moved = Object.values(last.players).some((p) => p.lastCommandSeq > 0);
if (!moved) fail('no client input reached the sim');

a.ws.close();
await sleep(50);
if (server.room.phase === 'running' && server.room.debugState().players[a.playerId].alive) fail('disconnect did not forfeit the player');

b.ws.close();
await server.close();
if (process.exitCode) process.exit(1);
console.log(`net-smoke OK: shared=${shared.length} tick=${last.tick} phase=${last.phase} pellets=${last.pelletsRemaining} events(a)=${a.events}`);
