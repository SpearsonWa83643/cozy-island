import * as THREE from 'three/webgpu';
import {
  attribute, bool, clamp, cos, dot, float, floor, fract, length, mix, positionLocal, positionWorld,
  screenCoordinate, sin, smoothstep, time, uniform, uv, vec2, vec3,
  mx_noise_float, normalize, cameraPosition, pow, normalView, positionViewDirection, vertexColor,
} from 'three/tsl';
import { mulberry32 } from './noise';
import { Biome, BIOME_COUNT, POND, AREA } from './Biomes';
import { biomeWeights, heightAt, slopeAt, snowAt, terrainColor, ISLAND_RADIUS, smooth } from './Terrain';
import * as P from './Plants';
import { seasonFoliage, grassTint, snowK } from '../theme/Season';
import type { Physics } from '../core/Physics';

// ---------- camera occlusion fade (shared by all vegetation) ----------
export const fadeCam = uniform(new THREE.Vector3(0, 50, 50));
export const fadeTarget = uniform(new THREE.Vector3());
export const windStrength = uniform(1);
export const sunDirU = uniform(new THREE.Vector3(-0.5, 0.78, -0.6).normalize());

/** Vertex-coloured, flat-shaded, wind-swaying material that dithers out when it blocks the camera. */
export function floraMaterial(opts: { rough?: number; side?: THREE.Side } = {}) {
  const m = new THREE.MeshStandardNodeMaterial({ vertexColors: true, flatShading: true, roughness: opts.rough ?? 0.82, side: opts.side ?? THREE.FrontSide });
  const sway = attribute('sway', 'float');
  const pl = positionLocal;
  const t = time;
  const wv = vec3(
    sin(t.mul(1.3).add(pl.x.mul(0.3)).add(pl.z.mul(0.2))).add(sin(t.mul(2.7).add(pl.x)).mul(0.3)),
    float(0),
    cos(t.mul(1.1).add(pl.z.mul(0.3))).mul(0.7),
  ).mul(0.055).mul(sway).mul(windStrength);
  m.positionNode = pl.add(wv);
  // subtle world-space grain (bark / leaf / rock variation) instead of textures
  const pw = positionWorld;
  const grain = mx_noise_float(pw.mul(3.2)).mul(0.08).add(mx_noise_float(pw.mul(0.7)).mul(0.07)).add(1);
  const vc = vertexColor();
  // bark vs leaf: greens get SSS; trunks get deeper contrast
  const green = smoothstep(0.02, 0.12, vc.y.sub(vc.x.max(vc.z)));
  const barkMul = mix(vec3(0.78, 0.7, 0.62), vec3(1.05, 1.04, 1.0), green);
  m.colorNode = vec3(grain).mul(seasonFoliage()).mul(barkMul);
  // rim light + fake foliage translucency / SSS (canopy glows when looking toward the sun)
  const vdir = normalize(pw.sub(cameraPosition));
  const rim = pow(float(1).sub(clamp(dot(normalView, positionViewDirection), 0, 1)), 2.6);
  const back = pow(clamp(dot(vdir, sunDirU), 0, 1), 2.4).mul(sway.min(1));
  const sss = green.mul(back.mul(0.72).add(rim.mul(0.22))).add(rim.mul(0.08));
  m.emissiveNode = vc.mul(sss);
  m.maskNode = occlusionMask();
  m.maskShadowNode = bool(true); // shadows stay solid
  return m;
}

export function occlusionMask() {
  const p = positionWorld, c = fadeCam, tg = fadeTarget;
  const ct = tg.sub(c);
  const tt = clamp(dot(p.sub(c), ct).div(dot(ct, ct).max(0.001)), 0, 1);
  const d = length(p.sub(c.add(ct.mul(tt))));
  const rad = mix(float(0.8), float(1.9), tt);
  const fade = smoothstep(rad, rad.mul(0.5), d).mul(smoothstep(float(0.93), float(0.78), tt));
  // interleaved gradient noise: even, low-clump dither
  const hash = fract(fract(dot(floor(screenCoordinate.xy), vec2(0.06711056, 0.00583715))).mul(52.9829189));
  return hash.greaterThan(fade.mul(0.92));
}

