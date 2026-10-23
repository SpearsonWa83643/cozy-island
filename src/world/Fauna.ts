import * as THREE from 'three/webgpu';
import { Baker } from './Baker';
import { Biome, BIOME_COUNT, POND } from './Biomes';
import { biomeWeights, heightAt, slopeAt } from './Terrain';
import { ISLAND_RADIUS } from './config';
import { mulberry32 } from './noise';

type Rnd = () => number;
const sph = (r: number) => new THREE.SphereGeometry(r, 8, 6);
const cyl = (a: number, b: number, h: number) => new THREE.CylinderGeometry(a, b, h, 5);

// ---------- creature geometry ----------
function bunnyGeo(col: string) {
  return new Baker()
    .add(sph(0.18), col, [0, 0.17, 0], [0, 0, 0], [1, 0.9, 1.25])
    .add(sph(0.12), col, [0, 0.3, 0.17])
    .add(new THREE.CapsuleGeometry(0.03, 0.16, 2, 5), col, [-0.05, 0.47, 0.15], [-0.2, 0, -0.15])
    .add(new THREE.CapsuleGeometry(0.03, 0.16, 2, 5), col, [0.05, 0.47, 0.15], [-0.2, 0, 0.15])
    .add(sph(0.06), '#ffffff', [0, 0.2, -0.22])
    .add(sph(0.018), '#2a2a2a', [-0.06, 0.33, 0.27]).add(sph(0.018), '#2a2a2a', [0.06, 0.33, 0.27])
    .add(sph(0.02), '#ff9aa8', [0, 0.3, 0.29]).build();
}
function deerGeo() {
  const b = new Baker(), c = '#b07a4e', d = '#8a5a36';
  b.add(new THREE.CapsuleGeometry(0.22, 0.55, 3, 8), c, [0, 0.85, 0], [Math.PI / 2, 0, 0]);
  for (const [x, z] of [[-0.13, 0.28], [0.13, 0.28], [-0.13, -0.28], [0.13, -0.28]]) b.add(cyl(0.035, 0.03, 0.7), d, [x, 0.38, z]);
  b.add(cyl(0.08, 0.1, 0.45), c, [0, 1.17, 0.38], [0.5, 0, 0]);
  b.add(new THREE.CapsuleGeometry(0.1, 0.16, 3, 7), c, [0, 1.38, 0.5], [1.3, 0, 0]);
  b.add(sph(0.04), '#2a2a2a', [0, 1.36, 0.66]);
  b.add(cone(0.05, 0.14), c, [-0.1, 1.5, 0.45], [0, 0, 0.6]).add(cone(0.05, 0.14), c, [0.1, 1.5, 0.45], [0, 0, -0.6]);
  b.add(sph(0.07), '#ffffff', [0, 0.95, -0.42]);
  for (const s of [-1, 1]) { b.add(cyl(0.015, 0.02, 0.3), '#e8d8b8', [s * 0.08, 1.62, 0.44], [0, 0, s * 0.4]); b.add(cyl(0.012, 0.015, 0.15), '#e8d8b8', [s * 0.14, 1.7, 0.5], [0.8, 0, s * 0.4]); }
  for (let i = 0; i < 5; i++) b.add(sph(0.03), '#f4ead8', [(i % 2 ? -1 : 1) * 0.1, 1.0 + (i % 3) * 0.04, -0.1 + i * 0.1]);
  return b.build();
}
function foxGeo() {
  const b = new Baker(), o = '#e2702e', w = '#fbf3e6', dk = '#3a2a22';
  b.add(sph(0.16), o, [0, 0.27, 0], [0, 0, 0], [0.85, 0.8, 1.6]);
  b.add(sph(0.09), w, [0, 0.24, 0.17], [0, 0, 0], [0.8, 0.8, 0.9]);
  for (const [x, z] of [[-0.07, 0.15], [0.07, 0.15], [-0.07, -0.15], [0.07, -0.15]]) b.add(cyl(0.025, 0.02, 0.2), dk, [x, 0.1, z]);
  b.add(sph(0.12), o, [0, 0.42, 0.25], [0, 0, 0], [1, 0.9, 1]);
  b.add(cone(0.065, 0.16), o, [0, 0.39, 0.38], [Math.PI / 2, 0, 0], [1, 1, 0.8]).add(cone(0.04, 0.1), w, [0, 0.37, 0.36], [Math.PI / 2, 0, 0]);
  b.add(sph(0.022), dk, [0, 0.4, 0.46]);
  b.add(sph(0.018), dk, [-0.055, 0.46, 0.34]).add(sph(0.018), dk, [0.055, 0.46, 0.34]);
  b.add(cone(0.05, 0.13), o, [-0.07, 0.56, 0.22], [0, 0, 0.25]).add(cone(0.05, 0.13), o, [0.07, 0.56, 0.22], [0, 0, -0.25]);
  b.add(sph(0.1), o, [0, 0.32, -0.32], [-0.5, 0, 0], [0.75, 0.75, 1.7]).add(sph(0.06), w, [0, 0.4, -0.48], [-0.5, 0, 0], [0.9, 0.9, 1.2]);
  return b.build();
}
function goatGeo() {
  const b = new Baker(), w = '#f2ede2', g = '#d9d0bf', dk = '#4a3f36', hn = '#b8a98e';
  b.add(sph(0.22), w, [0, 0.52, 0], [0, 0, 0], [0.9, 0.85, 1.45]);
  b.add(sph(0.14), g, [0, 0.47, 0.16], [0, 0, 0], [1, 1, 0.9]);
  for (const [x, z] of [[-0.1, 0.18], [0.1, 0.18], [-0.1, -0.18], [0.1, -0.18]]) { b.add(cyl(0.035, 0.03, 0.36), w, [x, 0.2, z]); b.add(cyl(0.034, 0.036, 0.06), dk, [x, 0.03, z]); }
  b.add(cyl(0.07, 0.09, 0.22), w, [0, 0.72, 0.28], [0.5, 0, 0]);
  b.add(new THREE.CapsuleGeometry(0.085, 0.14, 3, 7), w, [0, 0.82, 0.4], [1.2, 0, 0]);
  b.add(sph(0.035), dk, [0, 0.78, 0.53]);
  b.add(sph(0.018), dk, [-0.07, 0.88, 0.45]).add(sph(0.018), dk, [0.07, 0.88, 0.45]);
  b.add(cone(0.04, 0.12), w, [0, 0.68, 0.48], [Math.PI, 0, 0]); // beard
  for (const s of [-1, 1]) {
    b.add(cone(0.03, 0.2), hn, [s * 0.05, 1.0, 0.35], [-0.6, 0, s * 0.15]); // horns sweep back
    b.add(sph(0.04), w, [s * 0.11, 0.9, 0.36], [0, 0, 0], [1.6, 0.6, 0.8]); // ears
  }
  b.add(sph(0.06), w, [0, 0.62, -0.32]);
  return b.build();
}
function cone(r: number, h: number) { return new THREE.ConeGeometry(r, h, 5); }
function duckGeo() {
  return new Baker()
    .add(sph(0.2), '#f4f0e8', [0, 0.08, 0], [0, 0, 0], [1, 0.75, 1.35])
    .add(sph(0.12), '#2f7a4a', [0, 0.3, 0.2]).add(cyl(0.07, 0.07, 0.03), '#ffffff', [0, 0.2, 0.18])
    .add(cone(0.05, 0.13), '#ff9a2e', [0, 0.28, 0.35], [Math.PI / 2, 0, 0])
    .add(cone(0.08, 0.16), '#d8d0c0', [0, 0.14, -0.3], [-2.2, 0, 0])
    .add(sph(0.02), '#1a1a1a', [-0.08, 0.33, 0.27]).add(sph(0.02), '#1a1a1a', [0.08, 0.33, 0.27]).build();
}
function crabGeo() {
  const b = new Baker(), c = '#e0502e';
  b.add(sph(0.14), c, [0, 0.09, 0], [0, 0, 0], [1.3, 0.55, 1]);
  for (const s of [-1, 1]) {
    b.add(sph(0.06), c, [s * 0.2, 0.1, 0.12], [0, 0, 0], [1, 0.7, 1.2]);
    b.add(cyl(0.012, 0.012, 0.1), c, [s * 0.05, 0.17, 0.08]).add(sph(0.025), '#1a1a1a', [s * 0.05, 0.22, 0.08]);
    for (let k = 0; k < 3; k++) b.add(cyl(0.012, 0.012, 0.14), c, [s * 0.17, 0.05, -0.06 + k * 0.06], [0, 0, s * 1.1]);
  }
  return b.build();
}
function fishGeo(col: string) {
  return new Baker().add(sph(0.12), col, [0, 0, 0], [0, 0, 0], [0.55, 0.8, 1.6])
    .add(cone(0.1, 0.16), col, [0, 0, -0.24], [-Math.PI / 2, 0, 0], [0.3, 1, 1.2]).build();
}

