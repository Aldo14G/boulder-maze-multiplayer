/**
 * mulberry32: tiny deterministic PRNG. Its whole state is a single uint32,
 * which is stored inside GameState so serialize/restore and replays resume
 * the stream exactly. Gameplay decisions are deterministic without it; the
 * state is kept for future nondeterministic needs (e.g. spawn jitter) and is
 * never seeded from wall-clock time.
 */
export function seedRng(seed: number): number {
  return seed >>> 0;
}

export function nextRandom(rngState: number): { state: number; value: number } {
  let t = (rngState + 0x6d2b79f5) >>> 0;
  let r = t;
  r = Math.imul(r ^ (r >>> 15), r | 1);
  r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
  const value = ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  return { state: t, value };
}
