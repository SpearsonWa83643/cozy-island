import { heightAt } from './Terrain';
import { WORLD_HALF } from './config';

/** Outer shoreline radius per angle (the island is star-shaped enough for this), for swim limits and reef placement. */
const BINS = 720;
let table: Float32Array | null = null;
function build() {
  table = new Float32Array(BINS);
  const max = WORLD_HALF - 2;
  for (let i = 0; i < BINS; i++) {
    const a = (i / BINS) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    let r = max;
    while (r > 2 && heightAt(ca * r, sa * r) < 0) r -= 0.25;
    table[i] = r;
  }
}
export function shoreRadius(ang: number) {
  if (!table) build();
  let f = ((ang / (Math.PI * 2)) % 1 + 1) % 1 * BINS;
  const i = Math.floor(f) % BINS, j = (i + 1) % BINS; f -= Math.floor(f);
  return table![i] * (1 - f) + table![j] * f;
}
/** metres past the outer shoreline (negative = on the island / inland) */
export function offshore(x: number, z: number) { return Math.hypot(x, z) - shoreRadius(Math.atan2(z, x)); }
/** point at a given offshore distance along an angle */
export function atOffshore(ang: number, off: number, out = { x: 0, z: 0 }) {
  const r = shoreRadius(ang) + off; out.x = Math.cos(ang) * r; out.z = Math.sin(ang) * r; return out;
}
/** the swim limit: past this the current gently pulls you back */
export const SWIM_SOFT = 12, SWIM_MAX = 19;
