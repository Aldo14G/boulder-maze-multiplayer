import Phaser from 'phaser';
import {
  allWalkableTiles,
  DIR_VECTORS,
  isWalkable,
} from '@boulder-maze/core';
import type { Direction, GameEvent, GameState, MazeMap, PlayerState, TilePos, Vec } from '@boulder-maze/core';
import type { GameSession } from '../session/LocalGameSession.js';
import type { Hud } from '../ui/hud.js';

/** Design resolution — Phaser.Scale.FIT preserves square tiles everywhere. */
export const TILE_PX = 40;
const MARGIN_X_TILES = 2; // chute tubes live in this band, outside the maze
const MARGIN_TOP_TILES = 1.4;
const MARGIN_BOTTOM_TILES = 0.8;

const DIR_ANGLES: Record<Direction, number> = {
  right: 0,
  down: Math.PI / 2,
  left: Math.PI,
  up: -Math.PI / 2,
};

const BOULDER_COLORS = [0xef476f, 0x06d6a0, 0xf78c6b, 0xb388ff];
const BOULDER_SCARED = 0x9fb4d8;
/** Seat colours, indexed by sorted player id so every client agrees. */
export const PLAYER_COLORS = [0xffe9a3, 0x7dd3fc, 0xc4b5fd, 0x86efac];
const PLAYER_POWERED = 0xff9e4d;
const PELLET_COLOR = 0xd8dee9;
const SUPER_COLOR = 0xffd166;

interface Flash {
  x: number;
  y: number;
  color: number;
  age: number;
}

interface Tube {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class MazeScene extends Phaser.Scene {
  private readonly session: GameSession;
  private readonly hud: Hud;
  private lastSnap!: GameState;
  private gfx!: Phaser.GameObjects.Graphics;
  private stripesGfx!: Phaser.GameObjects.Graphics;
  private maskGfx!: Phaser.GameObjects.Graphics;
  private readonly lastDir = new Map<string, Direction>();
  private flashes: Flash[] = [];
  private animTick = 0;
  private units = 1;

  constructor(session: GameSession, hud: Hud) {
    super('maze');
    this.session = session;
    this.hud = hud;
  }

  static worldSize(map: MazeMap): { width: number; height: number } {
    return {
      width: (map.width + MARGIN_X_TILES * 2) * TILE_PX,
      height: (map.height + MARGIN_TOP_TILES + MARGIN_BOTTOM_TILES) * TILE_PX,
    };
  }

  private originX = 0;
  private originY = 0;

  create(): void {
    const snap = this.session.snapshot();
    this.lastSnap = snap;
    this.units = snap.config.unitsPerTile;
    this.originX = MARGIN_X_TILES * TILE_PX;
    this.originY = MARGIN_TOP_TILES * TILE_PX;

    this.drawStatic(snap.map);
    this.gfx = this.add.graphics();
    this.stripesGfx = this.add.graphics();
    this.maskGfx = this.make.graphics({});
  }

  override update(_time: number, delta: number): void {
    this.session.advance(delta);
    const snap = this.session.snapshot();
    this.lastSnap = snap;
    for (const e of this.session.drainEvents()) this.onEvent(e);
    this.animTick += 1;
    this.drawDynamic(snap);
    this.hud.update(snap, this.session.paused, this.session.localPlayerId);
  }

  // ------------------------------------------------------------------ coords

  private tileX(t: number): number {
    return this.originX + t * TILE_PX;
  }

  private tileY(t: number): number {
    return this.originY + t * TILE_PX;
  }

  private unitToPx(p: Vec): Vec {
    return {
      x: this.originX + (p.x / this.units) * TILE_PX,
      y: this.originY + (p.y / this.units) * TILE_PX,
    };
  }

  /** Pixel rect of the spawn tube feeding `entry` from outside the maze. */
  private tubeRect(entry: TilePos, inward: Direction, map: MazeMap): Tube {
    const y = this.tileY(entry.y) + TILE_PX * 0.15;
    const h = TILE_PX * 0.7;
    const len = TILE_PX * 1.7;
    if (inward === 'right') {
      // west chute: tube mouth is the left board edge (wall face at x=0)
      return { x: this.tileX(0) - len, y, w: len + TILE_PX, h };
    }
    // east chute: mouth at the right board edge
    return { x: this.tileX(map.width - 1), y, w: len + TILE_PX, h };
  }

