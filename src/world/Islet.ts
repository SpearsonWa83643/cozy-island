import * as THREE from 'three/webgpu';
import { ISLETS, ISLET_SIZE, ISLET_GEN_RADIUS, STREAM_RADIUS, STREAM_HYSTERESIS, PHYS_CHUNK_SIZE, PHYS_RING } from './config';
import { ISLET_N, ISLET_SEG, isletGrid, setIsletGrid } from './isletGrid';
import { generateIsletGrid } from './GenWorker';
import { smooth, noiseB } from './gen';
import { PhysicsChunks } from '../core/PhysicsChunks';
import { IsletFlora } from './IsletFlora';
import type { Physics } from '../core/Physics';

/**
 * Archipelago islet terrain (Order 42a): Blossom Isle and friends. Nothing is generated at load:
 * when the camera comes within ISLET_GEN_RADIUS the islet's height grid is generated in a Web Worker
 * (Order 39a path), then its 2×2 terrain tiles stream in/out by camera distance like the main island's
 * (Order 39b, one tile per frame) and a ring of heightfield colliders follows the player when they
 * are on or near it (Order 36). Shares the main terrain material (detail shading + season tint).
 */
const C = (h: string) => new THREE.Color(h);
const SAND = C('#f6e2b4'), WET = C('#d9b77f'), SEABED = C('#b39a70'), ROCK = C('#a59c90');
const GRASS = [C('#5aa64a'), C('#78c157'), C('#a6d870'), C('#c9e27a')];
const PETAL = C('#f2b8cf');
const TILES = 2;

interface Tile { mesh: THREE.Mesh; i0: number; j0: number; n: number; x0: number; z0: number; x1: number; z1: number; loaded: boolean }
/** streaming work log (Order 42c): what ran, when (performance.now) and how long, for hitch attribution */
export interface StreamEvent { t: number; kind: 'gen' | 'load' | 'unload' | 'flora' | 'phys'; ms: number }
export const streamLog: StreamEvent[] = [];
const logEv = (kind: StreamEvent['kind'], t0: number) => { const t = performance.now(), ms = t - t0; if (kind !== 'phys' || ms > 1) { streamLog.push({ t: t0, kind, ms }); if (streamLog.length > 400) streamLog.splice(0, 100); } return ms; };
export interface IsletStats { state: string; genMs: number; genMode: string; loaded: number; loads: number; unloads: number; colliders: number; bytes: number }

class OneIslet {
  group = new THREE.Group();
  state: 'idle' | 'generating' | 'ready' = 'idle';
  tiles: Tile[] = [];
  phys: PhysicsChunks | null = null;
  /** cherry grove + meadow flora + landing pennant (Order 42b), built a species per frame once ready */
  flora: IsletFlora;
  stats: IsletStats = { state: 'idle', genMs: 0, genMode: '', loaded: 0, loads: 0, unloads: 0, colliders: 0, bytes: 0 };
  /** water-shader height texture (filled when the grid is ready) */
  constructor(readonly k: number, mat: THREE.Material, private physics: Physics, readonly heightTex: THREE.DataTexture) {
    const d = ISLETS[k];
    this.group.name = `islet-${d.id}`;
    this.flora = new IsletFlora(d, physics);
    this.group.add(this.flora.group);
    const per = ISLET_SEG / TILES, step = ISLET_SIZE / ISLET_SEG;
    for (let tj = 0; tj < TILES; tj++) for (let ti = 0; ti < TILES; ti++) {
      const i0 = ti * per, j0 = tj * per;
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      mesh.receiveShadow = true; mesh.visible = false; mesh.name = `islet-${d.id}-${ti}-${tj}`;
      this.group.add(mesh);
      this.tiles.push({ mesh, i0, j0, n: per + 1, loaded: false,
        x0: d.x - ISLET_SIZE / 2 + i0 * step, x1: d.x - ISLET_SIZE / 2 + (i0 + per) * step, z0: d.z - ISLET_SIZE / 2 + j0 * step, z1: d.z - ISLET_SIZE / 2 + (j0 + per) * step });
    }
  }
  get def() { return ISLETS[this.k]; }
  private dist(t: Tile, x: number, z: number) { return Math.hypot(Math.max(t.x0 - x, 0, x - t.x1), Math.max(t.z0 - z, 0, z - t.z1)); }

