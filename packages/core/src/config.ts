/**
 * All gameplay tuning lives in this one typed object. Speeds are expressed in
 * sub-tile units per tick: with unitsPerTile = 60 and tickRate = 60 Hz,
 * playerSpeed = 5 means exactly 5 tiles/second.
 */
/** Upper bound on simultaneous players a map must be able to seat. */
export const MAX_PLAYERS = 4;

export interface GameConfig {
  /** Fixed simulation rate. */
  readonly tickRate: number;
  /** Sub-tile units per tile. Positions are integers in this unit space. */
  readonly unitsPerTile: number;
  /** Player speed in units/tick (5 = 5 tiles/s). */
  readonly playerSpeed: number;
  /** Boulder speed in units/tick (4 = 4 tiles/s). */
  readonly boulderSpeed: number;
  /** Boulder speed while the player drill is active (3 = 3 tiles/s). */
  readonly poweredBoulderSpeed: number;
  /** Drill duration: 8 s. A second Super Pellet resets, it does not add. */
  readonly powerTicks: number;
  /** HUD/FX warning window at the end of drill mode: final 2 s. */
  readonly powerWarningTicks: number;
  /** Delay before a destroyed boulder re-enters through its chute: 3 s. */
  readonly respawnTicks: number;
  /** Ready countdown before play begins: 2 s. */
  readonly readyTicks: number;
  /** Stagger between initial boulder releases: 1.5 s. */
  readonly releaseGapTicks: number;
  /** How long before a release/respawn the chute warning shows: 1 s. */
  readonly chuteWarnTicks: number;
  /** Contact radius in sub-tile units (0.4 tile). */
  readonly contactRadius: number;
  readonly normalPelletScore: number;
  readonly superPelletScore: number;
  readonly boulderScore: number;
}

export const DEFAULT_CONFIG: GameConfig = {
  tickRate: 60,
  unitsPerTile: 60,
  playerSpeed: 5,
  boulderSpeed: 4,
  poweredBoulderSpeed: 3,
  powerTicks: 480,
  powerWarningTicks: 120,
  respawnTicks: 180,
  readyTicks: 120,
  releaseGapTicks: 90,
  chuteWarnTicks: 60,
  contactRadius: 24,
  normalPelletScore: 10,
  superPelletScore: 50,
  boulderScore: 200,
};
