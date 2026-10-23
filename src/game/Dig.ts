import * as THREE from 'three/webgpu';
import { heightAt, slopeAt, surfaceAt, biomeWeights, type Surface } from '../world/Terrain';
import { inWorld } from '../world/config';
import { Biome, BIOME_COUNT } from '../world/Biomes';
import type { FoodId } from './Items';

/** what a free dig turned up */
export type Find = { kind: 'item'; id: FoodId; n: number } | { kind: 'coins'; n: number } | { kind: 'wearable' } | { kind: 'nothing' };

export const DIGGABLE: Surface[] = ['grass', 'sand', 'snow', 'mud', 'leaves'];
const MOUND: Record<string, string> = { grass: '#8a6a44', sand: '#e8cf98', snow: '#f4f6fa', mud: '#6a5236', leaves: '#9a6a3a' };
const HOLE_LIFE = 95; // seconds until fully healed
const CAP = 24;

interface Hole { x: number; y: number; z: number; t: number; age: number; col: THREE.Color; rot: number; live: boolean; }
const easeOutBack = (t: number) => { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

/**
 * Shovel digging: holes with a little mound beside them (instanced, capped), dirt chunks flying,
 * and holes that slowly heal back over. Rolls a biome-flavoured find.
 */
export class Dig {
  group = new THREE.Group();
  holes: Hole[] = [];
  private holeMesh: THREE.InstancedMesh; private moundMesh: THREE.InstancedMesh; private chunks: THREE.InstancedMesh;
  private bits: { p: THREE.Vector3; v: THREE.Vector3; life: number; s: number }[] = [];
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(); private s = new THREE.Vector3(); private v = new THREE.Vector3();
  private w = new Float32Array(BIOME_COUNT);
  private next = 0;

  constructor() {
    // hole: dark disc with a lighter rim (vertex colours), sits just above the ground
    const hg = new THREE.CircleGeometry(0.42, 18); hg.rotateX(-Math.PI / 2);
    const cols: number[] = []; const pa = hg.attributes.position;
    for (let i = 0; i < pa.count; i++) { const r = Math.hypot(pa.getX(i), pa.getZ(i)) / 0.42; const c = new THREE.Color('#2a1c12').lerp(new THREE.Color('#5a3e26'), Math.pow(r, 2.5)); cols.push(c.r, c.g, c.b); }
    hg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    this.holeMesh = new THREE.InstancedMesh(hg, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: -3, depthWrite: false, transparent: true }), CAP);
    this.holeMesh.renderOrder = 2;
    const mg = new THREE.SphereGeometry(0.3, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2); mg.scale(1.1, 0.5, 0.8);
    this.moundMesh = new THREE.InstancedMesh(mg, new THREE.MeshStandardNodeMaterial({ roughness: 1, flatShading: true }), CAP);
    this.chunks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.055, 0), new THREE.MeshStandardNodeMaterial({ roughness: 1, flatShading: true }), 60);
    for (const im of [this.holeMesh, this.moundMesh, this.chunks]) { im.frustumCulled = false; im.castShadow = false; im.receiveShadow = im !== this.chunks; this.group.add(im); for (let i = 0; i < im.count; i++) im.setMatrixAt(i, this.m.makeScale(0, 0, 0)); }
    this.moundMesh.castShadow = true;
    for (let i = 0; i < CAP; i++) { this.holes.push({ x: 0, y: 0, z: 0, t: 0, age: 0, col: new THREE.Color(), rot: 0, live: false }); this.moundMesh.setColorAt(i, new THREE.Color('#8a6a44')); }
    for (let i = 0; i < 60; i++) this.chunks.setColorAt(i, new THREE.Color('#7a5434'));
  }

  /** can you dig here? returns the surface or a reason */
  check(x: number, z: number, blocked: (x: number, z: number) => boolean): { ok: true; surface: Surface } | { ok: false; why: string } {
    const s = surfaceAt(x, z);
    if (!inWorld(x, z, 1)) return { ok: false, why: '💧 Too wet to dig here' };
    if (s === 'water') return { ok: false, why: '💧 Too wet to dig here' };
    if (!DIGGABLE.includes(s)) return { ok: false, why: '🪨 Too rocky to dig here' };
    if (slopeAt(x, z) > 0.75) return { ok: false, why: '⛰️ Too steep to dig here' };
    if (blocked(x, z)) return { ok: false, why: '🧱 Something is in the way' };
    for (const h of this.holes) if (h.live && Math.hypot(h.x - x, h.z - z) < 0.7) return { ok: false, why: '🕳️ Already dug here' };
    return { ok: true, surface: s };
  }

  /** make a hole (the mound lands on the player's side) */
  hole(x: number, z: number, surface: Surface, side: number) {
    const h = this.holes[this.next]; this.next = (this.next + 1) % CAP;
    h.x = x; h.z = z; h.y = heightAt(x, z); h.t = 0; h.age = 0; h.live = true; h.rot = side;
    h.col.set(MOUND[surface] ?? '#8a6a44');
    this.moundMesh.setColorAt(this.holes.indexOf(h), h.col);
    if (this.moundMesh.instanceColor) this.moundMesh.instanceColor.needsUpdate = true;
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      this.bits.push({ p: new THREE.Vector3(x, h.y + 0.1, z), v: new THREE.Vector3(Math.cos(a) * (0.6 + Math.random()), 2.2 + Math.random() * 2.2, Math.sin(a) * (0.6 + Math.random())), life: 0.9 + Math.random() * 0.3, s: 0.6 + Math.random() * 0.8 });
    }
    if (this.bits.length > 60) this.bits.splice(0, this.bits.length - 60);
    for (let i = 0; i < 60; i++) this.chunks.setColorAt(i, h.col.clone().multiplyScalar(0.85 + Math.random() * 0.2));
    if (this.chunks.instanceColor) this.chunks.instanceColor.needsUpdate = true;
  }

  /** what's buried here? weighted by biome; luck from how many holes you've dug */
  roll(x: number, z: number, surface: Surface, owned: number, total: number): Find {
    const w = biomeWeights(x, z, this.w);
    const r = Math.random();
    const table: [Find, number][] = [
      [{ kind: 'nothing' }, 26],
      [{ kind: 'item', id: 'worm', n: 1 + (Math.random() < 0.3 ? 1 : 0) }, 20 * (w[Biome.Meadow] + w[Biome.Autumn] + w[Biome.Marsh] + 0.2)],
      [{ kind: 'item', id: 'bug', n: 1 }, 14 * (w[Biome.Meadow] + w[Biome.Autumn] + w[Biome.Tropical] * 0.6 + 0.2)],
      [{ kind: 'item', id: 'seeds', n: 1 }, 8 * (w[Biome.Meadow] + 0.2)],
      [{ kind: 'coins', n: 2 + Math.floor(Math.random() * 4) }, 12],
      [{ kind: 'item', id: 'fossil', n: 1 }, 6 * (w[Biome.Desert] * 2 + w[Biome.Alpine] + 0.15)],
      [{ kind: 'item', id: 'gem', n: 1 }, 4 * (w[Biome.Alpine] * 2 + w[Biome.Desert] + 0.15)],
      [{ kind: 'item', id: 'conch', n: 1 }, surface === 'sand' ? 8 : 0],
      [{ kind: 'wearable' }, owned < total ? 2.2 : 0],
    ];
    let sum = 0; for (const [, wt] of table) sum += wt;
    let k = r * sum; for (const [f, wt] of table) { if ((k -= wt) <= 0) return f; }
    return { kind: 'nothing' };
  }

  update(dt: number) {
    const m = this.m, q = this.q, s = this.s, v = this.v;
    for (let i = 0; i < CAP; i++) {
      const h = this.holes[i];
      if (!h.live) continue;
      h.t = Math.min(1, h.t + dt / 0.35); h.age += dt;
      const heal = Math.min(1, Math.max(0, (h.age - (HOLE_LIFE - 20)) / 20)); // last 20 s: grass grows back over
      if (heal >= 1) { h.live = false; this.holeMesh.setMatrixAt(i, m.makeScale(0, 0, 0)); this.moundMesh.setMatrixAt(i, m.makeScale(0, 0, 0)); continue; }
      const k = easeOutBack(h.t) * (1 - heal);
      this.holeMesh.setMatrixAt(i, m.compose(v.set(h.x, h.y + 0.035, h.z), q.setFromEuler(this.e.set(0, h.rot, 0)), s.set(k, 1, k * 0.85)));
      const mx = h.x + Math.cos(h.rot) * 0.55, mz = h.z + Math.sin(h.rot) * 0.55;
      this.moundMesh.setMatrixAt(i, m.compose(v.set(mx, heightAt(mx, mz) - 0.02, mz), q.setFromEuler(this.e.set(0, -h.rot, 0)), s.set(k, k * (1 - heal * 0.5), k)));
    }
    this.holeMesh.instanceMatrix.needsUpdate = true; this.moundMesh.instanceMatrix.needsUpdate = true;
    let n = 0;
    for (const b of this.bits) {
      b.life -= dt; if (b.life <= 0) continue;
      b.v.y -= 12 * dt; b.p.addScaledVector(b.v, dt);
      const g = heightAt(b.p.x, b.p.z); if (b.p.y < g + 0.03) { b.p.y = g + 0.03; b.v.multiplyScalar(0.3); }
      this.chunks.setMatrixAt(n++, m.compose(b.p, q.identity(), s.setScalar(b.s * Math.min(1, b.life * 3))));
    }
    this.bits = this.bits.filter((b) => b.life > 0);
    for (let i = n; i < 60; i++) this.chunks.setMatrixAt(i, m.makeScale(0, 0, 0));
    this.chunks.instanceMatrix.needsUpdate = true;
  }
  get liveHoles() { return this.holes.filter((h) => h.live).length; }
}