  update(cx: number, cz: number, px: number, pz: number, radius: number) {
    const d = this.def;
    if (this.state === 'idle') {
      if (Math.hypot(cx - d.x, cz - d.z) < ISLET_GEN_RADIUS) this.generate();
      return;
    }
    if (this.state !== 'ready') return;
    // stream tiles: build at most one missing in-range tile per frame (nearest first), unload past the hysteresis
    let want: Tile | null = null, wd = Infinity;
    for (const t of this.tiles) {
      const dd = this.dist(t, cx, cz);
      if (dd <= radius) { if (!t.loaded && dd < wd) { want = t; wd = dd; } }
      else if (t.loaded && dd > radius + STREAM_HYSTERESIS) { const t0 = performance.now(); this.unload(t); logEv('unload', t0); }
    }
    if (want) { const t0 = performance.now(); this.load(want); logEv('load', t0); }
    else if (!this.flora.built) { const t0 = performance.now(); this.flora.step(); logEv('flora', t0); } // never in the same frame as a tile build
    this.flora.group.visible = this.stats.loaded > 0;
    this.flora.lod(cx, cz);
    { const t0 = performance.now(); this.phys?.update(px, pz); logEv('phys', t0); }
    this.stats.colliders = this.phys?.active ?? 0;
  }

  private generate() {
    this.state = 'generating'; this.stats.state = 'generating';
    void generateIsletGrid(this.k).then((r) => {
      const t0 = performance.now();
      setIsletGrid(this.k, r.grid);
      this.stats.genMs = Math.round(r.ms); this.stats.genMode = r.mode;
      this.phys = new PhysicsChunks(this.physics, r.grid, ISLET_SEG, ISLET_SIZE, PHYS_CHUNK_SIZE, PHYS_RING, this.def.x, this.def.z, 12);
      // water depth tint + shore foam around the islet
      const img = this.heightTex.image as { data: Uint8Array; width: number };
      const N = img.width;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const gi = Math.round((i / (N - 1)) * ISLET_SEG), gj = Math.round((j / (N - 1)) * ISLET_SEG);
        const v = Math.min(255, Math.max(0, Math.round(((r.grid[gj * ISLET_N + gi] + 4) / 10) * 255)));
        img.data.set([v, v, v, 255], (j * N + i) * 4);
      }
      this.heightTex.needsUpdate = true;
      this.state = 'ready'; this.stats.state = 'ready';
      logEv('gen', t0);
    });
  }

  private load(t: Tile) {
    const g = isletGrid(this.k)!, d = this.def, n = t.n, step = ISLET_SIZE / ISLET_SEG;
    const H = (i: number, j: number) => g[Math.max(0, Math.min(ISLET_SEG, j)) * ISLET_N + Math.max(0, Math.min(ISLET_SEG, i))];
    const pos = new Float32Array(n * n * 3), nor = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3), mask = new Float32Array(n * n * 4), uv = new Float32Array(n * n * 2);
    const c = new THREE.Color(), nv = new THREE.Vector3();
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const gi = t.i0 + i, gj = t.j0 + j, v = j * n + i;
      const x = d.x - ISLET_SIZE / 2 + gi * step, z = d.z - ISLET_SIZE / 2 + gj * step, h = H(gi, gj);
      pos.set([x, h, z], v * 3);
      // normals from the full grid (central differences) so tile edges are seamless
      const dx = H(gi + 1, gj) - H(gi - 1, gj), dz = H(gi, gj + 1) - H(gi, gj - 1);
      nv.set(-dx, 2 * step, -dz).normalize(); nor.set([nv.x, nv.y, nv.z], v * 3);
      const slope = Math.min(1, Math.hypot(dx, dz) / (2 * step));
      // colour: seabed → wet sand → pale sand → meadow greens, with petal-pink drifts under the (future) cherry grove
      const sandTop = 0.7;
      const g0 = noiseB.fbm(x * 0.05 + 13, z * 0.05 - 3, 3) * 0.5 + 0.5, warm = noiseB.noise(x * 0.11 - 4, z * 0.11 + 9) * 0.5 + 0.5;
      const grass = c.copy(GRASS[0]).lerp(GRASS[1], smooth(0.15, 0.55, g0)).lerp(GRASS[2], smooth(0.5, 0.9, g0) * 0.85).lerp(GRASS[3], smooth(0.6, 0.85, warm) * 0.45);
      // Walker, 2026-10-29: pink petals only on Blossom Isle (generated islets keep plain meadow greens)
      const petals = d.id !== 'blossom' ? 0 : smooth(0.62, 0.82, noiseB.noise(x * 0.07 + 31, z * 0.07 - 17) * 0.5 + 0.5) * smooth(1.6, 3.2, h);
      grass.lerp(PETAL, petals * 0.55).lerp(ROCK, smooth(0.6, 0.95, slope) * 0.8);
      if (h < -3.3) c.copy(SEABED);
      else if (h < -0.2) c.copy(SEABED).lerp(WET, smooth(-2, -0.2, h));
      else if (h < sandTop) c.copy(WET).lerp(SAND, smooth(-0.2, 0.3, h));
      else c.copy(grass).lerp(SAND, smooth(sandTop + 0.45, sandTop, h));
      col.set([c.r, c.g, c.b], v * 3);
      const sand = smooth(sandTop + 0.4, sandTop, h), rock = smooth(0.45, 0.85, slope);
      mask.set([sand, 0, rock, Math.max(0, 1 - sand - rock)], v * 4);
      uv.set([gi / ISLET_SEG, 1 - gj / ISLET_SEG], v * 2);
    }
    const idx = new Uint32Array((n - 1) * (n - 1) * 6);
    let o = 0;
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = i + n * j, b = i + n * (j + 1), cc = i + 1 + n * (j + 1), dd = i + 1 + n * j;
      idx[o++] = a; idx[o++] = b; idx[o++] = dd; idx[o++] = b; idx[o++] = cc; idx[o++] = dd;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('mask', new THREE.BufferAttribute(mask, 4));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingBox(); geo.computeBoundingSphere();
    const bytes = pos.byteLength + nor.byteLength + col.byteLength + mask.byteLength + uv.byteLength + idx.byteLength;
    geo.userData.bytes = bytes;
    t.mesh.geometry.dispose(); t.mesh.geometry = geo; t.mesh.visible = true; t.loaded = true;
    this.stats.loads++; this.stats.loaded++; this.stats.bytes += bytes;
  }
  private unload(t: Tile) {
    this.stats.bytes -= t.mesh.geometry.userData.bytes ?? 0;
    t.mesh.geometry.dispose(); t.mesh.geometry = new THREE.BufferGeometry(); t.mesh.visible = false; t.loaded = false;
    this.stats.unloads++; this.stats.loaded--;
  }
}

