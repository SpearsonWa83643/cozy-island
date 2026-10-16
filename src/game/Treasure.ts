import * as THREE from 'three/webgpu';
import { Baker } from '../world/Baker';
import { heightAt, slopeAt, biomeWeights, ISLAND_RADIUS } from '../world/Terrain';
import { Biome, BIOME_CENTERS, BIOME_COUNT, BIOME_NAMES, POND } from '../world/Biomes';
import { mulberry32 } from '../world/noise';
import type { Flora } from '../world/Flora';
import type { SaveData } from './Save';
import { theme, HALLOWEEN_WEAR } from '../theme/theme';
import { RARITY, WEARABLES, type Rarity, type WearDef , CAVE_WEAR } from './Items';
import { nextMountTreasure, mountForTreasure } from '../player/MountDefs';

const easeOutBack = (t: number) => { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const easeOutElastic = (t: number) => t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

const BIOME_ORDER = [Biome.Meadow, Biome.Autumn, Biome.Tropical, Biome.Marsh, Biome.Desert, Biome.Alpine];
const PLANT_WORDS: Record<string, string> = {
  oak: 'an apple tree', blossom: 'a blossom tree', maple: 'a maple', birch: 'a birch', pine: 'a pine', snowpine: 'a snowy pine',
  palm: 'a palm', saguaro: 'a tall cactus', barrel: 'a barrel cactus', prickly: 'a prickly pear', willow: 'a willow', dead: 'an old dead tree',
  rock: 'a big rock', bush: 'a bush', berry: 'a berry bush', reeds: 'the reeds', sunflower: 'the sunflowers', pumpkin: 'the pumpkins',
};
const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const dirWord = (dx: number, dz: number) => DIRS[(Math.round(Math.atan2(dx, -dz) / (Math.PI / 4)) + 8) % 8];

export type Stage = 'none' | 'bottle' | 'active' | 'dug' | 'opened';

/** Buried-treasure loop: message bottle → map → dig spot → chest → wearable + next map. */
export class Treasure {
  group = new THREE.Group();
  bottlePos = new THREE.Vector3();
  private bottle: THREE.Group;
  private crack: THREE.Mesh;
  private sparkles: THREE.InstancedMesh;
  private chest: THREE.Group; private lid: THREE.Group;
  private glow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicNodeMaterial>;
  private confetti: THREE.InstancedMesh;
  private conf: { p: THREE.Vector3; v: THREE.Vector3; r: THREE.Euler; w: THREE.Vector3; life: number }[] = [];
  private dirt: THREE.InstancedMesh;
  private dirtP: { p: THREE.Vector3; v: THREE.Vector3; life: number }[] = [];
  private digT = -1; private openT = -1; private riseT = -1; private sinkT = -1;
  private t = 0;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private s = new THREE.Vector3(); private v = new THREE.Vector3();
  onDug: () => void = () => {};

  constructor(private save: SaveData, private flora: Flora, private spawn: THREE.Vector2) {
    // message bottle
    const bb = new Baker(); bb.ao = false;
    bb.add(new THREE.CapsuleGeometry(0.1, 0.22, 4, 10), '#7fd6c8', [0, 0, 0], [0, 0, Math.PI / 2 - 0.15])
      .add(new THREE.CylinderGeometry(0.045, 0.05, 0.12, 8), '#6fc0b4', [0.22, 0.03, 0], [0, 0, Math.PI / 2 - 0.15])
      .add(new THREE.CylinderGeometry(0.04, 0.04, 0.06, 8), '#b07a4a', [0.3, 0.045, 0], [0, 0, Math.PI / 2 - 0.15])
      .add(new THREE.CylinderGeometry(0.07, 0.07, 0.2, 8), '#f2e2b8', [0, 0, 0], [0, 0, Math.PI / 2 - 0.15]);
    const bm = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.92 });
    this.bottle = new THREE.Group(); const bmesh = new THREE.Mesh(bb.build(), bm); bmesh.castShadow = true; this.bottle.add(bmesh);
    this.group.add(this.bottle);
    this.findBottleSpot();

    // star-shaped dig crack
    const sh = new THREE.Shape();
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2, r = i % 2 ? 0.16 : 0.5; i ? sh.lineTo(Math.cos(a) * r, Math.sin(a) * r) : sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    const cg = new THREE.ShapeGeometry(sh); cg.rotateX(-Math.PI / 2);
    this.crack = new THREE.Mesh(cg, new THREE.MeshStandardNodeMaterial({ color: '#4a3424', roughness: 1, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    this.crack.renderOrder = 2;
    this.group.add(this.crack);

    // sparkles
    const sg = new THREE.OctahedronGeometry(0.05, 0);
    const smat = new THREE.MeshBasicNodeMaterial({ color: '#fff3b0' });
    this.sparkles = new THREE.InstancedMesh(sg, smat, 14); this.sparkles.frustumCulled = false;
    this.group.add(this.sparkles);

    // chest
    this.chest = new THREE.Group(); this.lid = new THREE.Group();
    const cb = new Baker(); cb.ao = false;
    cb.add(new THREE.BoxGeometry(0.9, 0.5, 0.6), '#9a6236', [0, 0.25, 0]).add(new THREE.BoxGeometry(0.94, 0.08, 0.64), '#e0b13a', [0, 0.06, 0])
      .add(new THREE.BoxGeometry(0.08, 0.52, 0.64), '#e0b13a', [-0.3, 0.26, 0]).add(new THREE.BoxGeometry(0.08, 0.52, 0.64), '#e0b13a', [0.3, 0.26, 0])
      .add(new THREE.BoxGeometry(0.14, 0.16, 0.05), '#ffd24a', [0, 0.44, 0.31]).add(new THREE.BoxGeometry(0.84, 0.02, 0.54), '#3a2414', [0, 0.5, 0]);
    const lb = new Baker(); lb.ao = false;
    const lidGeo = new THREE.CylinderGeometry(0.31, 0.31, 0.9, 12, 1, false, 0, Math.PI); lidGeo.rotateZ(Math.PI / 2); lidGeo.rotateX(-Math.PI / 2);
    lb.add(lidGeo, '#a86c3c', [0, 0, 0.3]).add(new THREE.BoxGeometry(0.08, 0.34, 0.66), '#e0b13a', [-0.3, 0.12, 0.3]).add(new THREE.BoxGeometry(0.08, 0.34, 0.66), '#e0b13a', [0.3, 0.12, 0.3]);
    const cm = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15 });
    const base = new THREE.Mesh(cb.build(), cm); base.castShadow = true;
    const lidM = new THREE.Mesh(lb.build(), cm); lidM.castShadow = true;
    lidM.scale.set(1, 0.75, 1);
    this.lid.add(lidM); this.lid.position.set(0, 0.5, -0.3);
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), new THREE.MeshBasicNodeMaterial({ color: '#ffe9a0', transparent: true, opacity: 0, depthWrite: false }));
    this.glow.rotation.x = -Math.PI / 2; this.glow.position.y = 0.51;
    this.chest.add(base, this.lid, this.glow); this.chest.visible = false;
    this.group.add(this.chest);

    // confetti + dirt
    const pg = new THREE.PlaneGeometry(0.07, 0.11);
    this.confetti = new THREE.InstancedMesh(pg, new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide }), 90); this.confetti.frustumCulled = false; this.confetti.count = 0;
    const cols = ['#ff7eb6', '#ffd84d', '#7fc8ff', '#8fe08a', '#b98cff', '#ffffff', '#ff9a5c'];
    for (let i = 0; i < 90; i++) this.confetti.setColorAt(i, new THREE.Color(cols[i % cols.length]));
    this.dirt = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.06, 0), new THREE.MeshStandardNodeMaterial({ color: '#7a5434', flatShading: true }), 40); this.dirt.frustumCulled = false; this.dirt.count = 0;
    this.group.add(this.confetti, this.dirt);

    if (this.save.map.state === 'active' && this.save.map.hint === '') this.newSpot();
    this.syncVisuals();
  }

  get state(): Stage { return this.save.map.state; }
  get spot() { return new THREE.Vector3(this.save.map.x, heightAt(this.save.map.x, this.save.map.z), this.save.map.z); }
  get chestPos() { return this.chest.position; }
  get busy() { return this.digT >= 0 || this.riseT >= 0 || this.openT >= 0; }

  private findBottleSpot() {
    // walk outward from spawn toward the south-east beach until we hit the tideline
    for (const ang of [2.3, 2.0, 2.6, 1.6, 3.0, 1.2, 0.6]) {
      const dx = Math.sin(ang), dz = -Math.cos(ang);
      for (let r = 4; r < 60; r += 0.5) {
        const x = this.spawn.x + dx * r, z = this.spawn.y + dz * r;
        const h = heightAt(x, z);
        if (h < 0.25) { const bx = x - dx * 1.6, bz = z - dz * 1.6; if (heightAt(bx, bz) > 0.05 && r < 40) { this.bottlePos.set(bx, heightAt(bx, bz) + 0.08, bz); return; } break; }
      }
    }
    this.bottlePos.set(this.spawn.x + 3, heightAt(this.spawn.x + 3, this.spawn.y) + 0.08, this.spawn.y);
  }

  /** Pick a new procedural chest spot; rotates through biomes and keeps a distance from the last one. */
  newSpot() {
    const mp = this.save.map;
    const rnd = mulberry32(mp.seed + mp.n * 7919);
    const target = BIOME_ORDER[mp.n % BIOME_ORDER.length];
    const w = new Float32Array(BIOME_COUNT);
    const px = mp.x || this.spawn.x, pz = mp.z || this.spawn.y;
    let best: [number, number] | null = null;
    for (let tries = 0; tries < 3000 && !best; tries++) {
      const strict = tries < 2000;
      const c = BIOME_CENTERS[target];
      const a = rnd() * 6.28, r = Math.sqrt(rnd()) * (strict ? c[2] * 1.1 : ISLAND_RADIUS);
      const x = (strict ? c[0] : 0) + Math.cos(a) * r, z = (strict ? c[1] : 0) + Math.sin(a) * r;
      const h = heightAt(x, z);
      if (h < 0.5 || h > 13 || slopeAt(x, z) > 0.42) continue;
      if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 1.5) continue;
      if (Math.hypot(x - px, z - pz) < (mp.n === 0 ? 12 : 22)) continue;
      if (mp.n === 0 && Math.hypot(x - this.spawn.x, z - this.spawn.y) > 26) continue;
      biomeWeights(x, z, w);
      if (strict && w[target] < 0.6) continue;
      // not inside a tree trunk
      if (this.flora.trees.some((t) => Math.hypot(t.x - x, t.z - z) < 1.3)) continue;
      best = [x, z];
    }
    const [x, z] = best ?? [this.spawn.x + 6, this.spawn.y + 6];
    biomeWeights(x, z, w);
    let bi = 0; for (let i = 1; i < BIOME_COUNT; i++) if (w[i] > w[bi]) bi = i;
    mp.x = x; mp.z = z; mp.biome = bi; mp.state = 'active';
    mp.hint = this.hintFor(x, z, bi);
    this.syncVisuals();
  }

  private hintFor(x: number, z: number, bi: number) {
    let near = '', nd = 6;
    for (const s of this.flora.spots) {
      const word = PLANT_WORDS[s.name]; if (!word) continue;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < nd) { nd = d; near = word; }
    }
    const c = BIOME_CENTERS[bi];
    const side = Math.hypot(x - c[0], z - c[1]) < c[2] * 0.35 ? 'in the heart of' : `on the ${dirWord(x - c[0], z - c[1])} side of`;
    const place = bi === Biome.Marsh ? 'the Misty Marsh' : `the ${BIOME_NAMES[bi]}`;
    const base = near ? `Dig ${side} ${place}, close to ${near}.` : `Dig ${side} ${place}, where the ground is soft.`;
    // a chest that carries a mount treasure gets a little teaser on the map
    const mt = nextMountTreasure(this.save);
    return mt ? `${base} ✨ Something warm and magical is inside — a ${mountForTreasure(mt)?.short ?? 'flying'} friend's treasure!` : base;
  }

  takeBottle() { this.save.map.state = 'active'; this.newSpot(); }

  startDig() { if (this.digT < 0) this.digT = 0; }

  /** Roll a wearable: rarity weights + luck from chests opened + pity (Rare+ at least every 4th chest). */
  roll(owned: Record<string, number>): { item: WearDef; dup: boolean } {
    const mp = this.save.map;
    const luck = Math.min(1, this.save.chests / 25);
    const weights = RARITY.map((r, i) => r.weight * (i >= 2 ? 1 + luck : 1));
    let rar: Rarity;
    if (mp.sincePity >= 3) { rar = 2; const sub = weights.slice(2); let x = Math.random() * sub.reduce((a, b) => a + b); for (let i = 0; i < sub.length; i++) { x -= sub[i]; if (x <= 0) { rar = (i + 2) as Rarity; break; } } }
    else { let x = Math.random() * weights.reduce((a, b) => a + b); rar = 0; for (let i = 0; i < weights.length; i++) { x -= weights[i]; if (x <= 0) { rar = i as Rarity; break; } } }
    mp.sincePity = rar >= 2 ? 0 : mp.sincePity + 1;
    const pool = WEARABLES.filter((w) => w.rarity === rar && !CAVE_WEAR.includes(w.id) && (!HALLOWEEN_WEAR.includes(w.id) || theme.collectibles.wear.includes(w.id)));
    const fresh = pool.filter((w) => !owned[w.id]);
    // strongly prefer something new, but duplicates can still happen (they become shells)
    const usePool = fresh.length && Math.random() < 0.8 ? fresh : pool;
    const item = usePool[Math.floor(Math.random() * usePool.length)];
    return { item, dup: !!owned[item.id] };
  }

  open(rarity: number) {
    if (this.openT >= 0) return;
    this.openT = 0;
    // confetti burst
    this.conf = [];
    const n = 50 + rarity * 10;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, sp = 2 + Math.random() * 3;
      this.conf.push({ p: this.chest.position.clone().add(new THREE.Vector3(0, 0.6, 0)), v: new THREE.Vector3(Math.cos(a) * sp * 0.5, 4 + Math.random() * 3.5, Math.sin(a) * sp * 0.5),
        r: new THREE.Euler(Math.random() * 6, Math.random() * 6, 0), w: new THREE.Vector3(Math.random() * 10 - 5, Math.random() * 10 - 5, 0), life: 2.2 + Math.random() });
    }
    this.confetti.count = n;
  }

  /** after the reward is granted, the chest sinks away and a new map takes over */
  finish() { this.sinkT = 0; }

  syncVisuals() {
    const st = this.state;
    this.bottle.visible = st === 'bottle';
    this.bottle.position.copy(this.bottlePos);
    const sp = this.spot;
    this.crack.position.set(sp.x, sp.y + 0.03, sp.z);
    if (st === 'dug' && this.riseT < 0 && this.openT < 0) { this.chest.visible = true; this.chest.position.set(sp.x, sp.y - 0.02, sp.z); this.lid.rotation.x = 0; this.glow.material.opacity = 0; }
  }

  /** how strongly the treasure cues are shown (0 far … 1 on top) */
  closeness(p: THREE.Vector3) { if (this.state !== 'active') return 0; const d = Math.hypot(p.x - this.save.map.x, p.z - this.save.map.z); return Math.max(0, 1 - d / 35); }

  update(dt: number, player: THREE.Vector3) {
    this.t += dt;
    const st = this.state, sp = this.spot;
    // bottle bobs at the tideline
    if (this.bottle.visible) { this.bottle.position.y = this.bottlePos.y + Math.sin(this.t * 2) * 0.03; this.bottle.rotation.set(Math.sin(this.t * 1.3) * 0.1, this.t * 0.2, 0); }
    // crack + sparkles fade in by distance
    const d = Math.hypot(player.x - sp.x, player.z - sp.z);
    const showCrack = st === 'active' ? 1 - Math.min(1, Math.max(0, (d - 6) / 3)) : 0;
    this.crack.visible = showCrack > 0.01 || this.digT >= 0;
    this.crack.scale.setScalar(Math.max(0.01, easeOutBack(Math.min(1, showCrack)) * (this.digT >= 0 ? 1 + this.digT * 0.6 : 1)));
    const spark = st === 'active' ? 1 - Math.min(1, Math.max(0, (d - 10) / 5)) : st === 'bottle' ? 1 - Math.min(1, Math.max(0, (Math.hypot(player.x - this.bottlePos.x, player.z - this.bottlePos.z) - 10) / 5)) : 0;
    const sc = st === 'bottle' ? this.bottlePos : sp;
    for (let i = 0; i < 14; i++) {
      const ph = (this.t * 0.35 + i / 14) % 1;
      const a = i * 2.4 + this.t * 1.2, r = 0.25 + ph * 0.35;
      this.v.set(sc.x + Math.cos(a) * r, sc.y + 0.1 + ph * 1.8, sc.z + Math.sin(a) * r);
      this.s.setScalar(Math.max(0.0001, spark * Math.sin(ph * Math.PI) * (0.7 + 0.5 * Math.sin(this.t * 9 + i))));
      this.q.setFromAxisAngle(this.v.clone().set(0, 1, 0), this.t * 3 + i);
      this.sparkles.setMatrixAt(i, this.m.compose(this.v, this.q, this.s));
    }
    this.sparkles.instanceMatrix.needsUpdate = true;
    this.sparkles.visible = spark > 0.01;

    // digging: dirt puffs, then the chest rises with an overshoot
    if (this.digT >= 0) {
      const prev = this.digT; this.digT += dt;
      for (const k of [0, 0.35, 0.7]) if (prev < k && this.digT >= k) {
        for (let i = 0; i < 12; i++) { const a = Math.random() * 6.28; this.dirtP.push({ p: sp.clone().add(new THREE.Vector3(0, 0.1, 0)), v: new THREE.Vector3(Math.cos(a) * 1.5, 2.5 + Math.random() * 2, Math.sin(a) * 1.5), life: 0.9 }); }
        if (this.dirtP.length > 40) this.dirtP.splice(0, this.dirtP.length - 40);
      }
      if (this.digT > 1.0) {
        this.digT = -1; this.save.map.state = 'dug'; this.riseT = 0;
        this.chest.visible = true; this.chest.position.set(sp.x, sp.y - 0.6, sp.z); this.chest.rotation.y = Math.atan2(player.x - sp.x, player.z - sp.z);
        this.lid.rotation.x = 0; this.glow.material.opacity = 0;
        this.onDug();
      }
    }
    if (this.riseT >= 0) {
      this.riseT = Math.min(1, this.riseT + dt / 0.8);
      this.chest.position.y = sp.y - 0.6 + easeOutBack(this.riseT) * 0.58;
      this.chest.rotation.z = Math.sin(this.riseT * 18) * 0.06 * (1 - this.riseT);
      if (this.riseT >= 1) this.riseT = -1;
    }
    // opening: lid pops with an elastic ease, inner glow
    if (this.openT >= 0) {
      this.openT += dt;
      const k = Math.min(1, this.openT / 0.9);
      this.lid.rotation.x = -easeOutElastic(k) * 1.95;
      this.glow.material.opacity = Math.min(1, this.openT * 3) * (0.8 + 0.2 * Math.sin(this.t * 8));
      this.chest.scale.set(1 + Math.sin(Math.min(1, this.openT / 0.25) * Math.PI) * 0.12, 1 - Math.sin(Math.min(1, this.openT / 0.25) * Math.PI) * 0.1, 1);
    }
    if (this.sinkT >= 0) {
      this.sinkT += dt;
      const k = Math.min(1, this.sinkT / 1.2);
      this.chest.scale.setScalar(Math.max(0.001, 1 - easeOutCubic(k)));
      this.chest.position.y -= dt * 0.3;
      if (k >= 1) { this.sinkT = -1; this.openT = -1; this.chest.visible = false; this.chest.scale.setScalar(1); }
    }
    // particles
    let n = 0;
    for (const c of this.conf) {
      if (c.life <= 0) continue;
      c.life -= dt; c.v.y -= 6 * dt; c.v.multiplyScalar(1 - dt * 1.4); c.p.addScaledVector(c.v, dt);
      if (c.p.y < heightAt(c.p.x, c.p.z) + 0.02) { c.p.y = heightAt(c.p.x, c.p.z) + 0.02; c.v.set(0, 0, 0); c.w.set(0, 0, 0); }
      c.r.x += c.w.x * dt; c.r.y += c.w.y * dt;
      this.s.setScalar(Math.min(1, c.life * 2));
      this.confetti.setMatrixAt(n++, this.m.compose(c.p, this.q.setFromEuler(c.r), this.s));
    }
    this.confetti.count = n; this.confetti.instanceMatrix.needsUpdate = true;
    n = 0;
    for (const p of this.dirtP) {
      if (p.life <= 0) continue;
      p.life -= dt; p.v.y -= 12 * dt; p.p.addScaledVector(p.v, dt);
      this.s.setScalar(Math.min(1, p.life * 3));
      this.dirt.setMatrixAt(n++, this.m.compose(p.p, this.q.identity(), this.s));
    }
    this.dirt.count = n; this.dirt.instanceMatrix.needsUpdate = true;
  }
}
