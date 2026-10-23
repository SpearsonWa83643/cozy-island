/**
 * Pure world-generation core (Big island 5/7, Order 39a): island height + biome weights.
 * No three.js / DOM imports, so it runs unchanged on the main thread and inside the
 * generation Web Worker (gen.worker.ts) — same code, same seeds → bit-identical output.
 */
import { Noise2D } from './noise';
import { ISLAND_SCALE, BASE_RADIUS, ISLAND_RADIUS, BASE_CENTERS, BASE_POND, ISLETS, OUT_OF_WORLD_DEPTH, type IsletDef } from './config';

export const BIOME_COUNT = 6;
/** must match the Biome enum in Biomes.ts */
const MEADOW = 0, ALPINE = 1, AUTUMN = 2, TROPICAL = 3, DESERT = 4, MARSH = 5;

export const noise = new Noise2D(7);
export const noiseB = new Noise2D(23);
export const noiseC = new Noise2D(57);
const warp = new Noise2D(311);

export const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Normalised biome weights in unscaled layout coordinates (domain-warped so borders meander). */
export function biomeWeightsBase(x: number, z: number, out: Float32Array = new Float32Array(BIOME_COUNT)) {
  const wx = x + warp.fbm(x * 0.035, z * 0.035, 3) * 9;
  const wz = z + warp.fbm(x * 0.035 + 40, z * 0.035 - 17, 3) * 9;
  let sum = 0;
  for (let i = 0; i < BIOME_COUNT; i++) {
    const [cx, cz, s] = BASE_CENTERS[i];
    const d2 = (wx - cx) ** 2 + (wz - cz) ** 2;
    let w = Math.exp(-d2 / (2 * s * s));
    if (i === MEADOW) w = w * 1.0 + 0.04;
    w = w * w * w; // sharpen: distinct zones with ~6-10 m blends
    out[i] = w; sum += w;
  }
  for (let i = 0; i < BIOME_COUNT; i++) out[i] /= sum;
  return out;
}
/** same, at a world position */
export function biomeWeightsRaw(x: number, z: number, out: Float32Array = new Float32Array(BIOME_COUNT)) {
  return biomeWeightsBase(x / ISLAND_SCALE, z / ISLAND_SCALE, out);
}

const wRaw = new Float32Array(BIOME_COUNT);
/** Analytic island height (slow: used to build the cached grid). */
export function heightRaw(wx: number, wz: number): number {
  // evaluate the original layout at scaled coordinates (bigger island, same heights → gentler, roomier)
  const x = wx / ISLAND_SCALE, z = wz / ISLAND_SCALE;
  const ang = Math.atan2(z, x);
  const wobble = 1 + 0.14 * noise.noise(Math.cos(ang) * 1.3 + 3, Math.sin(ang) * 1.3 + 3)
    + 0.06 * noise.noise(Math.cos(ang) * 3 + 9, Math.sin(ang) * 3 + 9);
  const r = Math.hypot(x, z) / (BASE_RADIUS * wobble);
  const w = biomeWeightsBase(x, z, wRaw);
  // tropical side gets a wider, flatter beach
  const beachW = 0.3 + w[TROPICAL] * 0.12 - w[ALPINE] * 0.15;
  const land = smooth(1.04, 1.04 - beachW, r);
  const hillMask = smooth(0.98, 0.55, r);

  const hills = noise.fbm(x * 0.045 + 10, z * 0.045 - 4, 4) * 0.5 + 0.5;
  const bumps = noiseB.fbm(x * 0.12, z * 0.12, 3) * 0.25;
  const meadow = hills * 2.4 + bumps + 2.2 * Math.exp(-((x - 8) ** 2 + (z + 6) ** 2) / 90);

  const [ax, az] = BASE_CENTERS[ALPINE];
  const da2 = (x - ax) ** 2 + (z - az) ** 2;
  const ridge = 1 - Math.abs(noiseC.fbm(x * 0.06, z * 0.06, 4));
  const alpine = 2 + 12.5 * Math.exp(-da2 / (2 * 10 * 10)) + ridge * ridge * 3.2 * Math.exp(-da2 / 400) + bumps;

  const autumn = 2.2 + (noise.fbm(x * 0.07 + 70, z * 0.07, 4) * 0.5 + 0.5) * 3.2 + bumps;

  const tropical = 0.7 + (noiseB.fbm(x * 0.05 + 5, z * 0.05 + 9, 3) * 0.5 + 0.5) * 1.1;

  // desert: sandstone mesas with terraced sides
  const mn = noiseC.fbm(x * 0.055 + 31, z * 0.055 - 12, 3);
  const mesa = smooth(0.02, 0.16, mn) * 3.6 + smooth(0.3, 0.42, mn) * 2.2;
  const terr = Math.floor(mesa / 0.9) * 0.9;
  const desert = 1.3 + mesa * 0.35 + terr * 0.65 + (noiseB.fbm(x * 0.09, z * 0.09, 2)) * 0.25;

  // marsh: low and soggy, with a pond and puddles
  const dp = Math.hypot(x - BASE_POND.x, z - BASE_POND.z) / BASE_POND.r;
  const puddles = Math.min(0, noiseC.fbm(x * 0.18 + 3, z * 0.18 + 8, 2) + 0.28) * 2.5;
  const marsh = 0.62 + bumps * 0.5 + puddles - 2.7 * smooth(1.25, 0.3, dp);

  const inland = w[MEADOW] * meadow + w[ALPINE] * alpine + w[AUTUMN] * autumn + w[TROPICAL] * tropical + w[DESERT] * desert + w[MARSH] * marsh;
  let h = land * 1.1 + hillMask * inland;
  // seabed: a shallow, bumpy reef shelf ~16 m wide (swimmable, visible through clear water), then a drop-off
  const past = Math.max(0, r - 1.04) * ISLAND_RADIUS * wobble; // world metres past the beach
  const reefBump = noiseB.fbm(x * 0.16 + 40, z * 0.16 - 20, 2) * 0.45 * smooth(0, 4, past);
  const shelf = 1.75 + reefBump + smooth(13, 24, past) * 2.6;
  h -= (1 - land) * shelf;
  return h;
}

