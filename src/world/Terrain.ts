import * as THREE from 'three/webgpu';
import { attribute, cameraPosition, time, float, floor, fract, dot, mx_noise_float, positionWorld, sin, smoothstep, step, vec2, vec3 } from 'three/tsl';
import { Biome, BiomeField, BIOME_COUNT } from './Biomes';
import { seasonGround } from '../theme/Season';

import { WORLD_SIZE, ISLAND_RADIUS, WATER_LEVEL, OUT_OF_WORLD_DEPTH, CHUNK_SIZE, STREAM_RADIUS, STREAM_HYSTERESIS, TILE_CAP } from './config';
// re-exported for existing importers; the source of truth is ./config
export { WORLD_SIZE, ISLAND_RADIUS, WATER_LEVEL };

// height + biome maths live in the pure generation core (shared with the gen worker, Order 39a)
import { heightRaw, noise, noiseB, smooth } from './gen';
export { heightRaw, smooth };

// ---- cached height grid (0.5 m) with bilinear lookup ----
export const GRID_RES = 0.5;
export const GRID_N = Math.ceil(WORLD_SIZE / GRID_RES) + 1;
let grid: Float32Array | null = null;
/** main-thread fallback: built lazily on first lookup unless the gen worker filled it first */
function buildGrid() {
  grid = new Float32Array(GRID_N * GRID_N);
  for (let j = 0; j < GRID_N; j++) for (let i = 0; i < GRID_N; i++) {
    grid[j * GRID_N + i] = heightRaw(i * GRID_RES - WORLD_SIZE / 2, j * GRID_RES - WORLD_SIZE / 2);
  }
}
export function heightGridReady() { return !!grid; }
/** install a precomputed height grid (GRID_N² floats, row-major), e.g. from the gen worker */
export function setHeightGrid(g: Float32Array) {
  if (g.length !== GRID_N * GRID_N) throw new Error(`setHeightGrid: bad length ${g.length}`);
  grid = g;
}
export function heightAt(x: number, z: number): number {
  if (!grid) buildGrid();
  let fx = (x + WORLD_SIZE / 2) / GRID_RES, fz = (z + WORLD_SIZE / 2) / GRID_RES;
  if (fx < 0 || fz < 0 || fx >= GRID_N - 1 || fz >= GRID_N - 1) return OUT_OF_WORLD_DEPTH;
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

/**
 * Terrain (Big island 2/7): the height/colour grid is still built once for the whole world,
 * but it renders as a grid of ~CHUNK_SIZE m tiles sharing one material. Each tile copies its
 * slice of the shared vertices (normals computed on the full grid, so edges are seamless)
 * and has its own bounds, so the renderer frustum-culls tiles that are off screen.
 */
export interface TerrainChunk {
  mesh: THREE.Mesh; i0: number; j0: number; w: number; h: number; map: Uint32Array;
  /** world-space xz rectangle covered by the tile */
  x0: number; z0: number; x1: number; z1: number;
  /** geometry currently built (Order 39b streaming) */
  loaded: boolean;
  /** performance.now() when the tile was last within stream range (LRU, Order 39c) */
  lastUsed: number;
}
/** streaming stats for tests / ?debug */
export interface StreamStats { loaded: number; peak: number; loads: number; unloads: number; evictions: number; bytes: number; radius: number; cap: number }
const EMPTY_GEO = new THREE.BufferGeometry();

export class Terrain {
  /** root group holding the terrain tiles (toggle .visible to hide all terrain) */
  mesh: THREE.Group;
  chunks: TerrainChunk[] = [];
  /** full-world geometry (not rendered): source for tile attributes, AO bake and trimesh physics */
  private full: THREE.BufferGeometry;
  heightTexture: THREE.DataTexture;
  vertices: Float32Array;
  private seg = 200;
  indices: Uint32Array;
  /** vertex heights, row-major (z rows, x cols), (seg+1)² — feeds the physics heightfield */
  heights: Float32Array;
  get segments() { return this.seg; }

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
    const grassD = n1.mul(0.14).add(n2.mul(0.11));
    const ripple = sin(pw.x.mul(2.4).add(pw.z.mul(1.3)).add(n2.mul(3.5))).mul(0.055).add(n1.mul(0.035));
    const strata = sin(pw.y.mul(6.5).add(n1.mul(1.6))).mul(0.09);
    const detail = float(1).add(grassD.mul(mk.w)).add(ripple.mul(mk.x)).add(strata.mul(mk.z)).add(n1.mul(0.03).mul(mk.y));
    // grass patches get a tiny warm lift so meadows read richer without extra polys
    const lush = float(1).add(mk.w.mul(0.06));
    mat.colorNode = vec3(detail).mul(lush).mul(seasonGround(mk.w, n2));
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
    this.full = geo;
    this.mesh = new THREE.Group();
    this.mesh.name = 'terrain';
    this.buildChunks(mat);

    this.vertices = new Float32Array(pos.array as Float32Array);
    this.heights = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) this.heights[i] = pos.getY(i);
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

  /** tiles within this distance (m, xz) of the camera are built; beyond radius + hysteresis they unload */
  streamRadius = STREAM_RADIUS;
  /** most tile geometries kept at once (LRU / farthest-first eviction) */
  tileCap = TILE_CAP;
  stats: StreamStats = { loaded: 0, peak: 0, loads: 0, unloads: 0, evictions: 0, bytes: 0, radius: STREAM_RADIUS, cap: TILE_CAP };

  /** Lay out ~CHUNK_SIZE m tile slots (vertex-aligned, shared edge vertices duplicated). Geometry builds on demand in stream(). */
  private buildChunks(mat: THREE.Material) {
    const seg = this.seg, n = seg + 1, step = WORLD_SIZE / seg;
    const per = Math.max(1, Math.round(WORLD_SIZE / CHUNK_SIZE));
    const cuts = Array.from({ length: per + 1 }, (_, k) => Math.round((k * seg) / per));
    for (let cj = 0; cj < per; cj++) for (let ci = 0; ci < per; ci++) {
      const i0 = cuts[ci], i1 = cuts[ci + 1], j0 = cuts[cj], j1 = cuts[cj + 1];
      const w = i1 - i0 + 1, h = j1 - j0 + 1;
      const map = new Uint32Array(w * h);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) map[j * w + i] = (j0 + j) * n + (i0 + i);
      const m = new THREE.Mesh(EMPTY_GEO, mat);
      m.receiveShadow = true;
      m.visible = false;
      m.name = `terrain-${ci}-${cj}`;
      this.mesh.add(m);
      this.chunks.push({ mesh: m, i0, j0, w, h, map, x0: i0 * step - WORLD_SIZE / 2, x1: i1 * step - WORLD_SIZE / 2, z0: j0 * step - WORLD_SIZE / 2, z1: j1 * step - WORLD_SIZE / 2, loaded: false, lastUsed: 0 });
    }
  }

  /** build one tile's geometry from the shared full-grid attributes */
  private loadChunk(ch: TerrainChunk) {
    const { w, h, map } = ch;
    const g = new THREE.BufferGeometry();
    let bytes = 0;
    for (const name of ['position', 'normal', 'color', 'mask', 'uv']) {
      const src = this.full.getAttribute(name) as THREE.BufferAttribute | undefined;
      if (!src) continue;
      const k = src.itemSize, a = src.array as Float32Array, out = new Float32Array(map.length * k);
      for (let v = 0; v < map.length; v++) for (let c = 0; c < k; c++) out[v * k + c] = a[map[v] * k + c];
      g.setAttribute(name, new THREE.BufferAttribute(out, k));
      bytes += out.byteLength;
    }
    // same triangle winding as PlaneGeometry
    const idx = new Uint32Array((w - 1) * (h - 1) * 6);
    let o = 0;
    for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) {
      const a = i + w * j, b = i + w * (j + 1), c = i + 1 + w * (j + 1), d = i + 1 + w * j;
      idx[o++] = a; idx[o++] = b; idx[o++] = d; idx[o++] = b; idx[o++] = c; idx[o++] = d;
    }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    bytes += idx.byteLength;
    g.computeBoundingBox(); g.computeBoundingSphere();
    g.userData.bytes = bytes;
    ch.mesh.geometry = g;
    ch.mesh.visible = true;
    ch.loaded = true;
    this.stats.loads++; this.stats.loaded++; this.stats.bytes += bytes;
    this.stats.peak = Math.max(this.stats.peak, this.stats.loaded);
  }

  private unloadChunk(ch: TerrainChunk, evicted = false) {
    if (!ch.loaded) return;
    this.stats.bytes -= ch.mesh.geometry.userData.bytes ?? 0;
    ch.mesh.geometry.dispose();
    ch.mesh.geometry = EMPTY_GEO;
    ch.mesh.visible = false;
    ch.loaded = false;
    this.stats.unloads++; this.stats.loaded--;
    if (evicted) this.stats.evictions++;
  }

  /** xz distance from a point to a tile's rectangle (0 inside) */
  chunkDist(ch: TerrainChunk, x: number, z: number) {
    const dx = Math.max(ch.x0 - x, 0, x - ch.x1), dz = Math.max(ch.z0 - z, 0, z - ch.z1);
    return Math.hypot(dx, dz);
  }

  /**
   * Distance-based streaming (Order 39b) + memory cap (Order 39c, hard cap; in-range tiles beyond the cap stay unbuilt, nearest first). Call each frame with the camera's xz.
   * Builds at most `budget` missing in-range tiles per call (nearest first), unloads tiles beyond
   * radius + hysteresis, then evicts the farthest / least-recently-used tiles while over the cap.
   */
  stream(x: number, z: number, budget = 1) {
    const now = performance.now(), R = this.streamRadius;
    this.stats.radius = R; this.stats.cap = this.tileCap;
    let want: TerrainChunk[] | null = null;
    for (const ch of this.chunks) {
      const d = this.chunkDist(ch, x, z);
      if (d <= R) {
        ch.lastUsed = now;
        if (!ch.loaded) (want ??= []).push(ch);
      } else if (ch.loaded && d > R + STREAM_HYSTERESIS) this.unloadChunk(ch);
    }
    if (want) {
      want.sort((a, b) => this.chunkDist(a, x, z) - this.chunkDist(b, x, z));
      // memory cap: make room by evicting loaded tiles that are out of range (least recently used first);
      // tiles in range are never evicted, so a cap below the in-range count can't thrash
      const need = Math.min(want.length, budget);
      if (this.stats.loaded + need > this.tileCap) {
        const spare = this.chunks.filter((c) => c.loaded && c.lastUsed < now).sort((a, b) => a.lastUsed - b.lastUsed);
        for (const ch of spare) { if (this.stats.loaded + need <= this.tileCap) break; this.unloadChunk(ch, true); }
      }
      for (let k = 0; k < need && this.stats.loaded < this.tileCap; k++) this.loadChunk(want[k]);
    }
  }

  /** copy the full grid's vertex colours into every tile (after AO baking) */
  private syncColors() {
    const src = this.full.getAttribute('color') as THREE.BufferAttribute, a = src.array as Float32Array;
    for (const ch of this.chunks) {
      if (!ch.loaded) continue; // unloaded tiles copy the (AO-baked) colours when they stream in
      const dst = ch.mesh.geometry.getAttribute('color') as THREE.BufferAttribute, d = dst.array as Float32Array;
      for (let v = 0; v < ch.map.length; v++) { const s3 = ch.map[v] * 3; d[v * 3] = a[s3]; d[v * 3 + 1] = a[s3 + 1]; d[v * 3 + 2] = a[s3 + 2]; }
      dst.needsUpdate = true;
    }
  }

  /** Darken the ground under trees/bushes (cheap baked contact AO). */
  bakeAO(points: { x: number; z: number; r: number }[]) {
    const col = this.full.attributes.color as THREE.BufferAttribute;
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
    this.syncColors();
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