// ---------- ground / water wanderers ----------
interface Kind {
  name: string; geo: THREE.BufferGeometry; count: number; low: number; biomes: Biome[];
  h: [number, number]; speed: number; flee: number; fleeDist: number; anim: 'hop' | 'walk' | 'swim' | 'scuttle' | 'pounce' | 'leap'; homeR: number; pond?: boolean;
  /** max terrain slope this animal will stand on (default 0.7); goats climb steep rock */
  maxSlope?: number;
  colors?: string[];
}
export interface Agent {
  x: number; z: number; y: number; yaw: number; tx: number; tz: number; state: 0 | 1 | 2; timer: number; ph: number; hx: number; hz: number;
  pc?: number;
  friend: boolean; slot: number; hunger: number; fed: number; ret: boolean; vx: number; vz: number; joy: number; id: number;
}
/** Shared per-frame context for befriended followers. */
export interface FollowCtx {
  trail: (dist: number, out: THREE.Vector3) => THREE.Vector3;
  px: number; py: number; pz: number; running: boolean;
  attract: (species: string) => boolean;
  friends: { x: number; z: number }[];
  emote: (kind: 'hungry' | 'bye', x: number, y: number, z: number, species: string) => void;
}
let agentIds = 0;

class Herd {
  mesh: THREE.InstancedMesh; agents: Agent[] = []; active = 0; pounces = 0; leaps = 0;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(); private s = new THREE.Vector3(1, 1, 1); private v = new THREE.Vector3();
  constructor(public k: Kind, mat: THREE.Material, private rnd: Rnd) {
    this.mesh = new THREE.InstancedMesh(k.geo, mat, k.count);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false;
    const w = new Float32Array(BIOME_COUNT);
    let tries = 0;
    while (this.agents.length < k.count && tries++ < 20000) {
      let x: number, z: number;
      if (k.pond) { const a = rnd() * 6.28, r = Math.sqrt(rnd()) * POND.r; x = POND.x + Math.cos(a) * r; z = POND.z + Math.sin(a) * r; }
      else { const a = rnd() * 6.28, d = Math.sqrt(rnd()) * ISLAND_RADIUS * 1.05; x = Math.cos(a) * d; z = Math.sin(a) * d; }
      if (!this.valid(x, z)) continue;
      if (!k.pond) { biomeWeights(x, z, w); let bw = 0; for (const b of k.biomes) bw += w[b]; if (bw < 0.55) continue; }
      this.agents.push({ x, z, y: 0, yaw: rnd() * 6.28, tx: x, tz: z, state: 0, timer: rnd() * 3, ph: rnd() * 10, hx: x, hz: z, friend: false, slot: 0, hunger: 0, fed: 0, ret: false, vx: 0, vz: 0, joy: 0, id: agentIds++ });
      if (k.colors) this.mesh.setColorAt(this.agents.length - 1, new THREE.Color(k.colors[Math.floor(rnd() * k.colors.length)]));
    }
    this.active = this.agents.length; this.mesh.count = this.active;
  }
  valid(x: number, z: number) {
    const h = heightAt(x, z);
    if (h < this.k.h[0] || h > this.k.h[1]) return false;
    if (this.k.pond) return Math.hypot(x - POND.x, z - POND.z) < POND.r * 1.3;
    return slopeAt(x, z) < (this.k.maxSlope ?? 0.7);
  }
  setQuality(high: boolean) { this.active = Math.floor(this.agents.length * (high ? 1 : this.k.low)); this.mesh.count = this.active; }
  update(dt: number, t: number, c: FollowCtx, blockers: (x: number, z: number) => boolean) {
    const k = this.k, px = c.px, pz = c.pz;
    const tmp = new THREE.Vector3();
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (i >= this.active && !a.friend) { this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0)); continue; }
      let moving = false;
      if (a.friend) {
        // ---- follower: breadcrumb trail target + arrival + separation ----
        a.hunger -= dt;
        if (a.hunger < 0 && a.hunger + dt >= 0) c.emote('hungry', a.x, a.y + 0.9, a.z, k.name);
        if (a.hunger < -60) { a.friend = false; a.ret = true; a.state = 1; a.tx = a.hx; a.tz = a.hz; c.emote('bye', a.x, a.y + 0.9, a.z, k.name); continue; }
        c.trail(1.35 + a.slot * 1.05, tmp);
        let dx = tmp.x - a.x, dz = tmp.z - a.z;
        const d = Math.hypot(dx, dz);
        const maxSp = d > 10 ? 12 : 7.2;
        const sp = Math.min(maxSp, Math.max(0, d - 0.15) * 3.2);
        let ux = d > 0.001 ? (dx / d) * sp : 0, uz = d > 0.001 ? (dz / d) * sp : 0;
        // separation from the player and the other followers
        const pd = Math.hypot(a.x - px, a.z - pz);
        if (pd < 1.0) { ux += ((a.x - px) / (pd || 1)) * (1.0 - pd) * 6; uz += ((a.z - pz) / (pd || 1)) * (1.0 - pd) * 6; }
        for (const f of c.friends) {
          if (f === (a as unknown)) continue;
          const fd = Math.hypot(a.x - f.x, a.z - f.z);
          if (fd > 0.001 && fd < 0.8) { ux += ((a.x - f.x) / fd) * (0.8 - fd) * 5; uz += ((a.z - f.z) / fd) * (0.8 - fd) * 5; }
        }
        const sm = Math.min(1, dt * 6);
        a.vx += (ux - a.vx) * sm; a.vz += (uz - a.vz) * sm;
        const vl = Math.hypot(a.vx, a.vz);
        a.x += a.vx * dt; a.z += a.vz * dt;
        moving = vl > 0.35;
        const want = moving ? Math.atan2(a.vx, a.vz) : Math.atan2(px - a.x, pz - a.z);
        let dy = want - a.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        a.yaw += dy * Math.min(1, dt * (moving ? 10 : 3));
        if (moving) a.ph += dt * Math.min(16, 6 + vl * 1.6);
      } else {
        const dp = Math.hypot(a.x - px, a.z - pz);
        const curious = c.attract(k.name) && dp < 7;
        if (!a.ret && curious) {
          // holding a food it likes: wander over and wait nearby
          if (dp > 2.0 && a.timer <= 0) { const ang = Math.atan2(a.x - px, a.z - pz); a.tx = px + Math.sin(ang) * 1.7; a.tz = pz + Math.cos(ang) * 1.7; a.state = 1; a.timer = 0.6; }
        } else if (!a.ret && dp < k.fleeDist * (c.running ? 1.6 : 1) && a.state !== 2) {
          a.state = 2; a.timer = 2 + this.rnd() * 1.5;
          const ax = (a.x - px) / (dp || 1), az = (a.z - pz) / (dp || 1);
          for (let tries = 0; tries < 8; tries++) {
            const ang = (this.rnd() - 0.5) * 1.6 * (tries / 4 + 0.5), cc = Math.cos(ang), ss = Math.sin(ang);
            const tx = a.x + (ax * cc - az * ss) * 7, tz = a.z + (ax * ss + az * cc) * 7;
            if (this.valid(tx, tz)) { a.tx = tx; a.tz = tz; break; }
          }
        }
        a.timer -= dt;
        if (a.state === 0 && a.timer <= 0) {
          for (let tries = 0; tries < 6; tries++) {
            const ang = this.rnd() * 6.28, r = 1 + this.rnd() * k.homeR;
            const tx = a.hx + Math.cos(ang) * r, tz = a.hz + Math.sin(ang) * r;
            if (this.valid(tx, tz)) { a.tx = tx; a.tz = tz; a.state = 1; break; }
          }
          a.timer = 1 + this.rnd() * 3;
        }
        if (a.state >= 1) {
          const dx = a.tx - a.x, dz = a.tz - a.z, d = Math.hypot(dx, dz);
          const sp = a.state === 2 ? k.flee : a.ret ? k.speed * 1.6 : k.speed;
          if (d < 0.15 || (a.state === 2 && a.timer <= 0)) { a.state = 0; a.timer = 1.5 + this.rnd() * 4; if (a.ret && d < 2) a.ret = false; }
          else {
            const step = Math.min(d, sp * dt);
            const nx = a.x + (dx / d) * step, nz = a.z + (dz / d) * step;
            const free = a.ret || curious ? heightAt(nx, nz) > (k.pond ? -3 : 0.05) : this.valid(nx, nz);
            if (free && !blockers(nx, nz)) { a.x = nx; a.z = nz; moving = true; }
            else { a.state = 0; a.timer = 0.3; }
            let dy = Math.atan2(dx, dz) - a.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
            a.yaw += dy * Math.min(1, dt * 8);
          }
        }
        if (moving) a.ph += dt * (a.state === 2 ? 14 : 9);
        if (curious && !moving) { let dy = Math.atan2(px - a.x, pz - a.z) - a.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); a.yaw += dy * Math.min(1, dt * 4); }
      }
      this.pose(i, a, t, moving);
    }
    this.mesh.count = Math.max(this.active, this.highestFriend() + 1);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** goat ledge hop: shift its perch to a nearby, preferably higher, climbable spot */
  private ledgeHop(a: Agent) {
    let bx = a.x, bz = a.z, bh = heightAt(a.x, a.z) - 0.4;
    for (let tries = 0; tries < 5; tries++) {
      const ang = this.rnd() * 6.28, r = 0.5 + this.rnd() * 0.6, x = a.x + Math.cos(ang) * r, z = a.z + Math.sin(ang) * r;
      if (Math.hypot(x - a.hx, z - a.hz) > this.k.homeR || !this.valid(x, z)) continue;
      const hh = heightAt(x, z) + this.rnd() * 0.6;
      if (hh > bh) { bh = hh; bx = x; bz = z; }
    }
    a.yaw = Math.atan2(bx - a.x, bz - a.z) || a.yaw; a.x = bx; a.z = bz;
  }

  private highestFriend() { let h = -1; this.agents.forEach((a, i) => { if (a.friend) h = i; }); return h; }

  private pose(i: number, a: Agent, t: number, moving: boolean) {
    const k = this.k;
    const h = heightAt(a.x, a.z);
    const inWater = h < 0.02;
    let y = Math.max(h, k.anim === 'swim' || inWater ? 0.02 : h), pitch = 0, roll = 0, yaw = a.yaw;
    const anim = k.anim === 'swim' && !inWater ? 'waddle' : k.anim;
    if (anim === 'hop') { y = h + (moving ? Math.abs(Math.sin(a.ph)) * 0.22 : 0); pitch = moving ? -Math.cos(a.ph) * 0.2 : Math.sin(t * 3 + a.ph) * 0.03; }
    else if (anim === 'walk') { y = h + (moving ? Math.abs(Math.sin(a.ph)) * 0.04 : 0); pitch = moving ? 0 : a.friend ? 0 : Math.max(0, Math.sin(t * 0.5 + a.ph)) * 0.35; }
    else if (anim === 'pounce') {
      // fox: trots when moving; idle = crouch, wiggle, then a big arcing pounce into the leaves
      y = h + (moving ? Math.abs(Math.sin(a.ph)) * 0.05 : 0);
      if (!moving && !a.friend) {
        const c = (t * 0.28 + a.ph * 0.137) % 1;
        if (c > 0.84) { const u = (c - 0.84) / 0.16; y += Math.sin(u * Math.PI) * 0.5; pitch = (u - 0.45) * 1.1; if ((a.pc ?? 0) <= 0.84) this.pounces++; }
        else if (c > 0.7) { y -= 0.05; pitch = -0.12; roll = Math.sin(t * 30) * 0.05; }
        a.pc = c;
      }
    }
    else if (anim === 'leap') {
      // goat: sure-footed bounce on the climb; idle = graze, then a springy ledge hop to a new perch
      const climb = moving ? Math.min(1, slopeAt(a.x, a.z) * 1.2) : 0;
      y = h + (moving ? Math.abs(Math.sin(a.ph)) * (0.05 + climb * 0.3) : 0);
      pitch = moving ? -climb * 0.25 : 0;
      if (!moving && !a.friend) {
        const c = (t * 0.22 + a.ph * 0.173) % 1;
        if (c > 0.86) { const u = (c - 0.86) / 0.14; y += Math.sin(u * Math.PI) * 0.7; pitch = (u - 0.5) * -0.8; if ((a.pc ?? 0) <= 0.86) { this.leaps++; this.ledgeHop(a); } }
        else if (c < 0.55) pitch = Math.max(0, Math.sin(t * 0.7 + a.ph)) * 0.45; // head down, grazing
        a.pc = c;
      }
    }
    else if (anim === 'swim') { y = 0.02 + Math.sin(t * 2 + a.ph) * 0.025; roll = Math.sin(t * 1.5 + a.ph) * 0.06; }
    else if (anim === 'waddle') { y = h; roll = moving ? Math.sin(a.ph * 1.2) * 0.22 : 0; }
    else if (anim === 'scuttle') { y = h; yaw = a.yaw + Math.PI / 2; roll = moving ? Math.sin(a.ph * 2) * 0.1 : 0; }
    // happy hop after being fed
    if (a.joy > 0) { a.joy = Math.max(0, a.joy - 1 / 60); y += Math.abs(Math.sin(a.joy * 14)) * 0.3 * a.joy; }
    a.y = y;
    this.v.set(a.x, y, a.z);
    this.q.setFromEuler(this.e.set(pitch, yaw, roll, 'YXZ'));
    this.mesh.setMatrixAt(i, this.m.compose(this.v, this.q, this.s));
  }
}

