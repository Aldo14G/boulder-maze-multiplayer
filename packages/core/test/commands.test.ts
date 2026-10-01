import { describe, expect, it } from 'vitest';
import { stepGame } from '../src/index.js';
import type { PlayerCommand } from '../src/index.js';
import { LOCAL_PLAYER_ID } from '../src/index.js';
import {
  clearPellets,
  cmd,
  makeState,
  placePlayer,
  player,
  resetSeq,
  startPlaying,
} from './helpers.js';

describe('command handling', () => {
  it('rejects duplicate sequence numbers', () => {
    resetSeq();
    const state = makeState();
    startPlaying(state);
    clearPellets(state, [[1, 'normal']]);
    const first = cmd(state, 'left');
    const events = stepGame(state, [first, { ...first, direction: 'up' }]);
    expect(events.filter((e) => e.type === 'commandRejected' && e.reason === 'duplicate')).toHaveLength(1);
    expect(player(state).dir).toBe('left'); // the first command won (consumed at the spawn centre)
  });

  it('rejects late commands assigned to past ticks', () => {
    resetSeq();
    const state = makeState();
    startPlaying(state);
    stepGame(state, []);
    const late: PlayerCommand = { playerId: LOCAL_PLAYER_ID, direction: 'up', seq: 99, tick: state.tick - 1 };
    const events = stepGame(state, [late]);
    expect(events.some((e) => e.type === 'commandRejected' && e.reason === 'late')).toBe(true);
    expect(player(state).bufferedDir).toBeNull();
  });

  it('rejects commands assigned to future ticks', () => {
    resetSeq();
    const state = makeState();
    startPlaying(state);
    const future: PlayerCommand = { playerId: LOCAL_PLAYER_ID, direction: 'up', seq: 1, tick: state.tick + 5 };
    const events = stepGame(state, [future]);
    expect(events.some((e) => e.type === 'commandRejected' && e.reason === 'future')).toBe(true);
  });

  it('rejects commands for unknown players', () => {
    const state = makeState();
    startPlaying(state);
    const events = stepGame(state, [
      { playerId: 'player-9', direction: 'up', seq: 1, tick: state.tick + 1 },
    ]);
    expect(events.some((e) => e.type === 'commandRejected' && e.reason === 'unknown-player')).toBe(true);
  });

  it('applies same-tick commands in sequence order (last writer wins)', () => {
    resetSeq();
    const state = makeState();
    startPlaying(state);
    const tick = state.tick + 1;
    const events = stepGame(state, [
      { playerId: LOCAL_PLAYER_ID, direction: 'up', seq: 2, tick },
      { playerId: LOCAL_PLAYER_ID, direction: 'down', seq: 1, tick },
      { playerId: LOCAL_PLAYER_ID, direction: 'left', seq: 3, tick },
    ]);
    expect(events.some((e) => e.type === 'commandRejected')).toBe(false);
    expect(player(state).dir).toBe('left');
  });
});
