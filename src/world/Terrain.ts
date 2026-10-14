import * as THREE from 'three/webgpu';
import { attribute, cameraPosition, time, float, floor, fract, dot, mx_noise_float, positionWorld, sin, smoothstep, step, vec2, vec3 } from 'three/tsl';
import { Noise2D } from './noise';
import { Biome, BiomeField, BASE_CENTERS, BIOME_COUNT, BASE_POND, biomeWeightsBase, ISLAND_SCALE } from './Biomes';
import { seasonGround } from '../theme/Season';

export const WORLD_SIZE = 196; // terrain mesh extent (meters)
const BASE_RADIUS = 47;
export const ISLAND_RADIUS = BASE_RADIUS * ISLAND_SCALE;
export const WATER_LEVEL = 0;

const noise = new Noise2D(7);
const noiseB = new Noise2D(23);
const noiseC = new Noise2D(57);

export const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

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
  const beachW = 0.3 + w[Biome.Tropical] * 0.12 - w[Biome.Alpine] * 0.15;
  const land = smooth(1.04, 1.04 - beachW, r);
  const hillMask = smooth(0.98, 0.55, r);

  const hills = noise.fbm(x * 0.045 + 10, z * 0.045 - 4, 4) * 0.5 + 0.5;
  const bumps = noiseB.fbm(x * 0.12, z * 0.12, 3) * 0.25;
  const meadow = hills * 2.4 + bumps + 2.2 * Math.exp(-((x - 8) ** 2 + (z + 6) ** 2) / 90);

  const [ax, az] = BASE_CENTERS[Biome.Alpine];
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

  const inland = w[0] * meadow + w[1] * alpine + w[2] * autumn + w[3] * tropical + w[4] * desert + w[5] * marsh;
  let h = land * 1.1 + hillMask * inland;
  // seabed: a shallow, bumpy reef shelf ~16 m wide (swimmable, visible through clear water), then a drop-off
  const past = Math.max(0, r - 1.04) * ISLAND_RADIUS * wobble; // world metres past the beach
  const reefBump = noiseB.fbm(x * 0.16 + 40, z * 0.16 - 20, 2) * 0.45 * smooth(0, 4, past);
  const shelf = 1.75 + reefBump + smooth(13, 24, past) * 2.6;
  h -= (1 - land) * shelf;
  return h;
}

// ---- cached height grid (0.5 m) with bilinear lookup ----
const GRID_RES = 0.5;
const GRID_N = Math.ceil(WORLD_SIZE / GRID_RES) + 1;
let grid: Float32Array | null = null;
function buildGrid() {
  grid = new Float32Array(GRID_N * GRID_N);
  for (let j = 0; j < GRID_N; j++) for (let i = 0; i < GRID_N; i++) {
    grid[j * GRID_N + i] = heightRaw(i * GRID_RES - WORLD_SIZE / 2, j * GRID_RES - WORLD_SIZE / 2);
  }
}
export function heightAt(x: number, z: number): number {
  if (!grid) buildGrid();
  let fx = (x + WORLD_SIZE / 2) / GRID_RES, fz = (z + WORLD_SIZE / 2) / GRID_RES;
  if (fx < 0 || fz < 0 || fx >= GRID_N - 1 || fz >= GRID_N - 1) return -3.5;
  const i = Math.floor(fx), j = Math.floor(fz);
  fx -= i; fz -= j;
  const g = grid!, a = j * GRID_N + i;
  return (g[a] * (1 - fx) + g[a + 1] * fx) * (1 - fz) + (g[a + GRID_N] * (1 - fx) + g[a + GRID_N + 1] * fx) * fz;
}

/** Terrain slope (0 flat .. 1 steep). */
export function slopeAt(x: number, z: number): number {
  const e = 0.5;
  const dx = heightAt(x + e, z) - heightAt(x - e, z);
  const dz = heightAt(x, z + e) - heightAt(x, z - e);
  return Math.min(1, Math.hypot(dx, dz) / (2 * e));
}

