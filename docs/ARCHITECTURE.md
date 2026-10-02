# Architecture

## Layers

```
┌──────────────────────────── apps/web ────────────────────────────┐
│  KeyboardAdapter ─▶ LocalGameSession ─┐                          │
│                   └▶ RemoteGameSession ─▶ MazeScene (Phaser)      │
│                       (predict/        │ DOM HUD + lobby +        │
│                        reconcile)      │ netgraph                 │
└──────────────────────────┬─────────────┬──────────────────────────┘
                           │             │ ws: input/ready only
┌──────────────────────────▼─────────────▼──────────────────────────┐
│  packages/core — pure TypeScript simulation                       │
│  map data + validator · fixed-step sim · commands · events        │
│  JSON-serializable state · seeded RNG · serialize/deserialize     │
└──────────────────────────▲─────────────────────────────────────────┘
                           │ createGame / stepGame / snapshotState
┌──────────────────────────┴────────────────────────────────────────┐
│  apps/server — authoritative room: lobby, input validation,       │
│  60 Hz tick loop, delta broadcast + keyframes, resync             │
└───────────────────────────────────────────────────────────────────┘
```

**Rule:** every gameplay decision happens in `packages/core`. Phaser, the
DOM, and the browser only *present* state and *produce* input intent.

## State ownership

- `GameState` (in `packages/core/src/sim.ts`) is the single source of truth
  and is **JSON-serializable end to end** — no class instances, Maps, Sets,
  or DOM references. `serializeGame`/`deserializeGame` round-trip it exactly,
  including mid-edge positions, buffered turns, and pending respawn timers.
- `LocalGameSession` (`apps/web/src/session/LocalGameSession.ts`) advances
  state in local mode. It owns the accumulator, calls `stepGame`, and hands
  out **detached snapshots** (`snapshotState`) so a renderer can never
  mutate the sim. Online, that role is the `apps/server` room — see
  "Online authority" below.
- Renderers read snapshots only. Input flows in as `PlayerCommand`s
  (`{ playerId, direction, seq, tick }`) which the session assigns to the
  next simulation tick.

## Fixed-step timing

The simulation runs at **60 ticks per second** (`config.tickRate`).
`LocalGameSession.advance(frameDeltaMs)` feeds an accumulator: each frame
adds `min(delta, 250 ms)` and the loop runs as many whole ticks as fit.
Consequences:

- Game speed is independent of display refresh rate, tab jank, or keyboard
  repeat rate — a 144 Hz monitor and a throttled background tab produce the
  same ticks per wall-clock second.
- Positions are **integer sub-tile units** (`unitsPerTile = 60`) and all
  timers are integer tick counts, so simulation math never depends on
  floating point or frame pacing.

## Command & snapshot flow

```
keyboard ──submitDirection──▶ LocalGameSession ──commands──▶ stepGame(state, cmds)
                                                              │ one tick
              drainEvents ◀── events ─────────────────────────┤
              snapshot()   ◀── JSON clone ────────────────────┘
                    │
                    ▼
            MazeScene renders · HUD updates · FX from events
```

- Commands carry an assigned `tick`; unknown players, future/late ticks, and
  duplicate `seq`s are rejected with `commandRejected` events.
- `GameEvent`s (`pelletCollected`, `powerStarted`, `powerEnded`,
  `boulderDestroyed`, `boulderReleased`, `playerDefeated`, `gameWon`,
  `gameStarted`, `commandRejected`, `boulderWarning`) carry `tick` + `seq`
  ids and drive FX only — never gameplay.
- `players` is a **keyed collection**; the session's controlled player is
  just `LOCAL_PLAYER_ID`. Nothing in the core assumes one player.

## The GameSession contract

`GameSession` (`submitDirection`, `snapshot`, `drainEvents`, `pause`,
`resume`, `restart`) is implemented twice:

- `LocalGameSession` — solo play; owns the clock and lifecycle.
- `RemoteGameSession` (`apps/web/src/session/RemoteGameSession.ts`) — same
  renderer-facing contract, but the server owns ticks and lifecycle:
  `pause`/`resume` are no-ops, `restart` sends a lobby `ready`, and
  `submitDirection` only emits input intent over ws. `?mode=online` selects
  it; see docs/MULTIPLAYER_PLAN.md for the wire protocol.

## Online authority

- The `apps/server` room owns the only `GameState` that counts. It runs the
  same `stepGame` at 60 Hz, stamps input ticks itself, and broadcasts:
  a full keyframe at start / every 60 ticks / terminal states / `resync`,
  and compact deltas every 3 ticks in between (`protocol.ts`).
- `RemoteGameSession` predicts the local player by stepping the shared core
  ahead of the server (bounded by an RTT-derived lead), then reconciles on
  each authoritative frame: drop acknowledged inputs
  (`players[me].lastCommandSeq` is the ack), re-simulate the rest.
- Remote players and boulders are interpolated between the last two
  authoritative states, rendered ~6 ticks behind (`netcode.ts` — pure,
  Vitest-covered).
- A delta that doesn't apply (gap/reorder) triggers a single `resync`
  request; the server re-sends the keyframe base the client last confirmed.

## Running the core in Node vs. the browser

- **Browser:** Vite aliases `@boulder-maze/core` to `src/` for HMR.
- **Node:** the package's `exports` point at `dist/` (built by
  `npm run build`). `scripts/validate-map.mjs` and
  `scripts/headless-smoke.mjs` import it through real Node resolution —
  proving the core needs no DOM, canvas, or Phaser.
- Determinism: same map + seed + command stream ⇒ identical state every
  tick (exercised by the determinism Vitest suite and the headless smoke).

## Testing surface

- `packages/core/test/` — Vitest: map validator (valid + invalid fixtures),
  movement/buffering/reversal, pellet & power rules, collisions, respawn,
  commands, determinism/replay, JSON snapshot round-trips.
- `apps/web/e2e/` — Playwright smoke: title → start → steering, pause/resume,
  focusable buttons, HUD, whole-maze fit at 1280×720; `online.spec.ts` runs
  a real two-browser match against the game server (spawned by the
  playwright `webServer` config).
- `apps/server/test/` — Vitest room tests: lobby/ready transitions, input
  validation, forfeit-on-disconnect, delta/keyframe broadcast.
- `apps/web/test/` — netcode unit tests: prediction, reconciliation,
  interpolation, delta application.
- `scripts/net-smoke.mjs` — two real ws clients converging tick-for-tick.
