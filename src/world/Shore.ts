import { heightAt } from './Terrain';
import { WORLD_HALF } from './config';
import { ISLETS } from './config';
import { isletOffshore } from './isletGrid';

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

/**
 * Nearest landmass (Order 42a): the main island or an archipelago islet. `off` = metres past that
 * shore (negative = on land), (cx, cz) = its centre, for currents / leashes that push back to land.
 */
export function nearestLand(x: number, z: number, out = { off: 0, cx: 0, cz: 0, islet: -1 }) {
  out.off = offshore(x, z); out.cx = 0; out.cz = 0; out.islet = -1;
  for (let k = 0; k < ISLETS.length; k++) {
    const o = isletOffshore(k, x, z);
    if (o < out.off) { out.off = o; out.cx = ISLETS[k].x; out.cz = ISLETS[k].z; out.islet = k; }
  }
  return out;
}