type Factory = (rnd: () => number) => THREE.BufferGeometry;
interface Spec {
  name: string; make: Factory; variants: number; count: number; biomes: Biome[]; low?: number;
  h?: [number, number]; slope?: number; space: number; scale?: [number, number]; collide?: 'trunk' | 'ball' | 'cactus';
  shadow?: boolean; water?: boolean; snow?: [number, number]; y?: number; tilt?: boolean;
}

const MEADOW_LEAVES = ['#7ccf5a', '#5fb84a', '#8fdc63', '#4fa845', '#a3d95f'];
const BLOSSOM = ['#ffb3c8', '#ff9fb8', '#ffd0dc'];
const AUTUMN_BUSH = ['#e8562e', '#f2a12e', '#d9432a', '#f5c242'];

const SPECS: Spec[] = [
  // Meadow
  { name: 'oak', make: (r) => P.roundTree(r, MEADOW_LEAVES), variants: 3, count: 22, biomes: [Biome.Meadow], h: [0.9, 99], space: 1.8, scale: [0.85, 1.3], collide: 'trunk' },
  { name: 'blossom', make: (r) => P.roundTree(r, BLOSSOM), variants: 2, count: 8, biomes: [Biome.Meadow], h: [0.9, 99], space: 1.8, scale: [0.85, 1.2], collide: 'trunk' },
  { name: 'birch', make: P.birch, variants: 2, count: 14, biomes: [Biome.Meadow, Biome.Autumn], h: [0.9, 99], space: 1.2, scale: [0.85, 1.2], collide: 'trunk' },
  { name: 'bush', make: (r) => P.bush(r, MEADOW_LEAVES), variants: 2, count: 22, biomes: [Biome.Meadow, Biome.Alpine], h: [0.7, 6], space: 0.8, scale: [0.8, 1.4], low: 0.5 },
  { name: 'berry', make: (r) => P.bush(r, MEADOW_LEAVES, '#ff4a6b'), variants: 1, count: 12, biomes: [Biome.Meadow], h: [0.8, 99], space: 0.8, scale: [0.8, 1.3], low: 0.5 },
  { name: 'blueberry', make: (r) => P.bush(r, ['#5fa84a', '#4f9a43'], '#4a5aff'), variants: 1, count: 8, biomes: [Biome.Alpine, Biome.Meadow], h: [1, 6], space: 0.8, low: 0.5 },
  { name: 'lupine', make: (r) => P.tallFlower(r, 'lupine'), variants: 2, count: 30, biomes: [Biome.Meadow, Biome.Alpine], h: [0.9, 6.5], space: 0.5, low: 0.4, shadow: false },
  { name: 'sunflower', make: (r) => P.tallFlower(r, 'sunflower'), variants: 1, count: 12, biomes: [Biome.Meadow], h: [0.9, 99], space: 0.6, low: 0.4 },
  { name: 'foxglove', make: (r) => P.tallFlower(r, 'foxglove'), variants: 1, count: 12, biomes: [Biome.Autumn, Biome.Marsh, Biome.Meadow], h: [0.6, 99], space: 0.5, low: 0.4, shadow: false },
  { name: 'fern', make: P.fern, variants: 2, count: 40, biomes: [Biome.Meadow, Biome.Autumn, Biome.Marsh], h: [0.6, 99], space: 0.6, scale: [0.8, 1.6], low: 0.4, shadow: false },
  { name: 'toadstool', make: (r) => P.mushrooms(r, true), variants: 2, count: 18, biomes: [Biome.Meadow, Biome.Autumn, Biome.Marsh], h: [0.7, 99], space: 0.5, low: 0.4, shadow: false },
  { name: 'rock', make: (r) => P.rock(r, '#b3aca2'), variants: 3, count: 18, biomes: [Biome.Meadow, Biome.Alpine, Biome.Tropical], h: [-0.6, 99], space: 0.9, scale: [0.4, 1.0], collide: 'ball' },
  // Alpine
  { name: 'snowpine', make: (r) => P.pine(r, true), variants: 3, count: 34, biomes: [Biome.Alpine], h: [3.2, 99], slope: 0.8, space: 1.6, scale: [0.8, 1.4], collide: 'trunk' },
  { name: 'pine', make: (r) => P.pine(r), variants: 3, count: 24, biomes: [Biome.Alpine, Biome.Meadow], h: [1.4, 5.5], space: 1.5, scale: [0.85, 1.35], collide: 'trunk' },
  { name: 'snowrock', make: (r) => P.rock(r, '#9fa2a8', true), variants: 2, count: 18, biomes: [Biome.Alpine], h: [3, 99], slope: 1, space: 1.2, scale: [0.5, 1.3], collide: 'ball' },
  // Autumn
  { name: 'maple', make: P.maple, variants: 4, count: 36, biomes: [Biome.Autumn], h: [0.9, 99], space: 1.7, scale: [0.85, 1.35], collide: 'trunk' },
  { name: 'autumnbush', make: (r) => P.bush(r, AUTUMN_BUSH), variants: 2, count: 20, biomes: [Biome.Autumn], h: [0.8, 99], space: 0.8, low: 0.5 },
  { name: 'pumpkin', make: P.pumpkin, variants: 2, count: 12, biomes: [Biome.Autumn], h: [0.8, 99], slope: 0.4, space: 0.7, low: 0.5, shadow: false },
  { name: 'brownshroom', make: (r) => P.mushrooms(r, false), variants: 2, count: 20, biomes: [Biome.Autumn, Biome.Alpine], h: [0.8, 6], space: 0.5, low: 0.4, shadow: false },
  // Tropical
  { name: 'palm', make: P.palm, variants: 4, count: 30, biomes: [Biome.Tropical], h: [0.15, 2.4], slope: 0.6, space: 1.6, scale: [0.9, 1.3], collide: 'trunk' },
  { name: 'tropplant', make: P.tropicalPlant, variants: 3, count: 26, biomes: [Biome.Tropical], h: [0.8, 99], space: 0.9, scale: [0.8, 1.5], low: 0.5 },
  { name: 'hibiscus', make: (r) => P.bush(r, ['#2fa84a', '#3fbf5a'], '#ff3a6b'), variants: 1, count: 12, biomes: [Biome.Tropical], h: [0.8, 99], space: 0.8, low: 0.5 },
  { name: 'shell', make: P.shell, variants: 3, count: 40, biomes: [Biome.Tropical, Biome.Meadow], h: [0.02, 0.7], space: 0.4, low: 0.4, shadow: false, tilt: true },
  // Desert
  { name: 'saguaro', make: P.saguaro, variants: 4, count: 22, biomes: [Biome.Desert], h: [0.5, 99], slope: 0.45, space: 1.4, scale: [0.8, 1.3], collide: 'cactus' },
  { name: 'barrel', make: P.barrelCactus, variants: 2, count: 18, biomes: [Biome.Desert], h: [0.5, 99], slope: 0.5, space: 0.7, low: 0.5 },
  { name: 'prickly', make: P.pricklyPear, variants: 3, count: 16, biomes: [Biome.Desert], h: [0.5, 99], slope: 0.5, space: 0.9, low: 0.5 },
  { name: 'deadtree', make: P.deadTree, variants: 2, count: 7, biomes: [Biome.Desert], h: [0.5, 99], slope: 0.5, space: 1.5, collide: 'trunk' },
  { name: 'drytuft', make: P.dryTuft, variants: 2, count: 50, biomes: [Biome.Desert], h: [0.3, 99], slope: 0.6, space: 0.4, low: 0.4, shadow: false },
  { name: 'sandstone', make: (r) => P.rock(r, '#d08a5a'), variants: 3, count: 18, biomes: [Biome.Desert], h: [0, 99], slope: 1, space: 1, scale: [0.5, 1.4], collide: 'ball' },
  // Marsh
  { name: 'willow', make: P.willow, variants: 2, count: 16, biomes: [Biome.Marsh], h: [0.3, 99], space: 2.4, scale: [0.9, 1.25], collide: 'trunk' },
  { name: 'reeds', make: P.reeds, variants: 3, count: 100, biomes: [Biome.Marsh], h: [-0.4, 0.95], space: 0.45, scale: [0.8, 1.3], low: 0.5, shadow: false },
  { name: 'lily', make: P.lilyPad, variants: 3, count: 34, biomes: [Biome.Marsh], h: [-1.6, -0.2], space: 0.7, scale: [0.7, 1.3], low: 0.6, shadow: false, water: true, y: 0.07 },
  { name: 'marshbush', make: (r) => P.bush(r, ['#6f9a4a', '#5f8f4a', '#7fa85a']), variants: 2, count: 20, biomes: [Biome.Marsh], h: [0.4, 99], space: 0.8, low: 0.5 },
];