// ---------- fish (+ jumps with splash rings) ----------
class School {
  mesh: THREE.InstancedMesh; active: number;
  fish: { hx: number; hz: number; r: number; ang: number; sp: number; jump: number; next: number; ph: number; pond: boolean }[] = [];
  rings: { mesh: THREE.Mesh; t: number }[] = [];
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(); private s = new THREE.Vector3(1, 1, 1); private v = new THREE.Vector3();
  onSplash: (x: number, z: number, big: boolean) => void = () => {};
  constructor(group: THREE.Group, mat: THREE.Material, rnd: Rnd, count: number) {
    const cols = ['#ff9a3e', '#ffcf4d', '#5fb8ff', '#ff6b6b'];
    this.mesh = new THREE.InstancedMesh(fishGeo('#ffffff'), mat, count);
    this.mesh.frustumCulled = false;
    let tries = 0;
    while (this.fish.length < count && tries++ < 20000) {
      const pond = this.fish.length < count * 0.3;
      let x: number, z: number;
      if (pond) { const a = rnd() * 6.28, r = Math.sqrt(rnd()) * POND.r * 0.8; x = POND.x + Math.cos(a) * r; z = POND.z + Math.sin(a) * r; }
      else { const a = rnd() * 6.28, d = ISLAND_RADIUS * (0.85 + rnd() * 0.35); x = Math.cos(a) * d; z = Math.sin(a) * d; }
      const h = heightAt(x, z);
      if (h > -0.7 || h < -3.2) continue;
      this.fish.push({ hx: x, hz: z, r: 1 + rnd() * 2.5, ang: rnd() * 6.28, sp: (0.3 + rnd() * 0.4) * (rnd() < 0.5 ? 1 : -1), jump: -1, next: 3 + rnd() * 15, ph: rnd() * 10, pond });
      this.mesh.setColorAt(this.fish.length - 1, new THREE.Color(cols[Math.floor(rnd() * cols.length)]));
    }
    this.active = this.fish.length; this.mesh.count = this.active;
    group.add(this.mesh);
    for (let i = 0; i < 6; i++) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicNodeMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }));
      ring.visible = false; ring.renderOrder = 3;
      group.add(ring); this.rings.push({ mesh: ring, t: 1 });
    }
  }
  private splash(x: number, z: number, big: boolean) {
    const r = this.rings.find((r) => r.t >= 1) ?? this.rings[0];
    r.t = 0; r.mesh.position.set(x, 0.06, z); r.mesh.visible = true; r.mesh.userData.big = big;
    this.onSplash(x, z, big);
  }
  setQuality(high: boolean) { this.active = Math.floor(this.fish.length * (high ? 1 : 0.5)); this.mesh.count = this.active; }
  update(dt: number, rnd: Rnd) {
    for (let i = 0; i < this.active; i++) {
      const f = this.fish[i];
      f.ang += f.sp * dt; f.ph += dt * 8;
      const x = f.hx + Math.cos(f.ang) * f.r, z = f.hz + Math.sin(f.ang) * f.r;
      const yaw = Math.atan2(-Math.sin(f.ang) * Math.sign(f.sp), Math.cos(f.ang) * Math.sign(f.sp)) + Math.sin(f.ph) * 0.15;
      let y = -0.35, pitch = 0;
      f.next -= dt;
      if (f.jump < 0 && f.next <= 0) { f.jump = 0; this.splash(x, z, false); }
      if (f.jump >= 0) {
        f.jump += dt / 0.85;
        const j = f.jump;
        y = -0.3 + Math.sin(Math.PI * Math.min(1, j)) * 1.0;
        pitch = (j - 0.5) * 2.4;
        if (j >= 1) { f.jump = -1; f.next = 6 + rnd() * 18; this.splash(x, z, true); }
      }
      this.v.set(x, y, z);
      this.q.setFromEuler(this.e.set(pitch, yaw, 0, 'YXZ'));
      this.mesh.setMatrixAt(i, this.m.compose(this.v, this.q, this.s));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    for (const r of this.rings) {
      if (r.t >= 1) continue;
      r.t += dt / 1.2;
      const sc = 0.15 + r.t * (r.mesh.userData.big ? 0.9 : 0.6);
      r.mesh.scale.setScalar(sc);
      (r.mesh.material as THREE.MeshBasicNodeMaterial).opacity = (1 - r.t) * 0.7;
      if (r.t >= 1) r.mesh.visible = false;
    }
  }
}

