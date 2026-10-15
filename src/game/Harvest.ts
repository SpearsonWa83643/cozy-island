import * as THREE from 'three/webgpu';
import { Baker } from '../world/Baker';
import { Flora } from '../world/Flora';
import { theme } from '../theme/theme';
import type { AudioEngine } from '../audio/Audio';
import type { FoodId } from './Items';

/** How long a stump stays before it fades back into grass (game time, s). */
export const STUMP_S = 75;
/** Wood hits per choppable tree. */
export const WOOD_STOCK = 5;
/** Fruit hanging on a full fruit tree. */
export const FRUIT_STOCK = 4;
/** Seconds for one fruit to grow back. */
export const FRUIT_REGROW_S = 38;
/** Shortest gap between two fruit-giving taps. */
export const FRUIT_TAP_S = 0.65;

type Spot = { name: string; x: number; z: number; h: number; sc: number };

/** Leaf / wood trees (tap for wood until stump). Fruit trees are fruit-only. */
const WOOD = new Set(['birch', 'maple', 'pine', 'snowpine', 'willow', 'palm', 'deadtree']);
/** Fruit trees: hang fruit, deplete, regrow (no wood). */
const FRUIT: Record<string, FoodId> = { oak: 'apple', blossom: 'cherry' };

/** Canopy slots as fractions of height / radius. */
const FRUIT_SLOTS: [number, number, number][] = [
  [-0.35, 0.62, 0.1], [0.32, 0.68, -0.08], [-0.08, 0.52, 0.3], [0.28, 0.55, 0.22],
  [-0.3, 0.48, -0.2], [0.05, 0.74, 0.05],
];

type StumpRec = {
  key: string; x: number; z: number; h: number; sc: number;
  state: 'falling' | 'stump' | 'grass'; age: number; fallT: number;
  mesh: THREE.Mesh; grass: THREE.Mesh[];
};
type FruitDot = { mesh: THREE.Mesh; on: boolean; slot: number; targetSc: number };
type FruitRec = {
  key: string; spot: Spot; food: FoodId; stock: number; nextAt: number; cool: number; dots: FruitDot[];
};

const easeOutBack = (t: number) => { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

function stumpGeo(birch: boolean): THREE.BufferGeometry {
  const bark = birch ? '#e8e0d0' : '#7a5232';
  const top = birch ? '#c8b898' : '#5a3a22';
  const b = new Baker(); b.ao = false;
  b.add(new THREE.CylinderGeometry(0.22, 0.28, 0.38, 8), bark, [0, 0.19, 0]);
  b.add(new THREE.CylinderGeometry(0.24, 0.24, 0.06, 8), top, [0, 0.4, 0]);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    b.add(new THREE.SphereGeometry(0.08, 6, 4), bark, [Math.cos(a) * 0.22, 0.05, Math.sin(a) * 0.22], [0, 0, 0], [1.2, 0.5, 0.8]);
  }
  return b.build();
}

function tuftGeo(): THREE.BufferGeometry {
  const b = new Baker(); b.ao = false;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    b.add(new THREE.ConeGeometry(0.04, 0.22, 4), i % 2 ? '#6fbf4a' : '#4fa845',
      [Math.cos(a) * 0.06, 0.1, Math.sin(a) * 0.06], [Math.cos(a) * 0.25, 0, Math.sin(a) * 0.25]);
  }
  return b.build();
}

function appleGeo(): THREE.BufferGeometry {
  const b = new Baker(); b.ao = false;
  b.add(new THREE.SphereGeometry(0.09, 7, 5), '#e8343a', [0, 0, 0], [0, 0, 0], [1, 0.9, 1])
    .add(new THREE.CylinderGeometry(0.008, 0.01, 0.05, 4), '#6b4a2a', [0, 0.1, 0])
    .add(new THREE.SphereGeometry(0.03, 5, 3), '#5fbf4a', [0.03, 0.1, 0], [0, 0, 0.6], [1.4, 0.35, 0.7]);
  return b.build();
}
function cherryGeo(): THREE.BufferGeometry {
  const b = new Baker(); b.ao = false;
  b.add(new THREE.SphereGeometry(0.05, 6, 4), '#d81e3a', [-0.04, 0, 0])
    .add(new THREE.SphereGeometry(0.05, 6, 4), '#e0283f', [0.045, 0, 0.015])
    .add(new THREE.CylinderGeometry(0.005, 0.005, 0.1, 4), '#4f7a2a', [-0.01, 0.07, 0], [0, 0, 0.3]);
  return b.build();
}

