import * as THREE from 'three/webgpu';
import { Noise2D } from './noise';

export enum Biome { Meadow, Alpine, Autumn, Tropical, Desert, Marsh }
export const BIOME_COUNT = 6;
export const BIOME_NAMES = ['Meadow', 'Alpine Peak', 'Autumn Grove', 'Tropical Beach', 'Desert Mesa', 'Misty Marsh'];

/** island scale vs. the original 47 m layout: everything (noise, biomes, pond) is evaluated at x/S, z/S */
export const ISLAND_SCALE = 1.15;
/** area factor for densities (flora counts etc.) */
export const AREA = ISLAND_SCALE * ISLAND_SCALE;
/** Biome centres in the unscaled layout (x, z, spread). */
export const BASE_CENTERS: [number, number, number][] = [
  [0, 3, 17],      // meadow (broad, middle)
  [-6, -31, 13],   // alpine peak, north
  [28, -10, 12],   // autumn grove, east
  [21, 27, 13],    // tropical beach, south-east
  [-31, 5, 12],    // desert mesa, west
  [-13, 27, 10],   // misty marsh + pond, south-west
];
export const BASE_POND = { x: -12, z: 25, r: 5.5 };
/** Biome centres on the (scaled) island in world metres. */
export const BIOME_CENTERS: [number, number, number][] = BASE_CENTERS.map(([x, z, s]) => [x * ISLAND_SCALE, z * ISLAND_SCALE, s * ISLAND_SCALE]);
export const POND = { x: BASE_POND.x * ISLAND_SCALE, z: BASE_POND.z * ISLAND_SCALE, r: BASE_POND.r * ISLAND_SCALE };

const warp = new Noise2D(311);

/** Normalised biome weights at a world position (domain-warped so borders meander). */
export function biomeWeightsRaw(x: number, z: number, out: Float32Array = new Float32Array(BIOME_COUNT)) {
  return biomeWeightsBase(x / ISLAND_SCALE, z / ISLAND_SCALE, out);
}
/** same, in unscaled layout coordinates */
export function biomeWeightsBase(x: number, z: number, out: Float32Array = new Float32Array(BIOME_COUNT)) {
  const wx = x + warp.fbm(x * 0.035, z * 0.035, 3) * 9;
  const wz = z + warp.fbm(x * 0.035 + 40, z * 0.035 - 17, 3) * 9;
  let sum = 0;
  for (let i = 0; i < BIOME_COUNT; i++) {
    const [cx, cz, s] = BASE_CENTERS[i];
    const d2 = (wx - cx) ** 2 + (wz - cz) ** 2;
    let w = Math.exp(-d2 / (2 * s * s));
    if (i === 0) w = w * 1.0 + 0.04;
    w = w * w * w; // sharpen: distinct zones with ~6-10 m blends
    out[i] = w; sum += w;
  }
  for (let i = 0; i < BIOME_COUNT; i++) out[i] /= sum;
  return out;
}

/** Cached grid of biome weights (1 m cells) with bilinear lookup. */
export class BiomeField {
  readonly size: number;
  readonly res: number;
  private data: Float32Array;
  constructor(worldSize: number, res = 1) {
    this.size = worldSize; this.res = res;
    const n = Math.ceil(worldSize / res) + 1;
    this.data = new Float32Array(n * n * BIOME_COUNT);
    const tmp = new Float32Array(BIOME_COUNT);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      biomeWeightsRaw(i * res - worldSize / 2, j * res - worldSize / 2, tmp);
      this.data.set(tmp, (j * n + i) * BIOME_COUNT);
    }
    this.n = n;
  }
  private n: number;
  sample(x: number, z: number, out: Float32Array = new Float32Array(BIOME_COUNT)): Float32Array {
    const n = this.n;
    let fx = (x + this.size / 2) / this.res, fz = (z + this.size / 2) / this.res;
    fx = Math.min(n - 1.001, Math.max(0, fx)); fz = Math.min(n - 1.001, Math.max(0, fz));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const d = this.data, B = BIOME_COUNT;
    const a = (j * n + i) * B, b = a + B, c = a + n * B, e = c + B;
    for (let k = 0; k < B; k++) {
      out[k] = (d[a + k] * (1 - u) + d[b + k] * u) * (1 - v) + (d[c + k] * (1 - u) + d[e + k] * u) * v;
    }
    return out;
  }
  dominant(x: number, z: number): Biome {
    const w = this.sample(x, z, scratch);
    let best = 0;
    for (let k = 1; k < BIOME_COUNT; k++) if (w[k] > w[best]) best = k;
    return best as Biome;
  }
}
const scratch = new Float32Array(BIOME_COUNT);

/** Per-biome atmosphere (blended around the player). */
export interface Atmos { fog: THREE.Color; near: number; far: number; sun: THREE.Color; sunI: number; sky: THREE.Color; ground: THREE.Color; hemiI: number; }
const A = (fog: string, near: number, far: number, sun: string, sunI: number, sky: string, ground: string, hemiI: number): Atmos =>
  ({ fog: new THREE.Color(fog), near, far, sun: new THREE.Color(sun), sunI, sky: new THREE.Color(sky), ground: new THREE.Color(ground), hemiI });
export const ATMOS: Atmos[] = [
  A('#cfe3ea', 70, 330, '#fff0d8', 3.0, '#cfe9ff', '#e9c995', 1.5),   // meadow
  A('#e4eef6', 45, 260, '#f4f8ff', 3.3, '#e6f2ff', '#c9d3dd', 1.65),  // alpine: crisp, bright
  A('#efd9bd', 55, 300, '#ffd9a8', 3.0, '#ffe6c8', '#d8a86a', 1.45),  // autumn: golden
  A('#c5ecf0', 80, 360, '#fff6e0', 3.3, '#c8f0ff', '#f2d9a0', 1.55),  // tropical: clear
  A('#f2dcc0', 50, 300, '#ffe2b8', 3.4, '#ffe8cc', '#e0a46a', 1.4),   // desert: warm haze
  A('#c9d8cf', 12, 135, '#f0f0dc', 2.4, '#d6e6dc', '#9fb08a', 1.65),  // marsh: misty
];