// ---------- winged things (butterflies, birds): body + two hinged wings, all instanced ----------
class Flyers {
  body: THREE.InstancedMesh; lw: THREE.InstancedMesh; rw: THREE.InstancedMesh; active: number;
  private M = new THREE.Matrix4(); private W = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(); private one = new THREE.Vector3(1, 1, 1); private v = new THREE.Vector3();
  constructor(bodyGeo: THREE.BufferGeometry, wingGeo: THREE.BufferGeometry, mat: THREE.Material, wingMat: THREE.Material, public count: number, colors: string[], rnd: Rnd, shadows: boolean) {
    const lgeo = wingGeo.clone(); lgeo.scale(-1, 1, 1);
    this.body = new THREE.InstancedMesh(bodyGeo, mat, count);
    this.lw = new THREE.InstancedMesh(lgeo, wingMat, count);
    this.rw = new THREE.InstancedMesh(wingGeo, wingMat, count);
    for (const m of [this.body, this.lw, this.rw]) { m.frustumCulled = false; m.castShadow = shadows; }
    for (let i = 0; i < count; i++) {
      const c = new THREE.Color(colors[Math.floor(rnd() * colors.length)]);
      this.lw.setColorAt(i, c); this.rw.setColorAt(i, c); this.body.setColorAt(i, c.clone().lerp(new THREE.Color('#ffffff'), 0.2));
    }
    this.active = count;
  }
  set(i: number, pos: THREE.Vector3, yaw: number, pitch: number, flap: number, scale: number, wingX: number) {
    this.q.setFromEuler(this.e.set(pitch, yaw, 0, 'YXZ'));
    this.M.compose(pos, this.q, this.v.set(scale, scale, scale));
    this.body.setMatrixAt(i, this.M);
    this.q.setFromEuler(this.e.set(0, 0, flap));
    this.W.compose(this.v.set(wingX, 0, 0), this.q, this.one).premultiply(this.M);
    this.rw.setMatrixAt(i, this.W);
    this.q.setFromEuler(this.e.set(0, 0, -flap));
    this.W.compose(this.v.set(-wingX, 0, 0), this.q, this.one).premultiply(this.M);
    this.lw.setMatrixAt(i, this.W);
  }
  setActive(n: number) { this.active = n; this.body.count = this.lw.count = this.rw.count = n; }
  commit() { this.body.instanceMatrix.needsUpdate = this.lw.instanceMatrix.needsUpdate = this.rw.instanceMatrix.needsUpdate = true; }
}

