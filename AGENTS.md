# Boulder Maze — agent contract

Goal of this fork: turn the single-player baseline into a **server-authoritative
2–4 player cooperative game** with client-side prediction, following
`docs/MULTIPLAYER_PLAN.md`. Read that plan before touching networking code.

## Invariants (do not break)

- Every gameplay decision lives in `packages/core`. Server and browser only
  drive `createGame` / `stepGame` / `snapshotState` and present results.
- `GameState` stays plain JSON: no classes, Maps, Sets, Dates, DOM refs.
- `stepGame` is deterministic: same state + same commands ⇒ same result. Any
  iteration over `players`/`boulders` uses the sorted-id helpers.
- The server assigns command ticks; a client's `tick`/position/score is never
  authoritative. Pause/restart are server policies, not client flags.
- `LocalGameSession` and the single-player path must keep working.

## Workspaces

| Path | Role |
|---|---|
| `packages/core` | Pure TS sim, Vitest tests in `test/` |
| `apps/web` | Phaser renderer, `LocalGameSession`, `RemoteGameSession`, DOM HUD, Playwright e2e |
| `apps/server` | Node `ws` authority: rooms, join/leave, tick loop, snapshots (added by this fork) |
| `scripts/` | Node-only checks (`validate-map`, `headless-smoke`, `net-smoke`) |

## Build & verify

Node ≥ 22.12 (`.nvmrc` → 24; v22.14 works). Fresh clone:

```
npm install
npm run build --workspace @boulder-maze/core   # REQUIRED before typecheck: apps/* resolve core from dist/
npm run typecheck
npm test            # Vitest in every workspace (core sim + server Room)
npm run smoke       # 1200-tick headless determinism check
npm run validate    # map validator
npm run test:net    # boots the server, two ws clients must agree on every shared tick
npm run server      # authoritative server on ws://0.0.0.0:8787 (PORT to override)
```

Before claiming a slice done, run every command above plus the slice's own
check (see plan). `npm run test:e2e` needs `npx playwright install chromium`
once; it is slow — run it for UI/session slices, not for core-only changes.

## Working style

- One vertical slice per branch/PR, in plan order; each slice ships a test.
- TDD for core changes: failing Vitest first, then the minimal change.
- Add a dependency only if the plan lists it (`ws`, `fast-check`). No Colyseus.
- Keep diffs surgical; do not reformat untouched files; do not add comments
  that restate code.
- Document decisions in `docs/MULTIPLAYER_PLAN.md` (Decisions section), not
  in commit messages alone.
- Relevant global skills on this machine: `tdd`, `karpathy-guidelines`,
  `diagnose`, `retro-pixel` + `impeccable` + `ui-ux-pro-max` (UI slices only).