  // ------------------------------------------------------------------ static

  private drawStatic(map: MazeMap): void {
    const g = this.add.graphics();
    g.fillStyle(0x171c48, 1);
    g.fillRect(0, 0, this.scale.width, this.scale.height);

    for (const t of allWalkableTiles(map)) {
      g.fillStyle(0x212a6b, 1);
      g.fillRect(this.tileX(t.x), this.tileY(t.y), TILE_PX, TILE_PX);
    }

    // wall outlines: stroke each walkable/non-walkable shared edge once
    g.lineStyle(3, 0x9aa3e0, 1);
    for (const t of allWalkableTiles(map)) {
      for (const v of Object.values(DIR_VECTORS)) {
        const n = { x: t.x + v.x, y: t.y + v.y };
        if (isWalkable(map, n)) continue;
        const x0 = this.tileX(t.x);
        const y0 = this.tileY(t.y);
        if (v.x === 1) g.lineBetween(x0 + TILE_PX, y0, x0 + TILE_PX, y0 + TILE_PX);
        else if (v.x === -1) g.lineBetween(x0, y0, x0, y0 + TILE_PX);
        else if (v.y === 1) g.lineBetween(x0, y0 + TILE_PX, x0 + TILE_PX, y0 + TILE_PX);
        else g.lineBetween(x0, y0, x0 + TILE_PX, y0);
      }
    }

    // chute tubes + entry markers
    for (const chute of map.chutes) {
      const tube = this.tubeRect(chute.entry, chute.inward, map);
      g.fillStyle(0x1d2558, 1);
      g.fillRoundedRect(tube.x, tube.y, tube.w, tube.h, 6);
      g.lineStyle(2, 0x9aa3e0, 1);
      g.strokeRoundedRect(tube.x, tube.y, tube.w, tube.h, 6);
      const midY = tube.y + tube.h / 2;
      g.lineStyle(1, 0x2b3585, 1);
      g.lineBetween(tube.x, midY, tube.x + tube.w, midY);
      // entry hatch on the maze side
      const ex = chute.inward === 'right' ? this.tileX(0) : this.tileX(map.width - 1);
      g.lineStyle(3, 0xffffff, 1);
      g.lineBetween(ex, this.tileY(chute.entry.y) + 4, ex, this.tileY(chute.entry.y) + TILE_PX - 4);
    }
  }

  // ----------------------------------------------------------------- dynamic

  private drawDynamic(snap: GameState): void {
    const g = this.gfx;
    g.clear();
    this.stripesGfx.clear();
    this.maskGfx.clear();
    this.stripesGfx.clearMask();

    this.drawChuteWarnings(g, snap);
    this.drawPellets(g, snap);
    this.drawBoulders(g, snap);
    const ids = Object.keys(snap.players).sort();
    ids.forEach((id, i) => {
      if (id !== this.session.localPlayerId) this.drawPlayer(g, snap, snap.players[id]!, PLAYER_COLORS[i % PLAYER_COLORS.length]!, false);
    });
    const meIdx = ids.indexOf(this.session.localPlayerId ?? '');
    if (meIdx >= 0) this.drawPlayer(g, snap, snap.players[ids[meIdx]!]!, PLAYER_COLORS[meIdx % PLAYER_COLORS.length]!, true);
    this.drawFlashes(g);
  }

  private drawChuteWarnings(g: Phaser.GameObjects.Graphics, snap: GameState): void {
    const blinkOn = Math.floor(this.animTick / 10) % 2 === 0;
    if (!blinkOn) return;
    for (const b of Object.values(snap.boulders)) {
      if (b.status !== 'pending' || !b.warningShown) continue;
      const chute = snap.map.chutes.find((c) => c.id === b.chuteId);
      if (!chute) continue;
      const tube = this.tubeRect(chute.entry, chute.inward, snap.map);
      g.lineStyle(3, 0xffd166, 1);
      g.strokeRoundedRect(tube.x - 2, tube.y - 2, tube.w + 4, tube.h + 4, 7);
    }
  }

