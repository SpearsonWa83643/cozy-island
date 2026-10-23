import * as THREE from 'three/webgpu';

export enum Biome { Meadow, Alpine, Autumn, Tropical, Desert, Marsh }
export const BIOME_COUNT = 6;
export const BIOME_NAMES = ['Meadow', 'Alpine Peak', 'Autumn Grove', 'Tropical Beach', 'Desert Mesa', 'Misty Marsh'];

import { ISLAND_SCALE, AREA, BASE_CENTERS, BASE_POND } from './config';
// re-exported for existing importers; the source of truth is ./config
export { ISLAND_SCALE, AREA, BASE_CENTERS, BASE_POND };
/** Biome centres on the (scaled) island in world metres. */
export const BIOME_CENTERS: [number, number, number][] = BASE_CENTERS.map(([x, z, s]) => [x * ISLAND_SCALE, z * ISLAND_SCALE, s * ISLAND_SCALE]);
export const POND = { x: BASE_POND.x * ISLAND_SCALE, z: BASE_POND.z * ISLAND_SCALE, r: BASE_POND.r * ISLAND_SCALE };

// biome weights live in the pure generation core so the gen worker shares them (Order 39a)
export { biomeWeightsRaw, biomeWeightsBase } from './gen';
import { biomeWeightsRaw } from './gen';

/** Cached grid of biome weights (1 m cells) with bilinear lookup. */
export class BiomeField {
  readonly size: number;
  readonly res: number;
  private data: Float32Array | null = null;
  readonly n: number;
  /** grid is built lazily on first sample (main-thread fallback) unless a worker filled it first */
  constructor(worldSize: number, res = 1) {
    this.size = worldSize; this.res = res;
    this.n = Math.ceil(worldSize / res) + 1;
  }
  get ready() { return !!this.data; }
  /** install a precomputed grid (n*n*BIOME_COUNT floats, row-major), e.g. from the gen worker */
  setData(d: Float32Array) {
    if (d.length !== this.n * this.n * BIOME_COUNT) throw new Error(`BiomeField.setData: bad length ${d.length}`);
    this.data = d;
  }
  private build() {
    const n = this.n, data = new Float32Array(n * n * BIOME_COUNT);
    const tmp = new Float32Array(BIOME_COUNT);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      biomeWeightsRaw(i * this.res - this.size / 2, j * this.res - this.size / 2, tmp);
      data.set(tmp, (j * n + i) * BIOME_COUNT);
    }
    this.data = data;
  }
  sample(x: number, z: number, out: Float32Array = new Float32Array(BIOME_COUNT)): Float32Array {
    if (!this.data) this.build();
    const n = this.n;
    let fx = (x + this.size / 2) / this.res, fz = (z + this.size / 2) / this.res;
    fx = Math.min(n - 1.001, Math.max(0, fx)); fz = Math.min(n - 1.001, Math.max(0, fz));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const d = this.data!, B = BIOME_COUNT;
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
