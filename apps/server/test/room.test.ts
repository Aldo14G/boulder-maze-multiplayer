import { describe, expect, it } from 'vitest';
import { BOULDER_MAZE_MAP } from '@boulder-maze/core';
import { PROTOCOL_VERSION, parseClientMessage, Room } from '../src/index.js';
import type { ServerMessage } from '../src/index.js';

const TICK_MS = 1000 / 60;

function harness(opts = {}) {
  const outbox: Array<{ to: string; msg: ServerMessage }> = [];
  const room = new Room((to, msg) => outbox.push({ to, msg }), { snapshotEvery: 3, ...opts });
  const join = (name: string) => {
    const id = room.connect()!;
    room.handle(id, { t: 'join', name, protocol: PROTOCOL_VERSION, mapId: BOULDER_MAZE_MAP.id, mapVersion: BOULDER_MAZE_MAP.version });
    return id;
  };
  const sent = (to: string, t: ServerMessage['t']) => outbox.filter((o) => o.to === to && o.msg.t === t).map((o) => o.msg);
  return { room, outbox, join, sent };
}

describe('Room', () => {
  it('welcomes a compatible client and rejects protocol or map mismatches', () => {
    const { room, join, sent } = harness();
    const a = join('ana');
    expect(sent(a, 'welcome')).toHaveLength(1);
    const b = room.connect()!;
    room.handle(b, { t: 'join', name: 'bob', protocol: PROTOCOL_VERSION + 1, mapId: BOULDER_MAZE_MAP.id, mapVersion: BOULDER_MAZE_MAP.version });
    room.handle(b, { t: 'join', name: 'bob', protocol: PROTOCOL_VERSION, mapId: BOULDER_MAZE_MAP.id, mapVersion: 1 });
    expect(sent(b, 'reject')).toHaveLength(2);
    expect(sent(b, 'welcome')).toHaveLength(0);
  });

  it('starts only when every seated player is ready, with one sim player per seat', () => {
    const { room, join, sent } = harness();
    const a = join('ana');
    const b = join('bob');
    room.handle(a, { t: 'ready', ready: true });
    expect(room.phase).toBe('lobby');
    room.handle(b, { t: 'ready', ready: true });
    expect(room.phase).toBe('running');
    expect(Object.keys(room.debugState()!.players).sort()).toEqual([a, b].sort());
    expect(sent(a, 'start')).toHaveLength(1);
    expect(sent(b, 'start')).toHaveLength(1);
  });

  it('refuses new connections while running and caps seats at four', () => {
    const { room, join } = harness();
    const ids = [join('1'), join('2'), join('3'), join('4')];
    expect(room.connect()).toBeNull();
    for (const id of ids) room.handle(id, { t: 'ready', ready: true });
    expect(room.phase).toBe('running');
    expect(room.connect()).toBeNull();
  });

  it('stamps the latest intent onto the next tick and drops stale seqs', () => {
    const { room, join } = harness();
    const a = join('ana');
    room.handle(a, { t: 'ready', ready: true });
    room.handle(a, { t: 'input', seq: 1, direction: 'left' });
    room.handle(a, { t: 'input', seq: 2, direction: 'right' });
    room.handle(a, { t: 'input', seq: 2, direction: 'up' }); // replay: ignored
    room.advance(TICK_MS);
    const player = room.debugState()!.players[a]!;
    expect(player.lastCommandSeq).toBe(2);
    expect(player.bufferedDir).toBe('right');
  });

  it('broadcasts full snapshots on the cadence and events as they happen', () => {
    const { room, join, sent } = harness();
    const a = join('ana');
    room.handle(a, { t: 'ready', ready: true });
    room.advance(TICK_MS * 6 + 1);
    expect(room.tick).toBe(6);
    const snaps = sent(a, 'snapshot') as Array<{ state: { tick: number } }>;
    expect(snaps.map((s) => s.state.tick)).toEqual([3, 6]);
  });

  it('a disconnect mid-match forfeits that player; a team wipe ends the match', () => {
    const { room, join, sent } = harness();
    const a = join('ana');
    const b = join('bob');
    room.handle(a, { t: 'ready', ready: true });
    room.handle(b, { t: 'ready', ready: true });
    room.disconnect(a);
    expect(room.phase).toBe('running');
    expect(room.debugState()!.players[a]!.alive).toBe(false);
    const forfeits = sent(b, 'events').flatMap((m) => (m as { events: Array<{ type: string }> }).events).filter((e) => e.type === 'playerForfeited');
    expect(forfeits).toHaveLength(1);
    room.disconnect(b);
    expect(room.phase).toBe('ended');
  });

  it('a player joining after a finished match sees the lobby, not the stale outcome', () => {
    const { room, join, sent } = harness();
    const a = join('ana');
    room.handle(a, { t: 'ready', ready: true });
    room.disconnect(a);
    expect(room.phase).toBe('ended');
    const b = join('bob');
    expect(sent(b, 'snapshot')).toHaveLength(0);
    expect(sent(b, 'start')).toHaveLength(0);
    expect(sent(b, 'lobby').length).toBeGreaterThan(0);
  });

  it('restart is authority-owned: all players ready again => fresh match with a new seed', () => {
    const { room, join, sent } = harness();
    const a = join('ana');
    room.handle(a, { t: 'ready', ready: true });
    const first = room.debugState()!.rngState;
    room.disconnect(a);
    expect(room.phase).toBe('ended');
    const b = join('bob');
    room.handle(b, { t: 'ready', ready: true });
    expect(room.phase).toBe('running');
    expect(room.debugState()!.rngState).not.toBe(first);
    expect(sent(b, 'start')).toHaveLength(1);
  });
});

describe('parseClientMessage', () => {
  it('accepts well-formed frames and drops everything else', () => {
    expect(parseClientMessage('{"t":"input","seq":3,"direction":"up"}')).toEqual({ t: 'input', seq: 3, direction: 'up' });
    expect(parseClientMessage('{"t":"input","seq":0,"direction":"up"}')).toBeNull();
    expect(parseClientMessage('{"t":"input","seq":1,"direction":"diagonal"}')).toBeNull();
    expect(parseClientMessage('{"t":"join","name":"","protocol":1,"mapId":"m","mapVersion":2}')).toBeNull();
    expect(parseClientMessage('not json')).toBeNull();
    expect(parseClientMessage('{"t":"nuke"}')).toBeNull();
  });
});
