# Game Rules (authoritative)

All rules below live in `packages/core`. The web app has no gameplay logic.

## Simulation contract

- Fixed **60 ticks/second** (`tickRate`). `stepGame(state, commands)`
  advances **exactly one tick** and returns the `GameEvent`s produced.
- Positions are **integer sub-tile units** — `unitsPerTile = 60`, so a tile
  center is `tile * 60 + 30` and speeds are units/tick. No floating point in
  gameplay math; all timers are integer tick counts.
- `GameState` is JSON-serializable; `serializeGame`/`deserializeGame`
  round-trip it exactly (mid-edge positions, buffered turns, pending
  respawn timers included).

## Commands

`PlayerCommand = { playerId, direction, seq, tick }`. Sorted by
`(tick, playerId, seq)` then applied; each is rejected — with a
`commandRejected` event — when the player is unknown, the assigned tick is
in the past (`late`) or future (`future`), or `seq` is not strictly
increasing (`duplicate`).

## The maze

- One fixed map, 25×21 (`packages/core/src/mapData.ts`), `id`/`version`
  stamped into state.
- `validateMap` enforces: rectangular rows, known characters, exactly one
  player spawn, ≥1 super pellet, ≥1 pellet, **no dead ends**, **no 2×2
  walkable blocks**, ≥6 junctions, all walkable tiles connected, and four
  side-chutes whose entries are walkable, point inward at walkable space,
  and are referenced by exactly one boulder. `createGame` throws on an
  invalid map; `npm run validate` checks the shipped map.

### Tile legend

| Char | Meaning |
| --- | --- |
| `#` | wall |
| `.` | pellet tile |
| `o` | Super Pellet tile |
| `P` | player spawn (no pellet) |
| `e` | chute entry — walkable, no pellet |
| ` ` / other | invalid |

Pellets cover every walkable tile except the spawn and the four chute
entries. Four Super Pellets sit in the four corners.

## Movement

- Player: **5 units/tick** (5 tiles/s). Continuous along corridors; a
  buffered direction is consumed at the **next legal tile center** —
  reversal (opposite direction) is instant anywhere. No diagonals, no wall
  penetration; blocked movement halts at the center.
- Boulders: **4 units/tick** normally, **3 units/tick** while any player is
  powered. Pathing is BFS shortest-distance to the player's tile,
  recomputed every tick at tile centers; the powered field is inverted to
  flee. Deterministic tie-break: direction order rotated per boulder
  index. Boulders may overlap each other and (outside contact range) the
  player; they do not enter walls and may not reverse unless no
  alternative exists (all directions are available while fleeing).

## Pickups, power, score

| Item | Score | Effect |
| --- | --- | --- |
| pellet | +10 | `pelletCollected` |
| Super Pellet | +50 | drill mode **480 ticks (8 s)** — **resets**, never adds; `powerStarted` |
| boulder destroyed while powered | +200 | see respawn below |

Drill expiry emits `powerEnded`; the HUD flags the final
**120 ticks (2 s)** as the warning window. The collection tick itself does
not consume power duration.

## Per-tick ordering

1. Commands applied (validation + `commandRejected` events).
2. Ready countdown: `readyTicks = 120` (2 s) → `gameStarted`.
3. Movement (positions captured first for swept checks).
4. **Pickups** — a Super Pellet collected this tick applies to step 5.
5. **Contacts** — swept segment-vs-segment distance ≤
   `contactRadius = 24` catches mid-tick crossings (head-on passes count).
   Powered contact destroys the boulder (+200); unpowered contact
   defeats the player (`playerDefeated`, `phase = 'lost'`).
6. **Win check** — `pelletsRemaining === 0` → `gameWon`. A fatal contact on
   the same tick takes precedence over the final pellet.
7. Timers — power countdown, respawn countdown, chute warnings/releases.

## Boulder lifecycle

1. `pending` at its chute entry. Initial releases are staggered:
   `readyTicks + i * releaseGapTicks` (`releaseGapTicks = 90`).
2. **Warning**: the final `chuteWarnTicks = 60` before a release shows the
   flashing tube (`boulderWarning`).
3. **Release** requires the entry area (entry tile + its walkable
   neighbors) clear of players and active boulders; the release is delayed
   — never cancelled — until it is.
4. `destroyed` after powered contact: `respawnTicks = 180` (3 s), then back
   to `pending` with a new warning window.

## Lives, pause, restart

- One player, four boulders, **one life** — any unpowered contact ends the
  run (`lost`); terminal phases freeze the sim (`stepGame` is a no-op).
- Pause is a **session** concept (not a game rule): the local session stops
  advancing ticks, freezing all timers. Multiplayer must decide its own
  pause authority.
- Restart = same map, same seed → `createGame` from scratch.

## Tuning values (`packages/core/src/config.ts`)

| Config | Value |
| --- | --- |
| `tickRate` | 60 /s |
| `unitsPerTile` | 60 |
| `playerSpeed` | 5 units/tick |
| `boulderSpeed` | 4 units/tick |
| `poweredBoulderSpeed` | 3 units/tick |
| `powerTicks` | 480 (8 s) |
| `powerWarningTicks` | 120 (2 s) |
| `respawnTicks` | 180 (3 s) |
| `readyTicks` | 120 (2 s) |
| `releaseGapTicks` | 90 |
| `chuteWarnTicks` | 60 (1 s) |
| `contactRadius` | 24 units (0.4 tiles) |
| `normalPelletScore` / `superPelletScore` / `boulderScore` | 10 / 50 / 200 |