/** all archipelago islets; call update() each frame with the camera + player xz */
export class Islets {
  group = new THREE.Group();
  list: OneIslet[] = [];
  radius = STREAM_RADIUS;
  constructor(mat: THREE.Material, physics: Physics, texs: THREE.DataTexture[]) {
    this.group.name = 'islets';
    ISLETS.forEach((_, k) => { const it = new OneIslet(k, mat, physics, texs[k]); this.list.push(it); this.group.add(it.group); });
  }
  update(cx: number, cz: number, px: number, pz: number) { for (const it of this.list) it.update(cx, cz, px, pz, this.radius); }
  /** colliders only (after a teleport / the systems step) */
  physUpdate(px: number, pz: number) { for (const it of this.list) { if (it.state === 'ready') it.phys?.update(px, pz); } }
  get stats() { return this.list.map((it) => ({ id: it.def.id, ...it.stats })); }
  get log() { return streamLog; }
  /** per-frame flora animation (cherry petals, Order 46b) */
  tickFlora(dt: number) { for (const it of this.list) if (it.flora.built && it.flora.lodMode === 'near') it.flora.tick(dt); } // far islets skip petal work (Order 48e)
  /** hot springs (Order 46a) that are built and shown */
  springs() { return this.list.map((it) => it.flora.spring).filter((s): s is NonNullable<typeof s> => !!s && s.group.children.length > 0); }
  get floraStats() { return this.list.map((it) => ({ id: it.def.id, ...it.flora.stats })); }
  /** test hook: true once every islet's grid is generated and its tiles are built */
  get ready() { return this.list.every((it) => it.state === 'ready' && it.tiles.every((t) => t.loaded)); }
}

/** a blank (deep-sea) water height texture for an islet; filled in when its grid is generated */
export function isletWaterTexture(N = 128) {
  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) data.set([13, 13, 13, 255], i * 4); // ≈ -3.5 m
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
  return t;
}
