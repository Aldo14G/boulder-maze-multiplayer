# Multiplayer Plan — Path A, server-authoritative

Answers to `MULTIPLAYER_EXTENSION.md`, in the order they were decided.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Path | **A — Node authority over WebSocket (`ws`)** | Core already runs headless in Node (`headless-smoke.mjs`); server = `LocalGameSession` without Phaser. Path B still needs a signaling server plus STUN/TURN and host-departure policy. |
| Framework | None (plain `ws`, JSON frames) | `GameState` is already serializable; Colyseus would impose a second state schema. |
| Mode | 2–4 **cooperative**, shared pellet pool, team victory | Recommended by the checklist; no competitive scoring rules to invent. |
| Drill timer | Per player (already in `PlayerState.powerTicks`) | Zero core change. |
| Player–player overlap | Allowed | Blocking requires ordered collision resolution in the sim for little co-op value. |
| Defeat | **One life; defeated player becomes spectator; `phase='lost'` only when every player is defeated** | Keeps the baseline tension; smallest sim change (`some` → `every`). Spectators are a natural demo moment. |
| Late join | Blocked once `gameStarted`; lobby before | Avoids mid-run spawn + snapshot-merge complexity. |
| Disconnect | Player forfeited by server (`forfeitPlayer`); room ends on team wipe | Same path as a boulder contact; one code path. |
| Reconnect | Not supported mid-match: a dropped client rejoins the next match from the lobby | A real reconnect needs session tokens and a grace period; out of scope for the workshop. `resync` only covers delta gaps on a live socket. |
| Bandwidth | Deltas at 20 Hz + 1 Hz keyframes: ~28 KB/s per client (was ~110 KB/s with full snapshots) | Measured by `npm run test:net`. |
| Restart | Server-owned: every connected player presses Ready in lobby | Required by checklist ("authority-owned restart"). |
| Boulder AI target | Nearest **alive** player via multi-source BFS | Deterministic and uses existing `bfsDistances`. |
| Spawns | Map v2 adds 4 `P` tiles on the bottom row; players spawn round-robin by join order | `mapVersion` bump already gates protocol compatibility. |
| Prediction | Client runs the **same `stepGame`** on its own inputs ahead of the server; reconciles on each authoritative snapshot by re-simulating unacknowledged ticks | Shared deterministic core makes rollback cheap. Remote players and boulders are interpolated between snapshots. |

## Protocol (JSON over ws, one room per server for now)

```
client → server
  { t:'join',  name, protocol: 1, mapId, mapVersion }
  { t:'ready' }
  { t:'input', seq, direction }           // intent; server stamps the tick
  { t:'ping',  sentAt }

server → client
  { t:'welcome', playerId, roomId, snapshot }   // full state, also used for resync
  { t:'lobby',   players:[{id,name,ready}] }
  { t:'snapshot', state }                       // full keyframe: start, every 60 ticks, terminal, resync
  { t:'delta',   delta }                        // every 3 ticks: players, boulders, pelletsRemoved, counters
  { t:'events',  tick, events }
  // no separate ack: `players[me].lastCommandSeq` in each state is the ack
  { t:'pong',    sentAt, serverTick }
  { t:'reject',  reason }                       // protocol/map mismatch, room full, in progress
```

Rules: the server rejects unknown players, malformed frames and inputs for
players that are not alive; it reuses the sim's `late/future/duplicate`
rejection by assigning `tick = state.tick + 1` to the next pending intent.

## Slices (one PR each)

1. **Server skeleton** — `apps/server` workspace, `ws`, room with lobby, tick
   loop at 60 Hz, full snapshots every 3 ticks, `scripts/net-smoke.mjs` with
   two headless clients agreeing on pellet count and outcome.
2. **Core multi-player** — `createGame(..., playerIds)`, map v2 spawns,
   `PlayerState.alive`, defeat policy, nearest-alive boulder targeting,
   `gameWon` as team event. Vitest for each rule.
3. **RemoteGameSession** — implements `GameSession`; renders server snapshots
   only (no prediction yet); lobby UI; `?mode=online&server=ws://host:8787`.
4. **Prediction + reconciliation** — local sim ahead of server, input buffer,
   rollback on `ack`/`snapshot`; interpolation for remote entities; toggle in
   HUD for the demo.
5. **Deltas, resync, netgraph** — JSON patches between snapshots, full
   snapshot on request, RTT/tick-drift HUD, reconnect flow.
6. **Retro-pixel UI** — lobby, HUD, spectator banner, player colours;
   `impeccable` review pass.
7. **Hardening** — Playwright e2e with two browser contexts against a real
   server, property-style determinism tests (seeded RNG input streams
   replayed identically; `test/determinism.test.ts`), docs update.

## First milestone (slice 1 + 2 + 3)

Two browsers in one match agree on pellet removal, boulder positions, power
expiry and outcome, with authoritative snapshots shipped whole.
