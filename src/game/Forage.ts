import * as THREE from 'three/webgpu';
import { Baker } from '../world/Baker';
import { heightAt, slopeAt, biomeWeights, ISLAND_RADIUS } from '../world/Terrain';
import { Biome, BIOME_COUNT } from '../world/Biomes';
import { mulberry32 } from '../world/noise';
import type { Flora } from '../world/Flora';
import type { FoodId } from './Items';

const sph = (r: number) => new THREE.SphereGeometry(r, 9, 7);
const cyl = (a: number, b: number, h: number) => new THREE.CylinderGeometry(a, b, h, 6);
const cone = (r: number, h: number) => new THREE.ConeGeometry(r, h, 7);

function foodGeo(id: FoodId): THREE.BufferGeometry {
  const b = new Baker(); b.ao = false;
  switch (id) {
    case 'apple': b.add(sph(0.13), '#e8343a', [0, 0.12, 0], [0, 0, 0], [1, 0.9, 1]).add(cyl(0.01, 0.012, 0.07), '#6b4a2a', [0, 0.25, 0]).add(sph(0.04), '#5fbf4a', [0.04, 0.26, 0], [0, 0, 0.6], [1.6, 0.4, 0.8]); break;
    case 'cherry': b.add(sph(0.065), '#d81e3a', [-0.05, 0.065, 0]).add(sph(0.065), '#e0283f', [0.06, 0.065, 0.02]).add(cyl(0.006, 0.006, 0.16), '#4f7a2a', [-0.02, 0.15, 0], [0, 0, 0.35]).add(cyl(0.006, 0.006, 0.16), '#4f7a2a', [0.03, 0.15, 0.01], [0, 0, -0.35]); break;
    case 'berry': for (let i = 0; i < 6; i++) b.add(sph(0.045), i % 2 ? '#ff3a5a' : '#e0283f', [Math.cos(i) * 0.06, 0.05 + (i % 3) * 0.03, Math.sin(i) * 0.06]); b.add(sph(0.05), '#4f9a43', [0, 0.13, 0], [0, 0, 0], [1.6, 0.3, 1.2]); break;
    case 'blueberry': for (let i = 0; i < 7; i++) b.add(sph(0.04), i % 2 ? '#4a5aff' : '#3a48d8', [Math.cos(i * 1.3) * 0.06, 0.04 + (i % 3) * 0.028, Math.sin(i * 1.3) * 0.06]); break;
    case 'acorn': b.add(sph(0.075), '#c98a4a', [0, 0.08, 0], [0, 0, 0], [1, 1.25, 1]).add(new THREE.SphereGeometry(0.08, 9, 5, 0, 6.29, 0, 1.6), '#7a5a3a', [0, 0.12, 0]).add(cyl(0.008, 0.01, 0.05), '#5a3a2a', [0, 0.21, 0]); break;
    case 'mushroom': b.add(cyl(0.035, 0.045, 0.12), '#f4ead8', [0, 0.06, 0]).add(new THREE.SphereGeometry(0.1, 10, 6, 0, 6.29, 0, 1.6), '#c9763e', [0, 0.11, 0], [0, 0, 0], [1, 0.75, 1]); break;
    case 'pinecone': for (let i = 0; i < 4; i++) b.add(cone(0.075 - i * 0.012, 0.09), '#8a5c3a', [0, 0.05 + i * 0.05, 0], [Math.PI, i, 0]); break;
    case 'coconut': b.add(sph(0.14), '#7a5232', [0, 0.13, 0]).add(sph(0.025), '#4a3020', [0.05, 0.22, 0.09]).add(sph(0.025), '#4a3020', [-0.05, 0.22, 0.09]); break;
    case 'cactusfruit': b.add(sph(0.08), '#e0405a', [0, 0.09, 0], [0, 0, 0], [0.9, 1.25, 0.9]).add(cone(0.04, 0.05), '#5f9a4a', [0, 0.2, 0]); break;
    case 'seeds': b.add(cyl(0.12, 0.12, 0.03), '#6b4a2a', [0, 0.04, 0]); for (let i = 0; i < 10; i++) { const a = i * 0.628; b.add(cone(0.04, 0.09), '#ffcc2e', [Math.cos(a) * 0.15, 0.04, Math.sin(a) * 0.15], [0, -a, Math.PI / 2]); } break;
    case 'clover': for (let i = 0; i < 3; i++) { const a = i * 2.094; b.add(sph(0.05), '#3fae46', [Math.cos(a) * 0.05, 0.12, Math.sin(a) * 0.05], [0, 0, 0], [1, 0.3, 1]); } b.add(cyl(0.006, 0.006, 0.12), '#3f8a40', [0, 0.06, 0]); break;
    case 'carrot': b.add(cone(0.05, 0.1), '#ff8a2e', [0, 0.03, 0], [Math.PI, 0, 0]); for (let i = 0; i < 4; i++) b.add(cone(0.02, 0.18), '#4fbf4a', [Math.cos(i * 1.57) * 0.02, 0.15, Math.sin(i * 1.57) * 0.02], [Math.cos(i * 1.57) * 0.3, 0, Math.sin(i * 1.57) * 0.3]); break;
    case 'reed': for (let i = 0; i < 3; i++) b.add(new THREE.CapsuleGeometry(0.02, 0.1, 2, 5), '#d9b25a', [(i - 1) * 0.04, 0.2, 0], [0, 0, (i - 1) * 0.2]).add(cyl(0.005, 0.005, 0.2), '#a8944a', [(i - 1) * 0.03, 0.08, 0]); break;
  }
  return b.build();
}