interface Bird { friend: boolean; slot: number; hunger: number; fed: number; joy: number; id: number; ret: boolean; x: number; y: number; z: number; yaw: number; pitch: number; state: 0 | 1 | 2 | 3; cx: number; cz: number; R: number; alt: number; ang: number; w: number; tx: number; tz: number; timer: number; ph: number; }
interface Fly { x: number; y: number; z: number; yaw: number; hx: number; hy: number; hz: number; ph: number; spook: number; }

export class Fauna {
  group = new THREE.Group();
  herds: Herd[] = [];
  school: School;
  birds: Flyers; birdState: Bird[] = [];
  flies: Flyers; flyState: Fly[] = [];
  private rnd = mulberry32(2024);
  private flowerSpots: THREE.Vector3[];
  private high = true;
  blockers: (x: number, z: number) => boolean = () => false;
  static readonly MAX_FRIENDS = 6;

  /** All befriended animals, in follow order. */
  friends(): FriendRef[] {
    const out: FriendRef[] = [];
    for (const h of this.herds) for (const a of h.agents) if (a.friend) out.push({ species: h.k.name, a });
    for (const b of this.birdState) if (b.friend) out.push({ species: 'bird', a: b });
    return out.sort((p, q) => p.a.slot - q.a.slot);
  }
  private reslot() { this.friends().forEach((f, i) => { f.a.slot = i; }); }

