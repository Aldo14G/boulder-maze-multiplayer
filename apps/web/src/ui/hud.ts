import type { GameState } from '@boulder-maze/core';
import type { LobbyPlayer } from '@boulder-maze/server/protocol';
import type { NetStats } from '../session/RemoteGameSession.js';

export type OverlayMode = 'title' | 'paused' | 'won' | 'lost' | 'lobby' | 'offline';

export interface HudCallbacks {
  onPrimary: () => void;
  onSecondary: () => void;
  onPauseButton: () => void;
}

/** Seat colours by sorted player index; mirrors MazeScene.PLAYER_COLORS. */
const SEAT_VARS = ['--seat-1', '--seat-2', '--seat-3', '--seat-4'];

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

function seatDot(index: number): HTMLSpanElement {
  const dot = document.createElement('span');
  dot.className = 'seat-dot';
  dot.style.setProperty('--seat', `var(${SEAT_VARS[index % SEAT_VARS.length]})`);
  dot.setAttribute('aria-hidden', 'true');
  return dot;
}

/**
 * DOM HUD — deliberately kept out of the Phaser canvas so the multiplayer
 * port can reuse the DOM layer unchanged.
 */
export class Hud {
  private readonly hudTop = el<HTMLElement>('hud-top');
  private readonly scoreEl = el<HTMLSpanElement>('hud-score');
  private readonly teamWrap = el<HTMLDivElement>('hud-team-wrap');
  private readonly teamEl = el<HTMLSpanElement>('hud-team');
  private readonly pelletsEl = el<HTMLSpanElement>('hud-pellets');
  private readonly drill = el<HTMLDivElement>('hud-drill');
  private readonly drillFill = el<HTMLSpanElement>('hud-drill-fill');
  private readonly seatsEl = el<HTMLUListElement>('hud-seats');
  private readonly pauseBtn = el<HTMLButtonElement>('btn-pause');
  private readonly readyEl = el<HTMLDivElement>('ready-text');
  private readonly netEl = el<HTMLDivElement>('hud-net');
  private readonly overlay = el<HTMLDivElement>('overlay');
  private readonly overlayTitle = el<HTMLHeadingElement>('overlay-title');
  private readonly overlayBody = el<HTMLParagraphElement>('overlay-body');
  private readonly overlayControls = el<HTMLUListElement>('overlay-controls');
  private readonly controlNet = el<HTMLLIElement>('control-net');
  private readonly roster = el<HTMLUListElement>('lobby-roster');
  private readonly invite = el<HTMLParagraphElement>('lobby-invite');
  private readonly primaryBtn = el<HTMLButtonElement>('btn-primary');
  private readonly secondaryBtn = el<HTMLButtonElement>('btn-secondary');

  private overlayMode: OverlayMode | null = 'title';
  private ended = false;
  private names = new Map<string, string>();
  private seatsKey = '';

  constructor(cb: HudCallbacks) {
    this.primaryBtn.addEventListener('click', cb.onPrimary);
    this.secondaryBtn.addEventListener('click', cb.onSecondary);
    this.pauseBtn.addEventListener('click', cb.onPauseButton);
    this.showOverlay('title');
  }

  update(snap: GameState, paused: boolean, localPlayerId: string | null): void {
    const ids = Object.keys(snap.players).sort();
    const player = snap.players[localPlayerId ?? ''];
    const team = ids.reduce((sum, id) => sum + snap.players[id]!.score, 0);
    const multi = ids.length > 1;
    this.scoreEl.textContent = String(player?.score ?? 0);
    this.teamWrap.hidden = !multi;
    this.teamEl.textContent = String(team);
    this.pelletsEl.textContent = String(snap.pelletsRemaining);
    this.renderSeats(snap, ids, localPlayerId);

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
      this.readyEl.textContent = secsLeft > 0 ? `Ready ${secsLeft}` : 'Go';
    } else if (snap.phase === 'playing' && player && !player.alive) {
      this.readyEl.hidden = false;
      this.readyEl.textContent = 'Spectating';
    } else {
      this.readyEl.hidden = true;
    }

    // end-of-run overlays trigger on phase transitions while playing
    if (!this.ended && snap.phase === 'won') {
      this.ended = true;
      this.showOverlay('won', snap, localPlayerId);
    } else if (!this.ended && snap.phase === 'lost') {
      this.ended = true;
      this.showOverlay('lost', snap, localPlayerId);
    }

