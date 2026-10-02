#!/usr/bin/env node
/**
 * Network smoke: boots the authoritative server on an ephemeral port, connects
 * two real WebSocket clients, plays a few seconds with scripted input, and
 * asserts both clients observe identical authoritative state at the same tick
 * (pellets, boulders, players, outcome). Run: npm run test:net
 */
import { BOULDER_MAZE_MAP } from '@boulder-maze/core';
import { applyDelta, PROTOCOL_VERSION, startServer } from '@boulder-maze/server';

const server = await startServer(0, { snapshotEvery: 3, keyframeEvery: 60 });
const url = `ws://127.0.0.1:${server.port}`;
const DIRS = ['left', 'up', 'right', 'down'];

function client(name) {
  const ws = new WebSocket(url);
  const c = { name, ws, playerId: null, snapshots: new Map(), state: null, events: 0, rejected: null, seq: 0, bytes: 0, deltas: 0, keyframes: 0, gaps: 0 };
  ws.addEventListener('message', (ev) => {
    c.bytes += ev.data.length;
    const msg = JSON.parse(ev.data);
    if (msg.t === 'welcome') c.playerId = msg.playerId;
    if (msg.t === 'reject') c.rejected = msg.reason;
    if (msg.t === 'start' || msg.t === 'snapshot') {
      if (msg.t === 'snapshot') c.keyframes += 1;
      c.state = msg.state;
    }
    if (msg.t === 'delta') {
      c.deltas += 1;
      const next = applyDelta(c.state, msg.delta);
      if (!next) c.gaps += 1;
      else c.state = next;
    }
    if (c.state && (msg.t === 'start' || msg.t === 'snapshot' || msg.t === 'delta')) c.snapshots.set(c.state.tick, c.state);
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

const t0 = performance.now();
for (let i = 0; i < 60; i++) {
  await sleep(50);
  a.send({ t: 'input', seq: ++a.seq, direction: DIRS[i % 4] });
  if (i % 3 === 0) b.send({ t: 'input', seq: ++b.seq, direction: DIRS[(i + 2) % 4] });
}
await sleep(100);

const elapsedS = (performance.now() - t0) / 1000;
const shared = [...a.snapshots.keys()].filter((t) => b.snapshots.has(t));
if (shared.length < 20) fail(`too few shared snapshot ticks: ${shared.length}`);
const canon = (s) => JSON.stringify(s, Object.keys(s).sort());
for (const t of shared) {
  if (canon(a.snapshots.get(t)) !== canon(b.snapshots.get(t))) fail(`state diverged at tick ${t}`);
}
if (a.deltas === 0 || a.keyframes === 0) fail(`expected deltas and keyframes, got ${a.deltas}/${a.keyframes}`);
if (a.gaps > 0) fail(`${a.gaps} deltas failed to apply`);
// a delta-reconstructed client must equal the authority at the latest shared tick
const authoritative = server.room.debugState();
const latest = Math.max(...shared);
if (authoritative.tick === latest && canon(a.snapshots.get(latest)) !== canon(authoritative)) fail('delta-reconstructed state differs from authority');
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
console.log(
  `net-smoke OK: shared=${shared.length} tick=${last.tick} phase=${last.phase} pellets=${last.pelletsRemaining} ` +
    `deltas=${a.deltas} keyframes=${a.keyframes} ${(a.bytes / 1024 / elapsedS).toFixed(0)} KB/s events(a)=${a.events}`,
);