function spotKey(x: number, z: number) { return `${x.toFixed(2)},${z.toFixed(2)}`; }

export class Flora {
  group = new THREE.Group();
  private scalable: { mesh: THREE.InstancedMesh; max: number; low: number }[] = [];
  grass!: THREE.InstancedMesh;
  leafLitter!: THREE.InstancedMesh;
  clouds: THREE.Group[] = [];
  /** tree positions (for birds landing / audio density) */
  trees: THREE.Vector3[] = [];
  flowerSpots: THREE.Vector3[] = [];
  /** every placed plant (used for foraging spots) */
  aoPoints: { x: number; z: number; r: number }[] = [];
  spots: { name: string; x: number; z: number; h: number; sc: number }[] = [];
  /** tap-reaction counter (tests / debug); bumped by TapReact */
  reactions = 0;
  /** spots whose canopy was chopped away (stump/grass) — TapReact skips them */
  gone = new Set<string>();
  private physics: Physics;
  private trunks = new Map<string, ReturnType<Physics['addCylinder']>>();

  constructor(physics: Physics, spawn: THREE.Vector2) {
    this.physics = physics;
    const rnd = mulberry32(42);
    const mat = floraMaterial();
    const matDouble = floraMaterial({ side: THREE.DoubleSide });
    const occupied: { x: number; z: number; r: number }[] = [];
    const cell = 3, hash = new Map<string, { x: number; z: number; r: number }[]>();
    const key = (x: number, z: number) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
    const free = (x: number, z: number, r: number) => {
      if (Math.hypot(x - spawn.x, z - spawn.y) < 5) return false;
      const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        for (const o of hash.get(`${cx + i},${cz + j}`) ?? []) if (Math.hypot(o.x - x, o.z - z) < o.r + r) return false;
      }
      return true;
    };
    const occupy = (x: number, z: number, r: number) => { const o = { x, z, r }; occupied.push(o); const k = key(x, z); (hash.get(k) ?? hash.set(k, []).get(k)!).push(o); };
    const w = new Float32Array(BIOME_COUNT);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s3 = new THREE.Vector3(), p3 = new THREE.Vector3();
    const tint = new THREE.Color();