export const biomes = new BiomeField(WORLD_SIZE, 1);
const wS = new Float32Array(BIOME_COUNT);
export function biomeWeights(x: number, z: number, out: Float32Array = wS) { return biomes.sample(x, z, out); }

/** 0..1 snow cover. */
export function snowAt(x: number, z: number, h = heightAt(x, z)): number {
  const w = biomes.sample(x, z, wS)[Biome.Alpine];
  return smooth(0.35, 0.7, w) * smooth(5.2, 7.4, h + noiseB.noise(x * 0.2, z * 0.2) * 0.9);
}

export type Surface = 'sand' | 'grass' | 'snow' | 'rock' | 'leaves' | 'mud' | 'water' | 'wood';
export function surfaceAt(x: number, z: number): Surface {
  const h = heightAt(x, z);
  if (h < 0.04) return 'water';
  if (snowAt(x, z, h) > 0.45) return 'snow';
  const w = biomes.sample(x, z, wS);
  if (h < 0.6 + w[Biome.Tropical] * 0.85) return 'sand';
  if (w[Biome.Desert] > 0.5) return slopeAt(x, z) > 0.5 ? 'rock' : 'sand';
  if (slopeAt(x, z) > 0.7) return 'rock';
  if (w[Biome.Marsh] > 0.5) return 'mud';
  if (w[Biome.Autumn] > 0.5) return 'leaves';
  if (w[Biome.Alpine] > 0.6 && h > 4) return 'rock';
  return 'grass';
}

// ---------- colours ----------
const C = (h: string) => new THREE.Color(h);
const SAND = C('#f3d9a4'), WET_SAND = C('#d9b77f'), SEABED = C('#b39a70');
const TROP_SAND = C('#fbe9bd'), PEBBLE = C('#bdb6aa'), DES_SAND = C('#ecbd84');
const ROCK = C('#a49a8c'), SNOW = C('#f5f8fc'), ALP_ROCK = C('#9a9a9e');
const PAL: Record<number, THREE.Color[]> = {
  [Biome.Meadow]: [C('#4f9a43'), C('#6dbb4f'), C('#9ed36a'), C('#c4dc6a')],
  [Biome.Alpine]: [C('#5e8f5a'), C('#77a466'), C('#93b47c'), C('#a8b98e')],
  [Biome.Autumn]: [C('#9a8a3a'), C('#b9a24a'), C('#d4a24a'), C('#d9823b')],
  [Biome.Tropical]: [C('#3fb85a'), C('#5fd06a'), C('#8fe070'), C('#b8e86a')],
  [Biome.Desert]: [C('#d99a5e'), C('#e3a96c'), C('#eec08a'), C('#c98e5a')],
  [Biome.Marsh]: [C('#4a7a45'), C('#5f8f4a'), C('#7a9a52'), C('#6f7f4a')],
};
const MESA_BANDS = [C('#c9734a'), C('#e8b07a'), C('#b85f3c'), C('#dd9a64')];
const MUD = C('#7a6c4c');
const tmp = new THREE.Color(), acc = new THREE.Color();

function biomeGround(b: number, x: number, z: number, h: number, slope: number, out: THREE.Color) {
  const p = PAL[b];
  const v = noiseB.fbm(x * 0.08 + 50, z * 0.08, 3) * 0.5 + 0.5;
  const warm = noise.fbm(x * 0.05 - 30, z * 0.05 + 12, 2) * 0.5 + 0.5;
  out.copy(p[0]).lerp(p[1], smooth(0.15, 0.55, v)).lerp(p[2], smooth(0.5, 0.9, v) * 0.85).lerp(p[3], smooth(0.6, 0.85, warm) * 0.5);
  if (b === Biome.Desert) {
    const band = MESA_BANDS[Math.floor(Math.max(0, h) / 0.9) % MESA_BANDS.length];
    out.lerp(band, smooth(0.25, 0.6, slope) * 0.9);
  } else if (b === Biome.Alpine) {
    out.lerp(ALP_ROCK, smooth(3.5, 7, h) * 0.6 + smooth(0.45, 0.8, slope) * 0.4);
  } else if (b === Biome.Marsh) {
    out.lerp(MUD, smooth(0.6, 0.2, h) * 0.7);
  } else {
    out.lerp(ROCK, smooth(0.6, 0.95, slope) * 0.8);
  }
  return out;
}
function biomeSand(b: number): THREE.Color {
  return b === Biome.Tropical ? TROP_SAND : b === Biome.Alpine ? PEBBLE : b === Biome.Desert ? DES_SAND : b === Biome.Marsh ? WET_SAND : SAND;
}

