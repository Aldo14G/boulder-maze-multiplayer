import Phaser from 'phaser';
import { BOULDER_MAZE_MAP } from '@boulder-maze/core';
import type { GameState } from '@boulder-maze/core';
import { LocalGameSession } from './session/LocalGameSession.js';
import { KeyboardAdapter } from './input.js';
import { MazeScene } from './scene/MazeScene.js';
import { Hud } from './ui/hud.js';

const session = new LocalGameSession();
const hud = new Hud({
  onPrimary: () => {
    const mode = hud.overlayShown;
    if (mode === 'paused') {
      session.resume();
      hud.hideOverlay();
    } else {
      // title / won / lost → fresh run on the same map and seed
      session.restart();
      hud.hideOverlay();
    }
  },
  onSecondary: () => {
    session.restart();
    hud.hideOverlay();
  },
  onPauseButton: () => togglePause(),
});

function togglePause(): void {
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
if (new URLSearchParams(window.location.search).get('test') === '1') {
  (window as unknown as { __BOULDER__?: { snapshot: () => GameState } }).__BOULDER__ = {
    snapshot: () => session.snapshot(),
  };
}