    for (const spec of SPECS) {
      const per = Math.ceil((spec.count * AREA) / spec.variants);
      for (let v = 0; v < spec.variants; v++) {
        const geo = spec.make(rnd);
        const im = new THREE.InstancedMesh(geo, spec.name === 'lily' || spec.name === 'fern' || spec.name === 'tropplant' ? matDouble : mat, per);
        let placed = 0, tries = 0;
        while (placed < per && tries < per * 260) {
          tries++;
          const a = rnd() * 6.28, d = Math.sqrt(rnd()) * ISLAND_RADIUS * 1.1;
          const x = Math.cos(a) * d, z = Math.sin(a) * d;
          const h = heightAt(x, z);
          const [h0, h1] = spec.h ?? [0.8, 99];
          if (h < h0 || h > h1) continue;
          if (slopeAt(x, z) > (spec.slope ?? 0.6)) continue;
          biomeWeights(x, z, w);
          let bw = 0; for (const b of spec.biomes) bw += w[b];
          if (Math.pow(bw, 1.5) < 0.22 + rnd() * 0.6) continue;
          if (!spec.biomes.includes(Biome.Alpine) && snowAt(x, z, h) > 0.3) continue;
          if (spec.water && Math.hypot(x - POND.x, z - POND.z) > POND.r * 1.35) continue;
          const sc = spec.scale ? spec.scale[0] + rnd() * (spec.scale[1] - spec.scale[0]) : 0.85 + rnd() * 0.35;
          const r = spec.space * sc;
          if (!free(x, z, r)) continue;
          occupy(x, z, r);
          const y = spec.y !== undefined ? spec.y : h - 0.05;
          p3.set(x, y, z);
          e.set(spec.tilt ? (rnd() - 0.5) * 0.4 : 0, rnd() * 6.28, spec.tilt ? (rnd() - 0.5) * 0.4 : 0);
          q.setFromEuler(e); s3.setScalar(sc);
          im.setMatrixAt(placed, m4.compose(p3, q, s3));
          const br = 0.88 + rnd() * 0.24;
          im.setColorAt(placed, tint.setRGB(br, br, br * (0.95 + rnd() * 0.1)));
          if (spec.collide === 'trunk') {
            const col = physics.addCylinder(x, h + 1, z, 1, 0.28 * sc);
            this.trunks.set(spotKey(x, z), col);
            this.trees.push(new THREE.Vector3(x, h, z));
          }
          if (spec.shadow !== false && !spec.water) this.aoPoints.push({ x, z, r: (spec.collide === 'trunk' ? 1.4 : 0.6) * sc });
          if (spec.collide === 'cactus') physics.addCylinder(x, h + 1.2, z, 1.2, 0.35 * sc);
          if (spec.collide === 'ball') physics.addBall(x, h + 0.2, z, 0.75 * sc);
          if (spec.name === 'sunflower' || spec.name === 'lupine' || spec.name === 'hibiscus') this.flowerSpots.push(new THREE.Vector3(x, h, z));
          this.spots.push({ name: spec.name, x, z, h, sc });
          placed++;
        }
        im.count = placed;
        im.castShadow = spec.shadow !== false;
        im.receiveShadow = true;
        im.frustumCulled = false; // instances span the island
        im.name = spec.name;
        this.group.add(im);
        if (spec.low !== undefined) this.scalable.push({ mesh: im, max: placed, low: spec.low });
      }
    }
    this.buildFlowers(rnd, free);
    this.buildGrass(rnd, free);
    this.buildLeafLitter(rnd);
    this.chunkAll();
    this.buildClouds(rnd);
  }

  /**
   * Split every island-wide InstancedMesh into 3x3 regional chunks so the
   * renderer can frustum-cull them (main camera and the sun's shadow camera).
   */
  private chunkAll() {
    const N = 3, size = 124, cell = size / N;
    const lowOf = new Map<THREE.InstancedMesh, number>();
    for (const s of this.scalable) lowOf.set(s.mesh, s.low);
    lowOf.set(this.grass, 0.3);
    const next: { mesh: THREE.InstancedMesh; max: number; low: number }[] = [];
    const m = new THREE.Matrix4(), c = new THREE.Color(), p = new THREE.Vector3();
    for (const im of [...this.group.children] as THREE.InstancedMesh[]) {
      if (!im.isInstancedMesh) continue;
      const buckets: number[][] = Array.from({ length: N * N }, () => []);
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, m); p.setFromMatrixPosition(m);
        const cx = Math.min(N - 1, Math.max(0, Math.floor((p.x + size / 2) / cell)));
        const cz = Math.min(N - 1, Math.max(0, Math.floor((p.z + size / 2) / cell)));
        buckets[cz * N + cx].push(i);
      }
      this.group.remove(im);
      for (const b of buckets) {
        if (!b.length) continue;
        const ch = new THREE.InstancedMesh(im.geometry, im.material, b.length);
        b.forEach((src, k) => {
          im.getMatrixAt(src, m); ch.setMatrixAt(k, m);
          if (im.instanceColor) { im.getColorAt(src, c); ch.setColorAt(k, c); }
        });
        ch.castShadow = im.castShadow; ch.receiveShadow = im.receiveShadow; ch.name = im.name;
        ch.computeBoundingSphere();
        ch.frustumCulled = true;
        this.group.add(ch);
        const low = lowOf.get(im);
        if (low !== undefined) next.push({ mesh: ch, max: b.length, low });
      }
    }
    this.scalable = next;
  }

  private buildFlowers(rnd: () => number, free: (x: number, z: number, r: number) => boolean) {
    const N = Math.round(1600 * AREA);
    const stemGeo = new THREE.CylinderGeometry(0.012, 0.015, 0.28, 4); stemGeo.translate(0, 0.14, 0);
    const headGeo = new THREE.IcosahedronGeometry(0.075, 0); headGeo.translate(0, 0.3, 0);
    const stems = new THREE.InstancedMesh(stemGeo, new THREE.MeshStandardNodeMaterial({ color: '#4f9a43', flatShading: true }), N);
    const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardNodeMaterial({ roughness: 0.6, flatShading: true }), N);
    const sets: Record<number, string[]> = {
      [Biome.Meadow]: ['#ff7eb6', '#ffd84d', '#ffffff', '#b98cff', '#ff9a5c', '#7fc8ff'],
      [Biome.Alpine]: ['#7fa8ff', '#ffffff', '#c9b0ff'],
      [Biome.Tropical]: ['#ff4a6b', '#ffb02e', '#ff7aa8'],
      [Biome.Autumn]: ['#ffd84d', '#ff9a5c', '#ffffff'],
      [Biome.Marsh]: ['#ffffff', '#ffe08a', '#c9b0ff'],
      [Biome.Desert]: ['#ff7aa8', '#ffd84d'],
    };
    const w = new Float32Array(BIOME_COUNT);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const patches = Array.from({ length: Math.round(70 * AREA) }, () => {
      const a = rnd() * 6.28, d = Math.sqrt(rnd()) * ISLAND_RADIUS * 0.9;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      biomeWeights(x, z, w);
      let best = 0; for (let k = 1; k < BIOME_COUNT; k++) if (w[k] > w[best]) best = k;
      const set = sets[best];
      return { x, z, c: new THREE.Color(set[Math.floor(rnd() * set.length)]), desert: best === Biome.Desert };
    }).filter((pt) => !pt.desert || rnd() < 0.3);
    let i = 0, tries = 0;
    while (i < N && tries < N * 10) {
      tries++;
      const pt = patches[Math.floor(rnd() * patches.length)];
      const x = pt.x + (rnd() - 0.5) * 5, z = pt.z + (rnd() - 0.5) * 5;
      const h = heightAt(x, z);
      if (h < 0.85 || slopeAt(x, z) > 0.6 || snowAt(x, z, h) > 0.2 || !free(x, z, 0.1)) continue;
      const sc = 0.8 + rnd() * 0.6;
      p.set(x, h - 0.02, z); s.setScalar(sc); q.setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.3, rnd() * 6, (rnd() - 0.5) * 0.3));
      m.compose(p, q, s);
      stems.setMatrixAt(i, m); heads.setMatrixAt(i, m);
      heads.setColorAt(i, pt.c);
      if (i % 9 === 0) this.flowerSpots.push(new THREE.Vector3(x, h, z));
      i++;
    }
    stems.count = heads.count = i;
    heads.castShadow = false;
    stems.receiveShadow = heads.receiveShadow = true;
    stems.frustumCulled = heads.frustumCulled = false;
    this.group.add(stems, heads);
    this.scalable.push({ mesh: stems, max: i, low: 0.35 }, { mesh: heads, max: i, low: 0.35 });
  }

  private buildGrass(rnd: () => number, free: (x: number, z: number, r: number) => boolean) {
    const pos: number[] = [], uvs: number[] = [], nrm: number[] = [];
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI + rnd() * 0.4;
      const ca = Math.cos(a), sa = Math.sin(a);
      const wd = 0.055, h = 0.2 + rnd() * 0.12, lean = (rnd() - 0.5) * 0.12, off = (rnd() - 0.5) * 0.15;
      pos.push(-wd * ca + off, 0, -wd * sa, wd * ca + off, 0, wd * sa, lean * sa + off, h, lean * ca);
      uvs.push(0, 0, 1, 0, 0.5, 1);
      nrm.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    const material = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 0.88 });
    const tip = uv().y;
    // richer tip→root: cooler dark base, brighter sunlit tip; slight warm lift mid-blade
    material.colorNode = mix(mix(vec3(0.68, 0.78, 0.52), vec3(0.95, 1.08, 0.72), tip), vec3(1.18, 1.22, 0.88), tip.mul(tip)).mul(grassTint);
    material.emissiveNode = grassTint.mul(tip.mul(tip).mul(0.07));
    const pl = positionLocal;
    const sway = sin(time.mul(1.8).add(pl.x.mul(0.35)).add(pl.z.mul(0.25))).mul(0.08)
      .add(sin(time.mul(3.1).add(pl.x.mul(1.3))).mul(0.025)).mul(windStrength);
    // snow (winter / christmas) buries the blades to short frosty stubs
    const bury = float(1).sub(snowK.mul(0.72));
    material.positionNode = vec3(pl.x, pl.y.mul(bury), pl.z).add(vec3(sway, float(0), sway.mul(0.6)).mul(tip.mul(tip)).mul(bury));

    const N = Math.round(22000 * AREA);
    const grass = new THREE.InstancedMesh(geo, material, N);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
    const w = new Float32Array(BIOME_COUNT);
    const grassiness = [1, 0.55, 0.85, 0.7, 0.06, 1];
    const tall = [1, 0.9, 1.1, 1.1, 0.8, 1.6];
    let i = 0, tries = 0;
    while (i < N && tries < N * 8) {
      tries++;
      const a = rnd() * 6.28, d = Math.sqrt(rnd()) * ISLAND_RADIUS * 1.08;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const h = heightAt(x, z);
      if (h < 0.75 || slopeAt(x, z) > 0.75 || !free(x, z, 0.05)) continue;
      biomeWeights(x, z, w);
      let g = 0, t = 0; for (let k = 0; k < BIOME_COUNT; k++) { g += w[k] * grassiness[k]; t += w[k] * tall[k]; }
      g *= 1 - snowAt(x, z, h);
      if (w[Biome.Tropical] > 0.3 && h < 1.7) g *= 0.12;
      if (rnd() > g) continue;
      const sc = (0.8 + rnd() * 0.6) * t;
      p.set(x, h - 0.03, z); q.setFromAxisAngle(up, rnd() * 6.28); s.set(sc, sc * (0.8 + rnd() * 0.5), sc);
      grass.setMatrixAt(i, m.compose(p, q, s));
      terrainColor(x, z, h, c);
      grass.setColorAt(i, c);
      i++;
    }
    grass.count = i;
    grass.receiveShadow = true; grass.castShadow = false; grass.frustumCulled = false;
    this.grass = grass;
    this.group.add(grass);
  }

  private buildLeafLitter(rnd: () => number) {
    const geo = new THREE.CircleGeometry(0.09, 5); geo.rotateX(-Math.PI / 2);
    const N = Math.round(2200 * AREA);
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, side: THREE.DoubleSide });
    const im = new THREE.InstancedMesh(geo, mat, N);
    const cols = ['#e8562e', '#f2a12e', '#d9432a', '#f5c242', '#b8322a'].map((c) => new THREE.Color(c));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1.6), p = new THREE.Vector3();
    const w = new Float32Array(BIOME_COUNT);
    let i = 0, tries = 0;
    while (i < N && tries < N * 20) {
      tries++;
      const a = rnd() * 6.28, d = Math.sqrt(rnd()) * ISLAND_RADIUS;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const h = heightAt(x, z);
      if (h < 0.7) continue;
      biomeWeights(x, z, w);
      if (rnd() > smooth(0.3, 0.8, w[Biome.Autumn])) continue;
      p.set(x, h + 0.02, z); q.setFromEuler(e.set((rnd() - 0.5) * 0.4, rnd() * 6.28, (rnd() - 0.5) * 0.4));
      im.setMatrixAt(i, m.compose(p, q, s));
      im.setColorAt(i, cols[Math.floor(rnd() * cols.length)]);
      i++;
    }
    im.count = i; im.receiveShadow = true; im.frustumCulled = false;
    this.leafLitter = im;
    this.group.add(im);
    this.scalable.push({ mesh: im, max: i, low: 0.4 });
  }

  private buildClouds(rnd: () => number) {
    const cm = new THREE.MeshStandardNodeMaterial({ color: '#ffffff', roughness: 1, flatShading: true });
    cm.emissive = new THREE.Color('#fff4ea'); cm.emissiveIntensity = 0.45;
    const geo = new THREE.IcosahedronGeometry(1, 1);
    for (let k = 0; k < 11; k++) {
      const g = new THREE.Group();
      const n = 4 + Math.floor(rnd() * 4);
      for (let i = 0; i < n; i++) {
        const b = new THREE.Mesh(geo, cm);
        const s = 2 + rnd() * 2.5;
        b.scale.set(s * 1.3, s * 0.8, s);
        b.position.set((i - n / 2) * 2.6 + rnd(), rnd() * 1.5, (rnd() - 0.5) * 3);
        g.add(b);
      }
      const a = rnd() * 6.28, d = 70 + rnd() * 80;
      g.position.set(Math.cos(a) * d, 32 + rnd() * 14, Math.sin(a) * d);
      g.userData.speed = 0.4 + rnd() * 0.5;
      g.lookAt(0, g.position.y, 0);
      this.clouds.push(g);
      this.group.add(g);
    }
  }


  /** Stable key for a flora spot (matches Harvest / TapReact). */
  static key(name: string, x: number, z: number) { return `${name}|${x.toFixed(2)}|${z.toFixed(2)}`; }

  findInstance(name: string, x: number, z: number): { mesh: THREE.InstancedMesh; index: number; base: THREE.Matrix4; pos: THREE.Vector3 } | null {
    const m = new THREE.Matrix4(), p = new THREE.Vector3();
    let best: { mesh: THREE.InstancedMesh; index: number; base: THREE.Matrix4; pos: THREE.Vector3 } | null = null;
    let bd = 0.35;
    for (const ch of this.group.children) {
      const im = ch as THREE.InstancedMesh;
      if (!im.isInstancedMesh || im.name !== name) continue;
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, m);
        p.setFromMatrixPosition(m);
        const d = Math.hypot(p.x - x, p.z - z);
        if (d < bd) {
          bd = d;
          best = { mesh: im, index: i, base: m.clone(), pos: p.clone() };
        }
      }
    }
    return best;
  }

  /** Hide a tree canopy (zero scale) and drop its tall trunk collider. Returns false if already gone. */
  fellTree(name: string, x: number, z: number): boolean {
    const k = Flora.key(name, x, z);
    if (this.gone.has(k)) return false;
    this.gone.add(k);
    const hit = this.findInstance(name, x, z);
    if (hit) {
      const zed = new THREE.Matrix4().makeScale(0, 0, 0);
      hit.mesh.setMatrixAt(hit.index, zed);
      hit.mesh.instanceMatrix.needsUpdate = true;
    }
    const col = this.trunks.get(spotKey(x, z));
    if (col) { this.physics.remove(col); this.trunks.delete(spotKey(x, z)); }
    return true;
  }

  /** Shrink / replace trunk collider with a stump-sized one while the stump is visible. */
  setStumpCollider(x: number, z: number, h: number, sc: number) {
    const k = spotKey(x, z);
    const old = this.trunks.get(k);
    if (old) { this.physics.remove(old); this.trunks.delete(k); }
    const col = this.physics.addCylinder(x, h + 0.22, z, 0.22, 0.22 * sc);
    this.trunks.set(k, col);
  }

  clearTrunkCollider(x: number, z: number) {
    const k = spotKey(x, z);
    const old = this.trunks.get(k);
    if (old) { this.physics.remove(old); this.trunks.delete(k); }
  }

  setQuality(high: boolean) {
    for (const s of this.scalable) s.mesh.count = Math.floor(s.max * (high ? 1 : s.low));
  }

  update(dt: number) {
    for (const c of this.clouds) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 170) c.position.x = -170;
    }
  }
}
