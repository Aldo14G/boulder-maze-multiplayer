# Architecture

## Layers

```
┌────────────────────────── apps/web ──────────────────────────┐
│  KeyboardAdapter  →  LocalGameSession  →  MazeScene (Phaser)  │
│                       (sole owner of      │ DOM HUD           │
│                        sim advancement)   │                   │
└──────────────────────────┬───────────────────────────────────┘
                           │ createGame / stepGame / snapshotState
┌──────────────────────────▼───────────────────────────────────┐
│  packages/core — pure TypeScript simulation                  │
│  map data + validator · fixed-step sim · commands · events   │
│  JSON-serializable state · seeded RNG                        │
└──────────────────────────────────────────────────────────────┘
```

**Rule:** every gameplay decision happens in `packages/core`. Phaser, the
DOM, and the browser only *present* state and *produce* input intent.

## State ownership

- `GameState` (in `packages/core/src/sim.ts`) is the single source of truth
  and is **JSON-serializable end to end** — no class instances, Maps, Sets,
  or DOM references. `serializeGame`/`deserializeGame` round-trip it exactly,
  including mid-edge positions, buffered turns, and pending respawn timers.
- `LocalGameSession` (`apps/web/src/session/LocalGameSession.ts`) is the
  only object allowed to advance state. It owns the accumulator, calls
  `stepGame`, and hands out **detached snapshots** (`snapshotState`) so a
  renderer can never mutate the sim.
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

`LocalGameSession` is the sole implementation of the `GameSession`
interface (`submitDirection`, `snapshot`, `drainEvents`, `pause`, `resume`,
`restart`). A future `RemoteGameSession` must satisfy the same contract
from the renderer's point of view, but authority shifts: a server will own
ticks and pause/restart policy, so these local lifecycle controls must not
be assumed portable. See docs/MULTIPLAYER_EXTENSION.md.

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
  focusable buttons, HUD, whole-maze fit at 1280×720.