  private drawPellets(g: Phaser.GameObjects.Graphics, snap: GameState): void {
    for (const [idxStr, kind] of Object.entries(snap.pellets)) {
      const idx = Number(idxStr);
      const tx = idx % snap.map.width;
      const ty = Math.floor(idx / snap.map.width);
      const cx = this.tileX(tx) + TILE_PX / 2;
      const cy = this.tileY(ty) + TILE_PX / 2;
      if (kind === 'super') {
        const r = TILE_PX * 0.28 + Math.sin(this.animTick / 8) * 2.5;
        g.fillStyle(SUPER_COLOR, 0.25);
        g.fillCircle(cx, cy, r + 4);
        g.fillStyle(SUPER_COLOR, 1);
        g.fillCircle(cx, cy, r);
        g.lineStyle(1.5, 0xfff3cf, 1);
        g.strokeCircle(cx, cy, r);
      } else {
        g.fillStyle(PELLET_COLOR, 1);
        g.fillCircle(cx, cy, TILE_PX * 0.11);
      }
    }
  }

  private drawBoulders(g: Phaser.GameObjects.Graphics, snap: GameState): void {
    const powered = Object.values(snap.players).some((p) => p.alive && p.powerTicks > 0);
    Object.values(snap.boulders).forEach((b, i) => {
      if (b.status !== 'active') return;
      const p = this.unitToPx(b.pos);
      const r = TILE_PX * 0.42;
      const color = powered ? BOULDER_SCARED : BOULDER_COLORS[i % BOULDER_COLORS.length]!;
      const sides = 8;
      const pts: { x: number; y: number }[] = [];
      for (let k = 0; k < sides; k++) {
        const a = (Math.PI * 2 * k) / sides + Math.PI / 8;
        pts.push({ x: p.x + r * Math.cos(a), y: p.y + r * Math.sin(a) });
      }
      g.fillStyle(color, 1);
      g.fillPoints(pts, true);
      g.lineStyle(powered ? 3 : 2, powered ? 0xffffff : 0x0a0d29, 1);
      g.strokePoints(pts, true);
      // facet: inner octagon
      const inner = pts.map((pt) => ({ x: p.x + (pt.x - p.x) * 0.55, y: p.y + (pt.y - p.y) * 0.55 }));
      g.lineStyle(1.5, 0x0a0d29, 0.7);
      g.strokePoints(inner, true);
      // per-boulder marking
      g.lineStyle(2.5, 0x0a0d29, 0.9);
      switch (i % 4) {
        case 0:
          g.fillStyle(0x0a0d29, 0.9);
          g.fillCircle(p.x, p.y, r * 0.16);
          break;
        case 1:
          g.lineBetween(p.x - r * 0.5, p.y, p.x + r * 0.5, p.y);
          break;
        case 2:
          g.lineBetween(p.x - r * 0.35, p.y - r * 0.35, p.x + r * 0.35, p.y + r * 0.35);
          g.lineBetween(p.x - r * 0.35, p.y + r * 0.35, p.x + r * 0.35, p.y - r * 0.35);
          break;
        default:
          g.strokeCircle(p.x, p.y, r * 0.28);
      }
    });
  }

