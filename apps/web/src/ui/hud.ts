import type { GameState } from '@boulder-maze/core';

export type OverlayMode = 'title' | 'paused' | 'won' | 'lost';

export interface HudCallbacks {
  onPrimary: () => void;
  onSecondary: () => void;
  onPauseButton: () => void;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

/**
 * DOM HUD — deliberately kept out of the Phaser canvas so the multiplayer
 * port can reuse the DOM layer unchanged.
 */
export class Hud {
  private readonly hudTop = el<HTMLDivElement>('hud-top');
  private readonly scoreEl = el<HTMLSpanElement>('hud-score');
  private readonly pelletsEl = el<HTMLSpanElement>('hud-pellets');
  private readonly drill = el<HTMLSpanElement>('hud-drill');
  private readonly drillFill = el<HTMLSpanElement>('hud-drill-fill');
  private readonly pauseBtn = el<HTMLButtonElement>('btn-pause');
  private readonly readyEl = el<HTMLDivElement>('ready-text');
  private readonly overlay = el<HTMLDivElement>('overlay');
  private readonly overlayTitle = el<HTMLHeadingElement>('overlay-title');
  private readonly overlayBody = el<HTMLParagraphElement>('overlay-body');
  private readonly overlayControls = el<HTMLUListElement>('overlay-controls');
  private readonly primaryBtn = el<HTMLButtonElement>('btn-primary');
  private readonly secondaryBtn = el<HTMLButtonElement>('btn-secondary');

  private overlayMode: OverlayMode | null = 'title';
  private ended = false;

  constructor(cb: HudCallbacks) {
    this.primaryBtn.addEventListener('click', cb.onPrimary);
    this.secondaryBtn.addEventListener('click', cb.onSecondary);
    this.pauseBtn.addEventListener('click', cb.onPauseButton);
    this.showOverlay('title');
  }

  update(snap: GameState, paused: boolean): void {
    const player = snap.players[Object.keys(snap.players)[0] ?? ''];
    this.scoreEl.textContent = `Score ${player?.score ?? 0}`;
    this.pelletsEl.textContent = `Pellets ${snap.pelletsRemaining}`;

    const power = player?.powerTicks ?? 0;
    if (power > 0) {
      this.drill.hidden = false;
      const frac = power / snap.config.powerTicks;
      this.drillFill.style.width = `${(frac * 100).toFixed(1)}%`;
      this.drill.classList.toggle('warning', power <= snap.config.powerWarningTicks);
    } else {
      this.drill.hidden = true;
    }

    if (snap.phase === 'ready') {
      const secsLeft = Math.ceil(Math.max(0, snap.readyUntilTick - snap.tick) / snap.config.tickRate);
      this.readyEl.hidden = false;
      this.readyEl.textContent = secsLeft > 0 ? `READY — ${secsLeft}` : 'READY';
    } else {
      this.readyEl.hidden = true;
    }

    // end-of-run overlays trigger on phase transitions while playing
    if (!this.ended && snap.phase === 'won') {
      this.ended = true;
      this.showOverlay('won', snap);
    } else if (!this.ended && snap.phase === 'lost') {
      this.ended = true;
      this.showOverlay('lost', snap);
    }

    if (paused && this.overlayMode === null) this.showOverlay('paused');
  }

  showOverlay(mode: OverlayMode, snap?: GameState): void {
    this.overlayMode = mode;
    this.overlay.hidden = false;
    const score = snap ? snap.players[Object.keys(snap.players)[0] ?? '']?.score ?? 0 : 0;
    switch (mode) {
      case 'title':
        this.overlayTitle.textContent = 'Boulder Maze';
        this.overlayBody.textContent =
          'Clear every pellet while dodging the boulders. Super Pellets turn your triangle into a boulder-breaking drill for 8 seconds.';
        this.overlayControls.hidden = false;
        this.primaryBtn.textContent = 'Start';
        this.secondaryBtn.hidden = true;
        this.hudTop.hidden = true;
        break;
      case 'paused':
        this.overlayTitle.textContent = 'Paused';
        this.overlayBody.textContent = 'Simulation halted — pellets and boulders are frozen.';
        this.overlayControls.hidden = true;
        this.primaryBtn.textContent = 'Resume';
        this.secondaryBtn.textContent = 'Restart';
        this.secondaryBtn.hidden = false;
        break;
      case 'won':
        this.overlayTitle.textContent = 'Maze Cleared';
        this.overlayBody.textContent = `Final score: ${score}.`;
        this.overlayControls.hidden = true;
        this.primaryBtn.textContent = 'Play again';
        this.secondaryBtn.hidden = true;
        break;
      case 'lost':
        this.overlayTitle.textContent = 'Run Ended';
        this.overlayBody.textContent =
          `Score: ${score} — ${snap?.pelletsRemaining ?? 0} pellets left.`;
        this.overlayControls.hidden = true;
        this.primaryBtn.textContent = 'Try again';
        this.secondaryBtn.hidden = true;
        break;
    }
    this.primaryBtn.focus();
  }

  hideOverlay(): void {
    this.overlayMode = null;
    this.overlay.hidden = true;
    this.hudTop.hidden = false;
    this.ended = false;
    // return key focus to the page so arrow keys steer, not the button
    (document.activeElement as HTMLElement | null)?.blur();
  }

  get overlayShown(): OverlayMode | null {
    return this.overlayMode;
  }
}