/**
 * Tree chopping (wood → stump → grass) and fruit-tree stock / regrow.
 * Tap trees (same as TapReact): wood trees yield wood until empty; fruit trees drop fruit.
 */
export class Harvest {
  group = new THREE.Group();
  chops = 0;
  fruitPicks = 0;
  stumps: StumpRec[] = [];
  stumpS = STUMP_S;
  fruitRegrowS = FRUIT_REGROW_S;

  private wood = new Map<string, { stock: number }>();
  private fruit = new Map<string, FruitRec>();
  private tips = new Set<string>();
  private stumpGeoO = stumpGeo(false);
  private stumpGeoB = stumpGeo(true);
  private tuftG = tuftGeo();
  private appleG = appleGeo();
  private cherryG = cherryGeo();
  private stumpMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
  private stumpBirchMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });
  private tuftMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });
  private appleMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.45, flatShading: true });
  private cherryMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.45, flatShading: true });
  private ghosts: { mesh: THREE.Mesh; t: number; sign: number }[] = [];
  private grows: { mesh: THREE.Mesh; t: number; target: number }[] = [];
  private pops: { mesh: THREE.Mesh; t: number; y0: number }[] = [];

  constructor(
    private flora: Flora,
    private audio: AudioEngine,
    private grant: (id: FoodId | 'wood', pos: THREE.Vector3, icon: string) => void,
    private toast: (html: string, ms?: number) => void,
    private emote: (pos: THREE.Vector3, icon: string) => void,
  ) {
    this.group.name = 'harvest';
    for (const sp of this.flora.spots) {
      const food = FRUIT[sp.name];
      if (food) this.ensureFruit(sp, food);
    }
  }

  isGone(sp: Spot) { return this.flora.gone.has(Flora.key(sp.name, sp.x, sp.z)); }
  isWood(name: string) { return WOOD.has(name); }
  isFruit(name: string) { return !!FRUIT[name]; }

  /** After TapReact leans a tree: grant wood or pick fruit when close enough. */
  onTreeTap(sp: Spot, player: THREE.Vector3): boolean {
    if (this.isGone(sp)) return false;
    if (Math.hypot(sp.x - player.x, sp.z - player.z) > 7.5) return false;
    if (FRUIT[sp.name]) return this.pickFruit(sp);
    if (WOOD.has(sp.name)) return this.hitWood(sp);
    return false;
  }

  private tipOnce(id: string, msg: string) {
    if (this.tips.has(id)) return;
    this.tips.add(id);
    this.toast(msg, 2800);
  }

  private ensureFruit(sp: Spot, food: FoodId): FruitRec {
    const key = Flora.key(sp.name, sp.x, sp.z);
    let rec = this.fruit.get(key);
    if (rec) return rec;
    const geo = food === 'cherry' ? this.cherryG : this.appleG;
    const mat = food === 'cherry' ? this.cherryMat : this.appleMat;
    const start = Math.floor(Math.abs(Math.sin(sp.x * 12.9898 + sp.z * 78.233)) * FRUIT_SLOTS.length) % FRUIT_SLOTS.length;
    const canopy = 1.8 + sp.sc * 1.6;
    const rad = 0.55 * sp.sc;
    const dots: FruitDot[] = [];
    for (let i = 0; i < FRUIT_STOCK; i++) {
      const [sx, sy, sz] = FRUIT_SLOTS[(start + i) % FRUIT_SLOTS.length];
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.position.set(sp.x + sx * rad * 1.6, sp.h + sy * canopy, sp.z + sz * rad * 1.6);
      const targetSc = 0.85 + (i % 3) * 0.08;
      mesh.scale.setScalar(targetSc);
      this.group.add(mesh);
      dots.push({ mesh, on: true, slot: (start + i) % FRUIT_SLOTS.length, targetSc });
    }
    rec = { key, spot: sp, food, stock: FRUIT_STOCK, nextAt: 0, cool: 0, dots };
    this.fruit.set(key, rec);
    return rec;
  }

  private hitWood(sp: Spot): boolean {
    const key = Flora.key(sp.name, sp.x, sp.z);
    let rec = this.wood.get(key);
    if (!rec) { rec = { stock: WOOD_STOCK }; this.wood.set(key, rec); }
    if (rec.stock <= 0) return false;
    rec.stock--;
    this.chops++;
    const pos = new THREE.Vector3(sp.x, sp.h + 1.2 * sp.sc, sp.z);
    this.audio.dig();
    this.audio.rustleTap(0.7);
    this.grant('wood', pos, '🪵');
    this.emote(pos.clone().add(new THREE.Vector3(0, 0.35, 0)), '🪵');
    if (rec.stock > 0) this.tipOnce('harvest', 'Wood! Keep tapping to get more.');
    else this.fell(sp);
    return true;
  }

  private fell(sp: Spot) {
    if (!this.flora.fellTree(sp.name, sp.x, sp.z)) return;
    const birch = sp.name === 'birch';
    const mat = (birch ? this.stumpBirchMat : this.stumpMat).clone();
    if (theme.id === 'halloween') mat.color = new THREE.Color('#c8b0d8');
    mat.transparent = true;
    const mesh = new THREE.Mesh(birch ? this.stumpGeoB : this.stumpGeoO, mat);
    mesh.position.set(sp.x, sp.h - 0.02, sp.z);
    mesh.scale.setScalar(0.01);
    mesh.rotation.y = Math.random() * 6.28;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.visible = false;
    this.group.add(mesh);

    // temporary canopy ghost that shrinks away
    const ghost = new THREE.Mesh(
      new THREE.ConeGeometry(0.55 * sp.sc, 2.2 * sp.sc, 7),
      new THREE.MeshStandardNodeMaterial({
        color: theme.id === 'halloween' ? '#ffa64d' : birch ? '#f0d36a' : '#8fcf6a',
        transparent: true, opacity: 0.9, flatShading: true, roughness: 0.9, depthWrite: false,
      }),
    );
    ghost.position.set(sp.x, sp.h + 1.1 * sp.sc, sp.z);
    this.group.add(ghost);
    this.ghosts.push({ mesh: ghost, t: 0, sign: Math.random() < 0.5 ? -1 : 1 });

    this.stumps.push({
      key: Flora.key(sp.name, sp.x, sp.z), x: sp.x, z: sp.z, h: sp.h, sc: sp.sc,
      state: 'falling', age: 0, fallT: 0, mesh, grass: [],
    });
    this.flora.setStumpCollider(sp.x, sp.z, sp.h, sp.sc);
    this.tipOnce('stump', 'Timber! The tree is all used up.');
  }

  private pickFruit(sp: Spot): boolean {
    const food = FRUIT[sp.name];
    if (!food) return false;
    const rec = this.ensureFruit(sp, food);
    if (rec.cool > 0) return false;
    rec.cool = FRUIT_TAP_S;
    if (rec.stock <= 0) {
      this.tipOnce('fruitwait', 'This tree needs time to grow more fruit.');
      this.audio.rustleTap(1.1);
      return true;
    }
    let dot: FruitDot | null = null;
    for (const d of rec.dots) if (d.on) dot = d;
    if (dot) {
      dot.on = false;
      this.pops.push({ mesh: dot.mesh, t: 0, y0: dot.mesh.position.y });
    }
    if (rec.stock >= FRUIT_STOCK) rec.nextAt = this.fruitRegrowS;
    rec.stock--;
    this.fruitPicks++;
    const pos = new THREE.Vector3(sp.x, sp.h + 1.4 * sp.sc, sp.z);
    this.audio.pop(1.4);
    this.grant(food, pos, food === 'cherry' ? '🍒' : '🍎');
    this.emote(pos, food === 'cherry' ? '🍒' : '🍎');
    if (rec.stock === 0) this.tipOnce('fruitempty', 'Picked clean! Fruit will grow back.');
    return true;
  }

  private regrow(rec: FruitRec) {
    const off = rec.dots.find((d) => !d.on);
    if (!off) { rec.stock = FRUIT_STOCK; rec.nextAt = 0; return; }
    off.on = true;
    const canopy = 1.8 + rec.spot.sc * 1.6;
    const rad = 0.55 * rec.spot.sc;
    const [sx, sy, sz] = FRUIT_SLOTS[off.slot % FRUIT_SLOTS.length];
    off.mesh.position.set(rec.spot.x + sx * rad * 1.6, rec.spot.h + sy * canopy, rec.spot.z + sz * rad * 1.6);
    off.mesh.visible = true;
    off.mesh.scale.setScalar(0.01);
    this.grows.push({ mesh: off.mesh, t: 0, target: off.targetSc });
    rec.stock = Math.min(FRUIT_STOCK, rec.stock + 1);
    rec.nextAt = rec.stock < FRUIT_STOCK ? this.fruitRegrowS : 0;
    this.audio.pop(1.8);
  }

  private toGrass(rec: StumpRec) {
    if (rec.state !== 'stump') return;
    rec.state = 'grass';
    rec.age = 0;
    const mat = rec.mesh.material as THREE.MeshStandardNodeMaterial;
    mat.transparent = true;
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Mesh(this.tuftG, this.tuftMat);
      g.position.set(rec.x + (i - 1) * 0.18, rec.h - 0.02, rec.z + (i % 2) * 0.08 - 0.04);
      g.rotation.y = Math.random() * 6;
      g.scale.setScalar(0.01);
      g.visible = false;
      this.group.add(g);
      rec.grass.push(g);
    }
    this.flora.clearTrunkCollider(rec.x, rec.z);
    this.audio.rustleTap(1.2);
  }

  setStumpS(s: number) { this.stumpS = s; }
  setFruitRegrowS(s: number) {
    this.fruitRegrowS = s;
    for (const rec of this.fruit.values()) {
      if (rec.stock < FRUIT_STOCK && rec.nextAt > 0) rec.nextAt = Math.min(rec.nextAt, s);
    }
  }

  stumpDebug() { return this.stumps.map((s) => [s.x, s.z, s.state, s.age] as const); }
  fruitDebug() {
    return [...this.fruit.values()].map((f) =>
      [f.spot.x, f.spot.z, f.spot.name, f.stock, f.dots.filter((d) => d.on).length] as const);
  }
  woodLeft(sp: Spot) { return this.wood.get(Flora.key(sp.name, sp.x, sp.z))?.stock ?? WOOD_STOCK; }

  update(dt: number) {
    for (const rec of this.fruit.values()) {
      if (rec.cool > 0) rec.cool -= dt;
      if (rec.stock < FRUIT_STOCK && rec.nextAt > 0) {
        rec.nextAt -= dt;
        if (rec.nextAt <= 0) this.regrow(rec);
      }
    }

    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.t += dt;
      const u = Math.min(1, p.t / 0.35);
      p.mesh.position.y = p.y0 - u * 0.55;
      p.mesh.scale.setScalar(Math.max(0.01, 0.9 * (1 - u)));
      if (u >= 1) { p.mesh.visible = false; this.pops.splice(i, 1); }
    }

    for (let i = this.grows.length - 1; i >= 0; i--) {
      const g = this.grows[i];
      g.t += dt;
      const u = Math.min(1, g.t / 0.45);
      g.mesh.scale.setScalar(0.01 + (g.target - 0.01) * easeOutBack(u));
      if (u >= 1) this.grows.splice(i, 1);
    }

    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      g.t += dt;
      const u = Math.min(1, g.t / 0.65);
      g.mesh.scale.set(1 - u * 0.35, Math.max(0.05, 1 - u * 0.92), 1 - u * 0.35);
      g.mesh.rotation.z = g.sign * u * 0.35;
      (g.mesh.material as THREE.MeshStandardNodeMaterial).opacity = 1 - u;
      if (u >= 1) {
        this.group.remove(g.mesh);
        (g.mesh.material as THREE.Material).dispose();
        g.mesh.geometry.dispose();
        this.ghosts.splice(i, 1);
      }
    }

    for (const rec of this.stumps) {
      if (rec.state === 'falling') {
        rec.fallT += dt;
        if (rec.fallT >= 0.28) {
          rec.mesh.visible = true;
          const u = Math.min(1, (rec.fallT - 0.28) / 0.52);
          const k = easeOutBack(u);
          rec.mesh.scale.setScalar(rec.sc * 1.05 * Math.max(0.01, k));
          if (u >= 1) { rec.state = 'stump'; rec.age = 0; }
        }
      } else if (rec.state === 'stump') {
        rec.age += dt;
        if (rec.age >= this.stumpS) this.toGrass(rec);
      } else if (rec.state === 'grass') {
        rec.age += dt;
        const mat = rec.mesh.material as THREE.MeshStandardNodeMaterial;
        const fade = Math.min(1, rec.age / 1.6);
        mat.opacity = 1 - fade;
        rec.mesh.scale.y = rec.sc * 1.05 * (1 - fade * 0.5);
        if (fade >= 1) rec.mesh.visible = false;
        for (let i = 0; i < rec.grass.length; i++) {
          const g = rec.grass[i];
          const delay = 0.55 + i * 0.16;
          const u = Math.min(1, Math.max(0, (rec.age - delay) / 0.7));
          g.visible = u > 0;
          g.scale.setScalar(easeOutBack(u) * (0.9 + i * 0.06));
        }
      }
    }
  }
}