/** plant name → [food, chance, min, max, ring radius min, max] */
const SOURCES: Record<string, [FoodId, number, number, number, number, number]> = {
  oak: ['apple', 0.75, 1, 3, 0.7, 1.4], blossom: ['cherry', 0.85, 1, 2, 0.6, 1.3], berry: ['berry', 0.9, 1, 2, 0.35, 0.7],
  hibiscus: ['berry', 0.5, 1, 1, 0.35, 0.7], blueberry: ['blueberry', 0.95, 1, 2, 0.35, 0.7], maple: ['acorn', 0.6, 1, 2, 0.7, 1.4],
  birch: ['acorn', 0.3, 1, 1, 0.5, 1.0], toadstool: ['mushroom', 0.6, 1, 1, 0.3, 0.6], brownshroom: ['mushroom', 0.7, 1, 2, 0.3, 0.6],
  pine: ['pinecone', 0.5, 1, 2, 0.8, 1.4], snowpine: ['pinecone', 0.5, 1, 2, 0.8, 1.4], palm: ['coconut', 0.75, 1, 2, 0.5, 1.2],
  prickly: ['cactusfruit', 0.85, 1, 2, 0.4, 0.7], saguaro: ['cactusfruit', 0.4, 1, 1, 0.5, 0.9], sunflower: ['seeds', 0.85, 1, 1, 0.3, 0.6],
  reeds: ['reed', 0.35, 1, 1, 0.3, 0.6],
};
const CAP = 34;

export interface FoodItem { id: FoodId; x: number; y: number; z: number; rot: number; idx: number; active: boolean; t: number; respawn: number; }

const easeOutBack = (t: number) => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

export class Forage {
  group = new THREE.Group();
  items: FoodItem[] = [];
  private meshes = new Map<FoodId, THREE.InstancedMesh>();
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(); private s = new THREE.Vector3(); private v = new THREE.Vector3();
  private dirty = new Set<FoodId>();

  constructor(flora: Flora, spawn: THREE.Vector2) {
    const rnd = mulberry32(99);
    const counts = new Map<FoodId, number>();
    const add = (id: FoodId, x: number, z: number) => {
      const n = counts.get(id) ?? 0;
      if (n >= CAP) return;
      const h = heightAt(x, z);
      if (h < 0.15 || slopeAt(x, z) > 0.7 || Math.hypot(x - spawn.x, z - spawn.y) < 2.5) return;
      counts.set(id, n + 1);
      this.items.push({ id, x, y: h - 0.02, z, rot: rnd() * 6.28, idx: n, active: true, t: 1, respawn: 0 });
    };
    const order = [...flora.spots].sort(() => rnd() - 0.5);
    for (const sp of order) {
      const src = SOURCES[sp.name]; if (!src) continue;
      const [id, p, mn, mx, r0, r1] = src;
      if (rnd() > p) continue;
      const k = mn + Math.floor(rnd() * (mx - mn + 1));
      for (let i = 0; i < k; i++) { const a = rnd() * 6.28, r = (r0 + rnd() * (r1 - r0)) * sp.sc; add(id, sp.x + Math.cos(a) * r, sp.z + Math.sin(a) * r); }
    }
    // free-standing ground forage: clover (meadow/marsh) and wild carrots (meadow)
    const w = new Float32Array(BIOME_COUNT);
    for (let tries = 0; tries < 4000; tries++) {
      const a = rnd() * 6.28, d = Math.sqrt(rnd()) * ISLAND_RADIUS;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (heightAt(x, z) < 0.9) continue;
      biomeWeights(x, z, w);
      if (w[Biome.Meadow] + w[Biome.Marsh] > 0.6 && rnd() < 0.5) add('clover', x, z);
      else if (w[Biome.Meadow] > 0.6) add('carrot', x, z);
    }
    const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.5, flatShading: true });
    mat.emissive = new THREE.Color('#ffffff'); mat.emissiveIntensity = 0.06;
    for (const [id, n] of counts) {
      const im = new THREE.InstancedMesh(foodGeo(id), mat, n);
      im.castShadow = true; im.frustumCulled = false; im.name = 'food-' + id;
      this.meshes.set(id, im); this.group.add(im);
      this.dirty.add(id);
    }
    for (const it of this.items) this.write(it, 1);
  }

  private write(it: FoodItem, scale: number) {
    const im = this.meshes.get(it.id)!;
    this.v.set(it.x, it.y, it.z);
    this.q.setFromEuler(this.e.set(0, it.rot, 0));
    this.s.setScalar(Math.max(0.0001, scale) * 1.15);
    im.setMatrixAt(it.idx, this.m.compose(this.v, this.q, this.s));
    this.dirty.add(it.id);
  }

  nearest(p: THREE.Vector3, maxD: number): FoodItem | null {
    let best: FoodItem | null = null, bd = maxD;
    for (const it of this.items) {
      if (!it.active || it.t < 0.9) continue;
      const d = Math.hypot(it.x - p.x, it.z - p.z);
      if (d < bd && Math.abs(it.y - p.y) < 1.6) { bd = d; best = it; }
    }
    return best;
  }

  pick(it: FoodItem) { it.active = false; it.t = 0; it.respawn = 120 + Math.random() * 120; }

  update(dt: number) {
    for (const it of this.items) {
      if (!it.active) {
        if (it.t < 1) { it.t = Math.min(1, it.t + dt / 0.28); const k = it.t; this.write(it, k < 0.35 ? 1 + k * 0.9 : (1 - k) * 1.8); }
        it.respawn -= dt;
        if (it.respawn <= 0) { it.active = true; it.t = 0; }
      } else if (it.t < 1) { it.t = Math.min(1, it.t + dt / 0.7); this.write(it, easeOutBack(it.t)); }
    }
    for (const id of this.dirty) this.meshes.get(id)!.instanceMatrix.needsUpdate = true;
    this.dirty.clear();
  }
}
