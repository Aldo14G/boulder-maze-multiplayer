import Phaser from 'phaser';
import { BOULDER_MAZE_MAP } from '@boulder-maze/core';
import type { GameState } from '@boulder-maze/core';
import { LocalGameSession } from './session/LocalGameSession.js';
import type { GameSession } from './session/LocalGameSession.js';
import { RemoteGameSession } from './session/RemoteGameSession.js';
import { KeyboardAdapter } from './input.js';
import { MazeScene } from './scene/MazeScene.js';
import { Hud } from './ui/hud.js';

const params = new URLSearchParams(window.location.search);
const online = params.get('mode') === 'online';
const serverUrl = params.get('server') ?? `ws://${window.location.hostname}:8787`;
const playerName = params.get('name') ?? `Player-${Math.floor(Math.random() * 900 + 100)}`;

let hud: Hud;
let session: GameSession;

if (online) {
  const remote = new RemoteGameSession(serverUrl, playerName, {
    onLobby: (players, phase) => {
      if (phase === 'running') return;
      if (hud.overlayShown !== 'lobby') hud.showOverlay('lobby');
      hud.setLobby(players, remote.localPlayerId, `Connected to ${serverUrl} as ${playerName}`);
    },
    onStart: () => hud.hideOverlay(),
    onStatus: (status, detail) => {
      if (status === 'rejected' || status === 'closed') {
        hud.showOverlay('offline');
        hud.setBody(detail ?? (status === 'rejected' ? 'The server refused this client.' : 'Connection closed.'));
      }
    },
  });
  session = remote;
  hud = new Hud({
    onPrimary: () => {
      const mode = hud.overlayShown;
      if (mode === 'offline') window.location.search = '';
      else if (mode === 'lobby') remote.setReady(!remote.lobby.find((p) => p.id === remote.localPlayerId)?.ready);
      else remote.restart(); // won / lost → ready for the next match
    },
    onSecondary: () => {},
    onPauseButton: () => {},
  });
  hud.showOverlay('lobby');
  hud.setLobby([], null, `Connecting to ${serverUrl}…`);
  hud.setPauseAvailable(false);
  remote.setPrediction(params.get('predict') !== '0');
  // Demo toggle: N flips client-side prediction so the difference is visible live.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'n' || e.key === 'N') remote.setPrediction(!remote.prediction);
  });
  (window as unknown as { __NET__?: () => unknown }).__NET__ = () => remote.stats;
} else {
  const local = new LocalGameSession();
  session = local;
  hud = new Hud({
    onPrimary: () => {
      if (hud.overlayShown === 'paused') local.resume();
      else local.restart(); // title / won / lost → fresh run on the same map and seed
      hud.hideOverlay();
    },
    onSecondary: () => {
      if (hud.overlayShown === 'title') {
        window.location.search = `?mode=online&server=${encodeURIComponent(serverUrl)}`;
        return;
      }
      local.restart();
      hud.hideOverlay();
    },
    onPauseButton: () => togglePause(),
  });
}

function togglePause(): void {
  if (online) return; // the server owns the clock
  if (session.phase === 'won' || session.phase === 'lost') return;
  if (hud.overlayShown === 'title') return;
  if (session.paused) {
    session.resume();
    hud.hideOverlay();
  } else {
    session.pause();
    hud.showOverlay('paused');
  }
}

const input = new KeyboardAdapter(session, togglePause);
input.attach();

const world = MazeScene.worldSize(BOULDER_MAZE_MAP);
const scene = new MazeScene(session, hud);

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game-container',
  width: world.width,
  height: world.height,
  backgroundColor: '#10131a',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene,
});

// Test hook for the Playwright smoke suite (/?test=1). Presentation-only:
// exposes the session's snapshot, never a mutation path.
if (params.get('test') === '1') {
  (window as unknown as { __BOULDER__?: { snapshot: () => GameState } }).__BOULDER__ = {
    snapshot: () => session.snapshot(),
  };
}