  /** Nearest animal that could be fed right now (not a happy follower). */
  nearestFeedable(px: number, pz: number, maxD: number): (FriendRef & { d: number }) | null {
    let best: (FriendRef & { d: number }) | null = null;
    const consider = (species: string, a: Agent | Bird) => {
      if (a.friend && a.hunger > 0) return;
      const d = Math.hypot(a.x - px, a.z - pz);
      if (d < maxD && (!best || d < best.d)) best = { species, a, d };
    };
    for (const h of this.herds) h.agents.forEach((a, i) => { if (i < h.active || a.friend) consider(h.k.name, a); });
    for (let i = 0; i < this.birds.active; i++) { const b = this.birdState[i]; if (b.state === 2 || b.friend) consider('bird', b); }
    return best;
  }

  /** Feed an animal. Favourite food befriends at once; liked food needs two. */
  feed(ref: FriendRef, fav: boolean): 'friend' | 'more' | 'refill' {
    const a = ref.a;
    a.joy = 1;
    if (a.friend) { a.hunger = 280 + this.rnd() * 80; return 'refill'; }
    a.fed += fav ? 1 : 0.5;
    if (a.fed < 0.99) return 'more';
    a.friend = true; a.fed = 0; a.ret = false; a.hunger = 280 + this.rnd() * 80; a.slot = 99;
    if ('vx' in a) { a.vx = 0; a.vz = 0; }
    this.reslot();
    return 'friend';
  }
  dismiss(ref: FriendRef) {
    const a = ref.a; a.friend = false; a.ret = true;
    if ('tx' in a && 'hx' in a) { (a as Agent).state = 1; (a as Agent).tx = (a as Agent).hx; (a as Agent).tz = (a as Agent).hz; }
    if (ref.species === 'bird') (a as Bird).state = 3;
    this.reslot();
  }
  friendCount() { return this.friends().length; }
  /** stable id for saving (agent ids are deterministic: seeded spawn order) */
  keyOf(ref: FriendRef) { return `${ref.species}:${ref.a.id}`; }
  byKey(key: string): FriendRef | null {
    const [sp, idS] = key.split(':'); const id = +idS;
    if (sp === 'bird') { const b = this.birdState.find((q) => q.id === id); return b ? { species: 'bird', a: b } : null; }
    for (const h of this.herds) if (h.k.name === sp) { const a = h.agents.find((q) => q.id === id); if (a) return { species: sp, a }; }
    return null;
  }
  /** coat colour of this animal (instanced colour), if it has one */
  colorOf(ref: FriendRef): string | null {
    const c = new THREE.Color();
    if (ref.species === 'bird') { const i = this.birdState.indexOf(ref.a as Bird); if (i < 0 || !this.birds.lw.instanceColor) return null; this.birds.lw.getColorAt(i, c); return '#' + c.getHexString(); }
    for (const h of this.herds) if (h.k.name === ref.species) { const i = h.agents.indexOf(ref.a as Agent); if (i < 0 || !h.mesh.instanceColor) return null; h.mesh.getColorAt(i, c); return '#' + c.getHexString(); }
    return null;
  }
  /** restore a saved follower next to the player */
  befriend(ref: FriendRef, hunger: number, x: number, z: number) {
    const a = ref.a;
    if (a.friend || this.friendCount() >= Fauna.MAX_FRIENDS) return;
    a.friend = true; a.fed = 0; a.ret = false; a.hunger = hunger; a.slot = 99; a.x = x; a.z = z;
    if ('vx' in a) { a.vx = 0; a.vz = 0; (a as Agent).tx = x; (a as Agent).tz = z; }
    if (ref.species === 'bird') { (a as Bird).state = 2; (a as Bird).y = heightAt(x, z) + 2; }
    this.reslot();
  }