    if (paused && this.overlayMode === null) this.showOverlay('paused');
  }

  /** Rebuilds the seat strip only when something visible changed. */
  private renderSeats(snap: GameState, ids: string[], me: string | null): void {
    if (ids.length <= 1) {
      this.seatsEl.hidden = true;
      return;
    }
    this.seatsEl.hidden = false;
    const key = ids.map((id) => `${id}:${snap.players[id]!.score}:${snap.players[id]!.alive ? 1 : 0}:${snap.players[id]!.powerTicks > 0 ? 1 : 0}`).join('|');
    if (key === this.seatsKey) return;
    this.seatsKey = key;
    this.seatsEl.replaceChildren(
      ...ids.map((id, i) => {
        const p = snap.players[id]!;
        const li = document.createElement('li');
        li.className = `hud-seat${id === me ? ' me' : ''}${p.alive ? '' : ' out'}`;
        li.append(seatDot(i), `${this.names.get(id) ?? id} ${p.score}${p.powerTicks > 0 ? ' ⚡' : ''}`);
        return li;
      }),
    );
  }

  showOverlay(mode: OverlayMode, snap?: GameState, localPlayerId: string | null = null): void {
    this.overlayMode = mode;
    this.overlay.hidden = false;
    this.roster.hidden = true;
    this.invite.hidden = true;
    this.overlayBody.hidden = false;
    const score = snap ? snap.players[localPlayerId ?? '']?.score ?? 0 : 0;
    const multi = snap ? Object.keys(snap.players).length > 1 : false;
    const team = snap ? Object.values(snap.players).reduce((s, p) => s + p.score, 0) : 0;
    const again = multi ? 'Ready for next match' : undefined;
    switch (mode) {
      case 'title':
        this.overlayTitle.textContent = 'Boulder Maze';
        this.overlayBody.textContent =
          'Clear every pellet while dodging the boulders. Super Pellets turn your triangle into a boulder-breaking drill for 8 seconds.';
        this.overlayControls.hidden = false;
        this.primaryBtn.textContent = 'Start';
        this.secondaryBtn.textContent = 'Play online';
        this.secondaryBtn.hidden = false;
        this.hudTop.hidden = true;
        break;
      case 'lobby':
        this.overlayTitle.textContent = 'Lobby';
        this.overlayControls.hidden = false;
        this.primaryBtn.textContent = 'Ready';
        this.secondaryBtn.hidden = true;
        this.hudTop.hidden = true;
        break;
      case 'offline':
        this.overlayTitle.textContent = 'Disconnected';
        this.overlayControls.hidden = true;
        this.primaryBtn.textContent = 'Back to title';
        this.secondaryBtn.hidden = true;
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
        this.overlayBody.textContent = multi ? `Team score ${team} — you scored ${score}.` : `Final score: ${score}.`;
        this.overlayControls.hidden = true;
        this.primaryBtn.textContent = again ?? 'Play again';
        this.secondaryBtn.hidden = true;
        break;
      case 'lost':
        this.overlayTitle.textContent = multi ? 'Team Wiped' : 'Run Ended';
        this.overlayBody.textContent = multi
          ? `Team score ${team} — ${snap?.pelletsRemaining ?? 0} pellets left.`
          : `Score: ${score} — ${snap?.pelletsRemaining ?? 0} pellets left.`;
        this.overlayControls.hidden = true;
        this.primaryBtn.textContent = again ?? 'Try again';
        this.secondaryBtn.hidden = true;
        break;
    }
    this.primaryBtn.focus();
  }

  /** Lobby roster; call after showOverlay('lobby') and on every roster change. */
  setLobby(players: LobbyPlayer[], me: string | null, status: string, inviteUrl?: string): void {
    for (const p of players) this.names.set(p.id, p.name);
    this.overlayBody.textContent = status;
    const sorted = [...players].sort((a, b) => a.id.localeCompare(b.id));
    this.roster.hidden = sorted.length === 0;
    this.roster.replaceChildren(
      ...sorted.map((p, i) => {
        const li = document.createElement('li');
        li.className = `lobby-row${p.id === me ? ' me' : ''}${p.connected ? '' : ' left'}`;
        const name = document.createElement('span');
        name.textContent = p.id === me ? `${p.name} (you)` : p.name;
        const badge = document.createElement('span');
        badge.className = `px-badge ${p.ready ? 'px-badge--success' : 'px-badge--outline'}`;
        badge.textContent = !p.connected ? 'left' : p.ready ? 'ready' : 'waiting';
        li.append(seatDot(i), name, badge);
        return li;
      }),
    );
    if (inviteUrl) {
      this.invite.hidden = false;
      this.invite.replaceChildren('Friends join at', Object.assign(document.createElement('code'), { textContent: inviteUrl }));
    }
    const mine = sorted.find((p) => p.id === me);
    this.primaryBtn.textContent = mine?.ready ? 'Not ready' : 'Ready';
  }

  setBody(text: string): void {
    this.overlayBody.textContent = text;
  }

  setPauseAvailable(available: boolean): void {
    this.pauseBtn.hidden = !available;
    this.controlNet.hidden = available;
  }

  /** Netgraph; pass null to hide. */
  updateNet(stats: NetStats | null): void {
    this.netEl.hidden = stats === null;
    if (!stats) return;
    this.netEl.replaceChildren();
    const mode = document.createElement('span');
    mode.className = stats.prediction ? 'on' : 'off';
    mode.textContent = `predict ${stats.prediction ? 'ON ' : 'OFF'} [N]`;
    const row = (label: string, value: string) => `\n${label.padEnd(7)}${value.padStart(8)}`;
    this.netEl.append(
      mode,
      row('rtt', `${stats.rttMs} ms`),
      row('lead', `${stats.leadTicks}t +${stats.aheadTicks}t`),
      row('snaps', `${stats.snapshotsPerSecond}/s`),
      row('net', `${stats.kbPerSecond} KB/s`),
      row('fix', `${stats.lastCorrectionUnits}u`),
      row('resync', String(stats.resyncs)),
    );
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