export function terrainColor(x: number, z: number, h: number, out: THREE.Color) {
  const slope = slopeAt(x, z);
  const w = biomes.sample(x, z, new Float32Array(BIOME_COUNT));
  acc.setRGB(0, 0, 0);
  let sandAcc = new THREE.Color(0, 0, 0);
  for (let b = 0; b < BIOME_COUNT; b++) {
    if (w[b] < 0.004) continue;
    biomeGround(b, x, z, h, slope, tmp);
    acc.r += tmp.r * w[b]; acc.g += tmp.g * w[b]; acc.b += tmp.b * w[b];
    const s = biomeSand(b);
    sandAcc.r += s.r * w[b]; sandAcc.g += s.g * w[b]; sandAcc.b += s.b * w[b];
  }
  const beachTop = 0.55 + w[Biome.Tropical] * 0.85;
  if (h < -0.2) out.copy(SEABED).lerp(WET_SAND, smooth(-2, -0.2, h));
  else if (h < beachTop) out.copy(WET_SAND).lerp(sandAcc, smooth(-0.2, 0.3, h));
  else out.copy(acc).lerp(sandAcc, smooth(beachTop + 0.45, beachTop, h));
  if (w[Biome.Marsh] > 0.3 && h < 0.5 && h > -0.6) out.lerp(MUD, 0.5 * w[Biome.Marsh]);
  const snow = snowAt(x, z, h);
  if (snow > 0) out.lerp(SNOW, snow * (1 - smooth(0.75, 1, slope) * 0.5));
  return out;
}

export class Terrain {
  mesh: THREE.Mesh;
  heightTexture: THREE.DataTexture;
  vertices: Float32Array;
  private seg = 200;
  indices: Uint32Array;

