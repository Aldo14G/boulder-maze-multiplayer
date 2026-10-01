/** Orthogonal grid directions. Movement is never diagonal. */
export type Direction = 'up' | 'down' | 'left' | 'right';

export const DIRECTIONS: readonly Direction[] = ['up', 'left', 'down', 'right'];

export interface Vec {
  readonly x: number;
  readonly y: number;
}

export const DIR_VECTORS: Record<Direction, Vec> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export const OPPOSITE: Record<Direction, Direction> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
};

/** Integer tile coordinate inside the maze grid. */
export interface TilePos {
  readonly x: number;
  readonly y: number;
}
