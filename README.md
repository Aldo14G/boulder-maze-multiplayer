# Boulder Maze

A deterministic, single-player maze game — Pac-Man-like rules — built as the
baseline for a multiplayer workshop. A pure TypeScript simulation
(`packages/core`) owns every gameplay decision; Phaser (`apps/web`) only
renders snapshots and forwards input intent.

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
| `npm run build` | Builds `@boulder-maze/core` (tsc → dist) then the web app (vite) |
| `npm run preview` | Serves the production build |
| `npm run typecheck` | `tsc --noEmit` across workspaces (strict mode) |
| `npm test` | Vitest suite for the core sim and map (40 tests) |
| `npm run validate` | Validates the shipped maze (`validateMap`) and exits non-zero on failure |
| `npm run smoke` | Headless Node sim smoke: 1200 deterministic ticks + snapshot round-trip |
| `npm run test:e2e` | Playwright browser smoke suite (builds core, serves the app, drives a real browser) |

## Controls

- **Arrow keys or WASD** — steer (turns are buffered and applied at the next
  legal tile center; reversing direction is instant)
- **P / Esc** — pause / resume (the Pause button does the same)
- Losing window focus clears held keys and pauses automatically.

## Gameplay

Clear every pellet while dodging four AI boulders. Normal pellets are worth
10 points; the four **Super Pellets** (corners, 50 points) turn your
triangle into a drill for **8 seconds** — drill mode destroys boulders on
contact (+200) and sends them back to their spawn chutes. The drill meter in
the HUD and the ring around the player show remaining time; both flash in
the last 2 seconds. One boulder touch outside drill mode ends the run —
you have one life. Boulders re-enter through flashing chutes after a stagger
delay, but only once the entry area is clear of you.

Win: all pellets collected → **Maze Cleared**. Lose: contact → **Run Ended**.
Restart uses the same map and seed.

## Folder guide

```
packages/core   Pure simulation — no DOM, no Phaser. Runs in Node and the
                browser. Map data + validator, fixed-step sim, commands,
                events, JSON snapshots. Vitest suites live in test/.
apps/web        Phaser front-end: LocalGameSession (sole owner of sim
                advancement), KeyboardAdapter, MazeScene (rendering only),
                DOM HUD, Playwright e2e smoke.
scripts/        validate-map.mjs (startup-style map check) and
                headless-smoke.mjs (Node-only determinism check).
docs/           ARCHITECTURE.md, GAME_RULES.md, MULTIPLAYER_EXTENSION.md
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — state ownership, fixed-step
  timing, command/snapshot flow, browser vs Node execution.
- [docs/GAME_RULES.md](docs/GAME_RULES.md) — authoritative rules, tuning
  values, tile legend, ordering and collision semantics.
- [docs/MULTIPLAYER_EXTENSION.md](docs/MULTIPLAYER_EXTENSION.md) — workshop
  decision checklist for the 2–4 player port.