  constructor() {
    const seg = 200;
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const mask = new Float32Array(pos.count * 4);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = heightAt(x, z);
      pos.setY(i, h);
      if (h < -3.3) c.copy(SEABED); else terrainColor(x, z, h, c);
      colors.set([c.r, c.g, c.b], i * 3);
      // detail masks for the shader: sand, snow, rock(slope), grass
      const w = biomes.sample(x, z, wS);
      const sandTop = 0.55 + w[Biome.Tropical] * 0.85;
      const sand = Math.max(smooth(sandTop + 0.4, sandTop, h), w[Biome.Desert] * 0.8);
      const snow = snowAt(x, z, h);
      const rock = smooth(0.45, 0.85, slopeAt(x, z));
      mask.set([sand, snow, rock, Math.max(0, 1 - sand - snow - rock)], i * 4);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('mask', new THREE.BufferAttribute(mask, 4));
    this.seg = seg;
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
    // Procedural detail layer (no textures): grass clumps, sand ripples, rock strata, snow/sand glints.
    const mk = attribute('mask', 'vec4');
    const pw = positionWorld;
    const n1 = mx_noise_float(pw.xz.mul(1.7)), n2 = mx_noise_float(pw.xz.mul(0.33));
    const grassD = n1.mul(0.11).add(n2.mul(0.09));
    const ripple = sin(pw.x.mul(2.4).add(pw.z.mul(1.3)).add(n2.mul(3.5))).mul(0.05).add(n1.mul(0.03));
    const strata = sin(pw.y.mul(6.5).add(n1.mul(1.6))).mul(0.08);
    const detail = float(1).add(grassD.mul(mk.w)).add(ripple.mul(mk.x)).add(strata.mul(mk.z)).add(n1.mul(0.025).mul(mk.y));
    mat.colorNode = vec3(detail).mul(seasonGround(mk.w, n2));
    const cell = floor(pw.mul(13));
    const hsh = fract(sin(dot(cell.xz.add(cell.y).add(floor(cameraPosition.xz.mul(1.5))), vec2(12.9898, 78.233))).mul(43758.5453));
    const glint = step(0.99, hsh).mul(mk.y.mul(0.8).add(mk.x.mul(0.12)));
    // underwater caustics: two drifting noise ridges multiplied → dancing light net on the reef shelf
    const cuv = pw.xz.mul(0.9);
    const c1 = float(1).sub(mx_noise_float(vec3(cuv.x, cuv.y, time.mul(0.45))).abs()).pow(5);
    const c2 = float(1).sub(mx_noise_float(vec3(cuv.x.mul(1.3).add(5), cuv.y.mul(1.3), time.mul(0.6).add(9))).abs()).pow(5);
    const under = smoothstep(float(-0.15), float(-0.6), pw.y).mul(smoothstep(float(-4.2), float(-1.2), pw.y));
    const caustic = c1.mul(c2).mul(under).mul(0.55);
    mat.emissiveNode = vec3(glint).mul(smoothstep(float(60), float(10), pw.sub(cameraPosition).length())).add(vec3(0.55, 0.85, 0.8).mul(caustic));
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.name = 'terrain';

    this.vertices = new Float32Array(pos.array as Float32Array);
    this.indices = new Uint32Array(geo.index!.array);

    // Height texture used by the water shader for depth tint + shoreline foam.
    const N = 512;
    const data = new Uint8Array(N * N * 4);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1) - 0.5) * WORLD_SIZE;
        const z = (j / (N - 1) - 0.5) * WORLD_SIZE;
        const h = heightAt(x, z);
        const v = Math.min(255, Math.max(0, Math.round(((h + 4) / 10) * 255)));
        data.set([v, v, v, 255], (j * N + i) * 4);
      }
    }
    this.heightTexture = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    this.heightTexture.magFilter = THREE.LinearFilter;
    this.heightTexture.minFilter = THREE.LinearFilter;
    this.heightTexture.wrapS = this.heightTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.heightTexture.needsUpdate = true;
  }

  /** Darken the ground under trees/bushes (cheap baked contact AO). */
  bakeAO(points: { x: number; z: number; r: number }[]) {
    const col = this.mesh.geometry.attributes.color as THREE.BufferAttribute;
    const n = this.seg + 1, step = WORLD_SIZE / this.seg;
    for (const p of points) {
      const R = p.r * 1.7;
      const i0 = Math.max(0, Math.floor((p.x - R + WORLD_SIZE / 2) / step)), i1 = Math.min(n - 1, Math.ceil((p.x + R + WORLD_SIZE / 2) / step));
      const j0 = Math.max(0, Math.floor((p.z - R + WORLD_SIZE / 2) / step)), j1 = Math.min(n - 1, Math.ceil((p.z + R + WORLD_SIZE / 2) / step));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = i * step - WORLD_SIZE / 2, z = j * step - WORLD_SIZE / 2;
        const d = Math.hypot(x - p.x, z - p.z);
        if (d > R) continue;
        const f = 1 - 0.24 * smooth(R, p.r * 0.25, d);
        const k = j * n + i;
        col.setXYZ(k, col.getX(k) * f, col.getY(k) * f, col.getZ(k) * f);
      }
    }
    col.needsUpdate = true;
  }

  /** Ray march the height field (much cheaper than mesh raycasting). */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist = 140): THREE.Vector3 | null {
    let prev = 0, step = 0.35;
    const p = new THREE.Vector3();
    for (let t = 0.5; t < maxDist; t += step) {
      p.copy(origin).addScaledVector(dir, t);
      if (p.y < heightAt(p.x, p.z)) {
        let lo = prev, hi = t;
        for (let k = 0; k < 12; k++) {
          const m = (lo + hi) / 2;
          p.copy(origin).addScaledVector(dir, m);
          if (p.y < heightAt(p.x, p.z)) hi = m; else lo = m;
        }
        p.copy(origin).addScaledVector(dir, hi);
        return p;
      }
      prev = t;
      step = Math.min(1.0, 0.35 + t * 0.01);
    }
    return null;
  }
}
