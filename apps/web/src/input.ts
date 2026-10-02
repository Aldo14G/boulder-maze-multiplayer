import type { Direction } from '@boulder-maze/core';
import type { GameSession } from './session/LocalGameSession.js';

const KEY_DIRECTIONS: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
  W: 'up',
  S: 'down',
  A: 'left',
  D: 'right',
};

/**
 * Arrow keys + WASD steering, P/Escape pause. Held-key state is tracked so
 * focus loss can clear it — no key may "stick" into the resumed session.
 */
export class KeyboardAdapter {
  private readonly held = new Set<string>();

  constructor(
    private readonly session: GameSession,
    private readonly onPauseKey: () => void,
  ) {}

  attach(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const dir = KEY_DIRECTIONS[e.key];
    if (dir) {
      e.preventDefault();
      this.held.add(e.key);
      this.session.submitDirection(dir);
      return;
    }
    if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
      e.preventDefault();
      this.onPauseKey();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.held.delete(e.key);
  };

  private onBlur = (): void => {
    this.held.clear();
    this.session.onFocusLost();
  };

  private onVisibility = (): void => {
    if (document.hidden) {
      this.held.clear();
      this.session.onFocusLost();
    }
  };
}