  private drawPlayer(
    g: Phaser.GameObjects.Graphics,
    snap: GameState,
    player: PlayerState,
    color: number,
    isLocal: boolean,
  ): void {
    const pos = this.unitToPx(player.pos);
    const dir = player.dir ?? this.lastDir.get(player.id) ?? 'right';
    if (player.dir) this.lastDir.set(player.id, player.dir);

    const ang = DIR_ANGLES[dir];
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    const rot = (x: number, y: number): Vec => ({
      x: pos.x + x * cos - y * sin,
      y: pos.y + x * sin + y * cos,
    });
    const apex = rot(TILE_PX * 0.44, 0);
    const base1 = rot(-TILE_PX * 0.3, -TILE_PX * 0.3);
    const base2 = rot(-TILE_PX * 0.3, TILE_PX * 0.3);
    const tri = new Phaser.Geom.Triangle(apex.x, apex.y, base1.x, base1.y, base2.x, base2.y);

    if (!player.alive) {
      g.lineStyle(2, color, 0.35);
      g.strokeTriangleShape(tri);
      return;
    }

    const powered = player.powerTicks > 0;
    g.fillStyle(powered ? PLAYER_POWERED : color, 1);
    g.fillTriangleShape(tri);
    if (isLocal) {
      g.lineStyle(2, 0xffffff, 0.9);
      g.strokeCircle(pos.x, pos.y, TILE_PX * 0.5);
    }

    if (powered) {
      // animated drill bands clipped to the triangle
      this.maskGfx.fillStyle(0xffffff, 1);
      this.maskGfx.fillTriangleShape(tri);
      this.stripesGfx.setMask(this.maskGfx.createGeometryMask());
      const slide = (this.animTick * 2.2) % (TILE_PX * 0.6);
      this.stripesGfx.lineStyle(5, 0xc25a1f, 0.95);
      const perpAng = ang + Math.PI / 4;
      const dx = Math.cos(perpAng);
      const dy = Math.sin(perpAng);
      for (let o = -TILE_PX; o <= TILE_PX; o += TILE_PX * 0.6) {
        const ox = dx * (o + slide);
        const oy = dy * (o + slide);
        this.stripesGfx.lineBetween(
          pos.x + ox - dy * TILE_PX,
          pos.y + oy + dx * TILE_PX,
          pos.x + ox + dy * TILE_PX,
          pos.y + oy - dx * TILE_PX,
        );
      }
      // contrasting outline
      const warning = player.powerTicks <= snap.config.powerWarningTicks;
      const outline = warning && Math.floor(this.animTick / 8) % 2 === 0 ? 0xef476f : 0xffffff;
      g.lineStyle(3, outline, 1);
      g.strokeTriangleShape(tri);
      // duration ring
      const frac = player.powerTicks / snap.config.powerTicks;
      g.lineStyle(3.5, 0x4dd0e1, 1);
      g.beginPath();
      g.arc(pos.x, pos.y, TILE_PX * 0.62, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2, false);
      g.strokePath();
    } else {
      g.lineStyle(2, 0x171c48, 1);
      g.strokeTriangleShape(tri);
    }
  }

  // ------------------------------------------------------------------- fx

  private onEvent(e: GameEvent): void {
    const snap = this.lastSnap;
    if (e.type === 'pelletCollected') {
      const tx = e.tile % snap.map.width;
      const ty = Math.floor(e.tile / snap.map.width);
      this.flashes.push({
        x: this.tileX(tx) + TILE_PX / 2,
        y: this.tileY(ty) + TILE_PX / 2,
        color: PELLET_COLOR,
        age: 0,
      });
    } else if (e.type === 'powerStarted') {
      const player = snap.players[e.playerId];
      if (!player) return;
      const p = this.unitToPx(player.pos);
      this.flashes.push({ x: p.x, y: p.y, color: SUPER_COLOR, age: 0 });
    } else if (e.type === 'boulderDestroyed' || e.type === 'boulderReleased') {
      const boulder = snap.boulders[e.boulderId];
      if (!boulder) return;
      const p = this.unitToPx(boulder.pos);
      this.flashes.push({
        x: p.x,
        y: p.y,
        color: e.type === 'boulderDestroyed' ? 0xff9e4d : 0xffd166,
        age: 0,
      });
    } else if (e.type === 'playerDefeated' || e.type === 'playerForfeited' || e.type === 'gameWon') {
      const player = snap.players[e.playerId];
      if (player) {
        const p = this.unitToPx(player.pos);
        this.flashes.push({
          x: p.x,
          y: p.y,
          color: e.type === 'gameWon' ? 0x06d6a0 : 0xef476f,
          age: 0,
        });
      }
    }
  }

  private drawFlashes(g: Phaser.GameObjects.Graphics): void {
    for (const f of this.flashes) {
      const t = f.age / 24;
      const alpha = Math.max(0, 1 - t);
      g.lineStyle(2.5, f.color, alpha);
      g.strokeCircle(f.x, f.y, TILE_PX * (0.2 + t * 0.7));
      f.age += 1;
    }
    this.flashes = this.flashes.filter((f) => f.age < 24);
  }
}