  constructor(flowerSpots: THREE.Vector3[]) {
    this.flowerSpots = flowerSpots;
    const rnd = this.rnd;
    const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, flatShading: true, roughness: 0.75 });
    const kinds: Kind[] = [
      { name: 'bunny', geo: bunnyGeo('#ffffff'), count: 10, low: 0.5, biomes: [Biome.Meadow, Biome.Alpine], h: [0.8, 9], speed: 1.6, flee: 5, fleeDist: 3.5, anim: 'hop', homeR: 6, colors: ['#f4f0e8', '#c9a27a', '#a88a6a', '#e8dccb'] },
      { name: 'deer', geo: deerGeo(), count: 5, low: 0.6, biomes: [Biome.Autumn, Biome.Meadow], h: [0.9, 9], speed: 1.1, flee: 5.5, fleeDist: 6, anim: 'walk', homeR: 8 },
      { name: 'duck', geo: duckGeo(), count: 6, low: 0.5, biomes: [Biome.Marsh], h: [-3, -0.25], speed: 0.6, flee: 1.6, fleeDist: 3.5, anim: 'swim', homeR: 3, pond: true },
      { name: 'crab', geo: crabGeo(), count: 12, low: 0.5, biomes: [Biome.Tropical, Biome.Meadow, Biome.Desert], h: [0.05, 0.8], speed: 0.7, flee: 2.6, fleeDist: 2.5, anim: 'scuttle', homeR: 3 },
    ];
    for (const k of kinds) { const h = new Herd(k, mat, rnd); this.herds.push(h); this.group.add(h.mesh); }
    this.school = new School(this.group, mat, rnd, 22);

    // Birds
    const birdBody = new Baker().add(sph(0.12), '#ffffff', [0, 0, 0], [0, 0, 0], [0.8, 0.75, 1.7])
      .add(sph(0.08), '#ffffff', [0, 0.06, 0.2]).add(cone(0.03, 0.08), '#ffb02e', [0, 0.05, 0.3], [Math.PI / 2, 0, 0])
      .add(cone(0.07, 0.16), '#ffffff', [0, 0, -0.24], [-Math.PI / 2, 0, 0], [1, 1, 0.3]).build();
    const birdWing = new THREE.PlaneGeometry(0.42, 0.2); birdWing.rotateX(-Math.PI / 2); birdWing.translate(0.21, 0, 0);
    const wingMat = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 0.8, flatShading: true });
    this.birds = new Flyers(birdBody, birdWing, mat, wingMat, 16, ['#f4f4f0', '#5a8fd8', '#e05a4a', '#f2c84a', '#8a6a4a', '#f4f4f0'], rnd, true);
    this.group.add(this.birds.body, this.birds.lw, this.birds.rw);
    for (let i = 0; i < 16; i++) {
      const a = rnd() * 6.28, d = rnd() * 30;
      this.birdState.push({ friend: false, slot: 0, hunger: 0, fed: 0, joy: 0, id: agentIds++, ret: false, x: 0, y: 20, z: 0, yaw: 0, pitch: 0, state: 0, cx: Math.cos(a) * d, cz: Math.sin(a) * d, R: 8 + rnd() * 18, alt: 14 + rnd() * 12, ang: rnd() * 6.28, w: (0.25 + rnd() * 0.25) * (rnd() < 0.5 ? 1 : -1), tx: 0, tz: 0, timer: 5 + rnd() * 25, ph: rnd() * 10 });
    }
    // Butterflies
    const flyBody = new Baker().add(new THREE.CapsuleGeometry(0.012, 0.08, 2, 4), '#3a2f2a', [0, 0, 0], [Math.PI / 2, 0, 0]).build();
    const flyWing = new THREE.CircleGeometry(0.085, 6); flyWing.rotateX(-Math.PI / 2); flyWing.translate(0.075, 0, 0.01);
    const flyWingMat = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 0.6, emissive: '#222222' });
    this.flies = new Flyers(flyBody, flyWing, mat, flyWingMat, 34, ['#ffb02e', '#7fc8ff', '#ffffff', '#ff7eb6', '#ffe14d', '#b98cff'], rnd, false);
    this.group.add(this.flies.body, this.flies.lw, this.flies.rw);
    for (let i = 0; i < 34; i++) this.flyState.push({ x: 0, y: -50, z: 0, yaw: 0, hx: 0, hy: -50, hz: 0, ph: rnd() * 10, spook: 0 });
    // Foxes in Autumn Grove: added last with their own seed so every other animal's spawn + saved ids stay the same
    const fox: Kind = { name: 'fox', geo: foxGeo(), count: 4, low: 0.75, biomes: [Biome.Autumn], h: [0.9, 9], speed: 1.5, flee: 5.2, fleeDist: 4.5, anim: 'pounce', homeR: 7 };
    const fh = new Herd(fox, mat, mulberry32(4207)); this.herds.push(fh); this.group.add(fh.mesh);
    // Mountain goats on Alpine Peak (Order 38): appended after the foxes so existing ids stay stable
    const goat: Kind = { name: 'goat', geo: goatGeo(), count: 5, low: 0.6, biomes: [Biome.Alpine], h: [3, 60], speed: 1.3, flee: 4.6, fleeDist: 4, anim: 'leap', homeR: 8, maxSlope: 1.6 };
    const gh = new Herd(goat, mat, mulberry32(5309)); this.herds.push(gh); this.group.add(gh.mesh);
  }

  setQuality(high: boolean) {
    this.high = high;
    for (const h of this.herds) h.setQuality(high);
    this.school.setQuality(high);
    this.birds.setActive(high ? 16 : 8);
    this.flies.setActive(high ? 34 : 14);
  }

  private relocateFly(f: Fly, px: number, pz: number) {
    const w = new Float32Array(BIOME_COUNT);
    for (let tries = 0; tries < 12; tries++) {
      const s = this.flowerSpots[Math.floor(this.rnd() * this.flowerSpots.length)];
      if (!s) return;
      const d = Math.hypot(s.x - px, s.z - pz);
      if (d > 30 || d < 3) continue;
      biomeWeights(s.x, s.z, w);
      if (w[Biome.Alpine] > 0.5 || w[Biome.Desert] > 0.6) continue;
      f.hx = s.x + (this.rnd() - 0.5) * 2; f.hz = s.z + (this.rnd() - 0.5) * 2; f.hy = s.y + 0.5 + this.rnd() * 0.8;
      f.x = f.hx; f.y = f.hy; f.z = f.hz;
      return;
    }
  }

  update(dt: number, t: number, ctx: FollowCtx) {
    const px = ctx.px, pz = ctx.pz;
    ctx.friends = this.friends().map((f) => f.a);
    const before = ctx.friends.length;
    for (const h of this.herds) h.update(dt, t, ctx, this.blockers);
    const tmp = new THREE.Vector3();
    this.school.update(dt, this.rnd);
    const v = new THREE.Vector3();

    // birds: 0 circle, 1 descend, 2 ground, 3 takeoff
    for (let i = 0; i < this.birds.active; i++) {
      const b = this.birdState[i];
      b.ph += dt * 12;
      let flap = Math.sin(b.ph) * 0.9;
      if (b.friend) {
        // befriended bird: flutters along the trail at shoulder height
        b.hunger -= dt;
        if (b.hunger < 0 && b.hunger + dt >= 0) ctx.emote('hungry', b.x, b.y + 0.4, b.z, 'bird');
        if (b.hunger < -60) { b.friend = false; b.state = 3; ctx.emote('bye', b.x, b.y + 0.4, b.z, 'bird'); }
        ctx.trail(1.2 + b.slot * 1.05, tmp);
        const ty = heightAt(tmp.x, tmp.z) + 1.7 + Math.sin(t * 2.2 + b.ph * 0.01) * 0.25 + (b.joy > 0 ? (b.joy -= dt, b.joy * 0.6) : 0);
        const dx = tmp.x - b.x, dz = tmp.z - b.z;
        b.x += dx * Math.min(1, dt * 3); b.z += dz * Math.min(1, dt * 3); b.y += (ty - b.y) * Math.min(1, dt * 3);
        const want = Math.hypot(dx, dz) > 0.3 ? Math.atan2(dx, dz) : Math.atan2(px - b.x, pz - b.z);
        let dy = want - b.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); b.yaw += dy * Math.min(1, dt * 5);
        b.pitch = 0; flap = Math.sin(b.ph * 1.4) * 1.0;
      } else if (b.state === 0) {
        b.ang += b.w * dt;
        const tx = b.cx + Math.cos(b.ang) * b.R, tz = b.cz + Math.sin(b.ang) * b.R;
        const ty = b.alt + Math.sin(b.ang * 2) * 1.5;
        const dx = tx - b.x, dz = tz - b.z;
        b.x += dx * Math.min(1, dt * 1.5); b.z += dz * Math.min(1, dt * 1.5); b.y += (ty - b.y) * Math.min(1, dt);
        if (Math.hypot(dx, dz) > 0.01) b.yaw = Math.atan2(dx, dz);
        b.pitch = 0;
        if (Math.sin(b.ph * 0.07) > 0.6) flap = 0.15; // glide
        b.timer -= dt;
        if (b.timer <= 0) {
          // pick a landing spot on open grass not too close to the player
          for (let k = 0; k < 10; k++) {
            const a = this.rnd() * 6.28, d = 6 + this.rnd() * 14;
            const lx = b.x + Math.cos(a) * d, lz = b.z + Math.sin(a) * d, lh = heightAt(lx, lz);
            if (lh > 0.8 && lh < 8 && slopeAt(lx, lz) < 0.4 && Math.hypot(lx - px, lz - pz) > 8) { b.tx = lx; b.tz = lz; b.state = 1; break; }
          }
          b.timer = 10 + this.rnd() * 20;
        }
      } else if (b.state === 1) {
        const gy = heightAt(b.tx, b.tz);
        v.set(b.tx - b.x, gy - b.y, b.tz - b.z);
        const d = v.length();
        if (d < 0.2) { b.state = 2; b.timer = 5 + this.rnd() * 10; b.y = gy; }
        else {
          v.multiplyScalar(Math.min(d, 7 * dt) / d);
          b.x += v.x; b.y += v.y; b.z += v.z;
          b.yaw = Math.atan2(b.tx - b.x, b.tz - b.z); b.pitch = 0.3;
          if (d < 2) flap = Math.sin(b.ph * 1.5) * 1.1;
        }
      } else if (b.state === 2) {
        const gy = heightAt(b.x, b.z);
        const hop = Math.max(0, Math.sin(t * 5 + b.ph * 0.1));
        b.y = gy + (hop > 0.95 ? 0.06 : 0) + 0.06;
        b.pitch = Math.sin(t * 3 + i) > 0.7 ? 0.6 : 0; // peck
        flap = -1.25; // wings folded
        b.timer -= dt;
        if (Math.hypot(b.x - px, b.z - pz) < (ctx.attract('bird') ? 1.2 : 6)) { b.state = 3; b.timer = 0; }
        else if (b.timer <= 0) b.state = 3;
      } else {
        b.y += dt * 5; b.pitch = -0.5;
        const away = Math.atan2(b.x - px, b.z - pz);
        b.x += Math.sin(away) * dt * 4; b.z += Math.cos(away) * dt * 4; b.yaw = away;
        flap = Math.sin(b.ph * 1.6) * 1.1;
        if (b.y > b.alt - 2) { b.state = 0; b.ang = Math.atan2(b.z - b.cz, b.x - b.cx); }
      }
      this.birds.set(i, v.set(b.x, b.y, b.z), b.yaw, b.pitch, flap, 1, 0.08);
    }
    this.birds.commit();

    // butterflies: flutter around a flower spot near the player, dart away when approached
    for (let i = 0; i < this.flies.active; i++) {
      const f = this.flyState[i];
      if (f.hy < -10 || Math.hypot(f.hx - px, f.hz - pz) > 38) this.relocateFly(f, px, pz);
      f.ph += dt;
      const dp = Math.hypot(f.x - px, f.z - pz);
      if (dp < 2.2) f.spook = 1.5;
      f.spook = Math.max(0, f.spook - dt);
      const nx = f.hx + Math.sin(f.ph * 0.9 + i) * 1.2 + Math.sin(f.ph * 2.3) * 0.3;
      const nz = f.hz + Math.cos(f.ph * 0.7 + i * 2) * 1.2;
      let ny = f.hy + Math.sin(f.ph * 1.7 + i) * 0.35 + Math.abs(Math.sin(f.ph * 6)) * 0.08;
      if (f.spook > 0) { const a = Math.atan2(f.x - px, f.z - pz); f.hx += Math.sin(a) * dt * 2.5; f.hz += Math.cos(a) * dt * 2.5; ny += f.spook * 0.8; }
      const dx = nx - f.x, dz = nz - f.z;
      f.x += dx * Math.min(1, dt * 3); f.z += dz * Math.min(1, dt * 3); f.y += (ny - f.y) * Math.min(1, dt * 3);
      if (Math.abs(dx) + Math.abs(dz) > 0.001) f.yaw = Math.atan2(dx, dz);
      const flap = 0.2 + Math.abs(Math.sin(t * 16 + i * 1.7)) * 1.1;
      this.flies.set(i, v.set(f.x, f.y, f.z), f.yaw, 0, flap, this.high ? 1 : 1.1, 0.0);
    }
    this.flies.commit();
    if (this.friends().length !== before) this.reslot();
  }
}

export interface FriendRef { species: string; a: Agent | Bird; }
