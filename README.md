# Boulder Maze

A deterministic Pac-Man-like maze game with **2–4 player online co-op**. A
pure TypeScript simulation (`packages/core`) owns every gameplay decision —
the same `stepGame` runs on the authoritative Node server (`apps/server`),
in the browser for local play, and inside the netcode layer for client-side
prediction. Phaser (`apps/web`) only renders snapshots and forwards input
intent.

## Prerequisites

- **Node.js 24** (tested: v24.21.0, npm 11.19.0). `engines` requires
  `>=22.12.0`; `.nvmrc` pins 24 — `nvm use` picks it up automatically.
- npm ≥ 10 (workspaces).
- A network connection for the initial `npm install` and for the one-time
  Playwright browser download (`npx playwright install chromium`). After
  that, dev/build/test run offline.

## Install

```sh
npm install          # installs all workspaces
npx playwright install chromium   # only needed for the e2e smoke suite
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server for the game (apps/web) |
| `npm run server` | Builds core + server, starts the authoritative WebSocket server on `:8787` |
| `npm run build` | Builds `@boulder-maze/core` (tsc → dist) then the web app (vite) |
| `npm run preview` | Serves the production build |
| `npm run typecheck` | `tsc --noEmit` across workspaces (strict mode) |
| `npm test` | Vitest: core sim/map/determinism (66), server room (10), web netcode (5) |
| `npm run validate` | Validates the shipped maze (`validateMap`) and exits non-zero on failure |
| `npm run smoke` | Headless Node sim smoke: 1200 deterministic ticks + snapshot round-trip |
| `npm run test:net` | Two real WebSocket clients against the server; asserts identical reconstructed state and reports delta/keyframes + KB/s |
| `npm run test:e2e` | Playwright suite: single-player smoke **plus a two-browser online match** against a real server |

## Playing online

```sh
npm run server                       # terminal 1 — ws://0.0.0.0:8787
npm run dev                          # terminal 2 — http://localhost:5173
```

Open `http://localhost:5173/?mode=online` in two or more tabs/machines. For
LAN play, friends open `http://<your-ip>:5173/?mode=online` — the client
derives `ws://<host>:8787` automatically, or pass
`&server=ws://<host>:8787` and `&name=<nick>` explicitly.

2–4 players share one room. Everyone presses **Ready** in the lobby; the
match starts when all connected players are ready. The pellet pool and
victory are shared; drill timers are per player. Players may overlap. A
boulder hit leaves you spectating — the run is lost only when the whole
team is wiped. Joins are lobby-only and a disconnect forfeits the seat.

### Netcode

The client predicts its own movement by running the shared `stepGame` ahead
of the server, then reconciles on every authoritative frame by re-simulating
unacknowledged inputs. Remote players and boulders are interpolated ~6
ticks behind. Wire format: JSON deltas at 20 Hz with 1 Hz keyframes
(~28 KB/s per client), gap-detected `resync` on demand. The HUD netgraph
(bottom-left, hidden on narrow screens) shows RTT, tick lead/ahead,
snapshot rate, bandwidth, last reconciliation size and resyncs. Press **N**
in an online match to toggle prediction and feel the difference live.

## Controls

- **Arrow keys or WASD** — steer (turns are buffered and applied at the next
  legal tile center; reversing direction is instant)
- **P / Esc** — pause / resume (local mode only; the server owns the clock
  online)
- **N** — toggle client-side prediction (online mode)
- Losing window focus clears held keys and pauses automatically (local).

## Gameplay

Clear every pellet while dodging four AI boulders that hunt the nearest
alive player. Normal pellets are worth 10 points; the four **Super Pellets**
(corners, 50 points) turn your triangle into a drill for **8 seconds** —
drill mode destroys boulders on contact (+200) and sends them back to their
spawn chutes. The drill meter in the HUD and the ring around the player
show remaining time; both flash in the last 2 seconds. Boulders re-enter
through flashing chutes after a stagger delay, but only once the entry area
is clear.

Win: all pellets collected → **Maze Cleared**. Lose: whole team defeated →
**Team Wiped** (solo: **Run Ended**). Restart uses the same map and seed.

## Folder guide

```
packages/core   Pure simulation — no DOM, no Phaser. Runs in Node and the
                browser. Map data + validator, fixed-step sim, commands,
                events, JSON snapshots, seeded RNG. Vitest in test/.
apps/server     Authoritative room: ws transport, lobby/ready flow, input
                validation, 60 Hz tick loop, delta broadcast + keyframes.
apps/web        Phaser front-end: LocalGameSession (local mode),
                RemoteGameSession + netcode.ts (prediction, reconciliation,
                interpolation, delta/resync), MazeScene (rendering only),
                DOM HUD with lobby/roster/netgraph, Playwright e2e.
scripts/        validate-map.mjs, headless-smoke.mjs (sim determinism),
                net-smoke.mjs (two-client network check).
docs/           ARCHITECTURE.md, GAME_RULES.md, MULTIPLAYER_EXTENSION.md,
                MULTIPLAYER_PLAN.md (decisions + protocol reference).
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — state ownership, fixed-step
  timing, command/snapshot flow, browser vs Node execution.
- [docs/GAME_RULES.md](docs/GAME_RULES.md) — authoritative rules, tuning
  values, tile legend, ordering and collision semantics.
- [docs/MULTIPLAYER_EXTENSION.md](docs/MULTIPLAYER_EXTENSION.md) — original
  workshop checklist this project answers.
- [docs/MULTIPLAYER_PLAN.md](docs/MULTIPLAYER_PLAN.md) — decisions taken and
  the wire protocol.
