/**
 * Archipelago islet height grids (Order 42a). Pure (no three.js), shared by heightAt() and the islet
 * terrain/physics. Until an islet's grid has been generated (in a worker), lookups fall back to the
 * same analytic function, so heights never change when the grid lands — only get cheaper.
 */
import { ISLETS, ISLET_SIZE, ISLET_RES, OUT_OF_WORLD_DEPTH } from './config';
import { isletHeightRaw, isletShoreR } from './gen';

export const ISLET_SEG = Math.round(ISLET_SIZE / ISLET_RES);
/** samples per side */
export const ISLET_N = ISLET_SEG + 1;
const HALF = ISLET_SIZE / 2;
const grids: (Float32Array | null)[] = ISLETS.map(() => null);

export function isletGrid(k: number) { return grids[k]; }
export function setIsletGrid(k: number, g: Float32Array) {
  if (g.length !== ISLET_N * ISLET_N) throw new Error(`setIsletGrid: bad length ${g.length}`);
  grids[k] = g;
}
/** index of the islet whose height-field extent contains (x, z), or -1 */
export function isletIndexAt(x: number, z: number, margin = 0) {
  for (let k = 0; k < ISLETS.length; k++) {
    const d = ISLETS[k];
    if (Math.abs(x - d.x) <= HALF + margin && Math.abs(z - d.z) <= HALF + margin) return k;
  }
  return -1;
}
/** height outside the main island grid: islet grid (bilinear), analytic islet, or the open-sea floor */
export function isletHeightAt(x: number, z: number): number {
  const k = isletIndexAt(x, z);
  if (k < 0) return OUT_OF_WORLD_DEPTH;
  const d = ISLETS[k], g = grids[k];
  if (!g) return isletHeightRaw(d, x, z);
  let fx = (x - d.x + HALF) / ISLET_RES, fz = (z - d.z + HALF) / ISLET_RES;
  if (fx < 0 || fz < 0 || fx >= ISLET_N - 1 || fz >= ISLET_N - 1) return OUT_OF_WORLD_DEPTH;
  const i = Math.floor(fx), j = Math.floor(fz);
  fx -= i; fz -= j;
  const a = j * ISLET_N + i;
  return (g[a] * (1 - fx) + g[a + 1] * fx) * (1 - fz) + (g[a + ISLET_N] * (1 - fx) + g[a + ISLET_N + 1] * fx) * fz;
}
/** approx. metres past islet k's shoreline (negative = on the islet); the sand line sits ~0.88 R */
export function isletOffshore(k: number, x: number, z: number) {
  const d = ISLETS[k];
  return Math.hypot(x - d.x, z - d.z) - isletShoreR(d, Math.atan2(z - d.z, x - d.x)) * 0.88;
}