/**
 * A rectangular block of grid samples: columns i ∈ [i0, i0+w), rows j ∈ [j0, j0+h) of a square grid
 * with `res` m spacing whose sample (0,0) sits at world (-size/2, -size/2).
 */
export interface GenRegion { size: number; res: number; i0: number; j0: number; w: number; h: number; /** sample islet #k (grid centred on the islet) instead of the main island */ islet?: number }

/** heights for a region, row-major */
export function sampleHeights(r: GenRegion, out = new Float32Array(r.w * r.h)) {
  const d = r.islet != null ? ISLETS[r.islet] : null;
  for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) {
    const x = (r.i0 + i) * r.res - r.size / 2, z = (r.j0 + j) * r.res - r.size / 2;
    out[j * r.w + i] = d ? isletHeightRaw(d, x + d.x, z + d.z) : heightRaw(x, z);
  }
  return out;
}
/** biome weights for a region, row-major, BIOME_COUNT floats per sample */
export function sampleBiomes(r: GenRegion, out = new Float32Array(r.w * r.h * BIOME_COUNT)) {
  const tmp = new Float32Array(BIOME_COUNT);
  for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) {
    biomeWeightsRaw((r.i0 + i) * r.res - r.size / 2, (r.j0 + j) * r.res - r.size / 2, tmp);
    out.set(tmp, (j * r.w + i) * BIOME_COUNT);
  }
  return out;
}

// ---------------------------------------------------------------- archipelago islets (Order 42)
const isletNoise = new Map<number, Noise2D>();
function nz(seed: number) { let n = isletNoise.get(seed); if (!n) isletNoise.set(seed, (n = new Noise2D(seed))); return n; }
/** wobbly shoreline radius of an islet along an angle (m) */
export function isletShoreR(d: IsletDef, ang: number) {
  const n = nz(d.seed);
  return d.r * (1 + 0.16 * n.noise(Math.cos(ang) * 1.4 + 5, Math.sin(ang) * 1.4 + 5) + 0.07 * n.noise(Math.cos(ang) * 3.2 + 11, Math.sin(ang) * 3.2 + 11));
}
/**
 * Analytic islet height at a world position: a soft rolling island with a central knoll, a sandy rim,
 * a shallow reef shelf and a drop to the open-sea floor (clamped to OUT_OF_WORLD_DEPTH so the islet's
 * grid edge meets the open sea without a step).
 */
export function isletHeightRaw(d: IsletDef, wx: number, wz: number): number {
  const n = nz(d.seed), m = nz(d.seed + 1);
  const x = wx - d.x, z = wz - d.z;
  const R = isletShoreR(d, Math.atan2(z, x));
  const r = Math.hypot(x, z) / R;
  const land = smooth(1.0, 0.8, r);
  const hill = smooth(0.95, 0.2, r);
  const rolling = n.fbm(x * 0.04 + 3, z * 0.04 - 7, 4) * 0.5 + 0.5;
  const kx = x + d.r * 0.12, kz = z - d.r * 0.08, ks = d.r * 0.3;
  const knoll = Math.exp(-(kx * kx + kz * kz) / (2 * ks * ks));
  const bumps = m.fbm(x * 0.13, z * 0.13, 3) * 0.22;
  let h = land * 1.0 + hill * (rolling * 2.0 + knoll * d.peak + bumps);
  const past = Math.max(0, r - 1.0) * R;
  const shelf = 1.6 + m.fbm(x * 0.16 + 40, z * 0.16 - 20, 2) * 0.4 * smooth(0, 4, past) + smooth(10, 22, past) * 2.6;
  h -= (1 - land) * shelf;
  return Math.max(h, OUT_OF_WORLD_DEPTH);
}
