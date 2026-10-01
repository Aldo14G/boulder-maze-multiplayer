# Multiplayer Extension — workshop checklist

The baseline is deliberately network-free. This is a **decision checklist**,
not a networking solution — attendees own these choices. Everything the
sim needs is already in place: keyed `players`, `PlayerCommand`s with
assigned ticks and seqs, JSON snapshots, seeded determinism.

## Mode

Recommended starting point: **2–4 cooperative triangle players** sharing
the pellet pool and the team victory, each with an **individual drill
timer**. Open questions for attendees:

- Player–player overlap — allowed like boulders, or blocked?
- Defeat policy — shared lives, per-player lives, or respawn rules?
- Late-join / drop policy — lock at `gameStarted`, or join mid-run?

## Path A — client/server

A Node authority owns the tick loop, boulder AI, pickups, contacts, score
and victory; clients send input intent and render snapshots — the same
`LocalGameSession` contract, with authority moved off the client.
Colyseus is an optional framework worth evaluating, not a requirement.

## Path B — host peer

One peer runs the same sim; other peers send inputs over WebRTC data
channels. Still needs: signaling, possibly STUN/TURN, a host-departure
policy, and a background-tab throttling policy (the accumulator already
caps catch-up, but decide whether a throttled host should pause the match).

## Requirements either path must satisfy

- Connection-bound **player identity** (one id per connection; reserve
  `playerId` on join, free it on disconnect).
- **Validated input**: reject unknown players and malformed commands —
  reuse the existing `late`/`future`/`duplicate` rejection.
- **Command sequencing**: clients stamp intents; the authority assigns the
  tick (server clock — never the client's).
- **Map/protocol compatibility**: `mapId` + `mapVersion` are already in
  `GameState`; gate joins on a protocol/map version match.
- **Initial join = full snapshot**, then per-tick deltas or authoritative
  snapshots; provide a resync path for late/reconnecting clients.
- **Disconnect handling** and **authority-owned restart** — restart cannot
  be a client-side convenience.
- Client position/score claims are **never authoritative**.

## First milestone

Two browsers in one match agreeing on: pellet removal, boulder positions,
power expiry, and game outcome. Start by shipping **authoritative
snapshots** whole; add interpolation/prediction only if time allows.

## Workshop-network caveats

Two tabs on one machine is only a smoke check — verify separate devices on
the real workshop network. Plan for isolated Wi-Fi, firewalls, proxy
restrictions, and HTTPS/WSS hosting. A static frontend host does not give
you a real-time server; the host-peer path still needs somewhere to
exchange WebRTC signaling.

## What NOT to assume carries over

`LocalGameSession.pause/resume/restart`, `onFocusLost`, and the local
input seq are **client conveniences**. Pause and restart become
authority-owned policies; per-client clock trust disappears; a client must
not drive `stepGame` itself once a server exists.
