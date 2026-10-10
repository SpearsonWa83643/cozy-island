import * as THREE from 'three/webgpu';
import { attribute, time, sin, vec3, float } from 'three/tsl';
import { heightAt, slopeAt } from './Terrain';
import { Noise2D } from './noise';
import { mulberry32 } from './noise';
import { Baker } from './Baker';
import type { Physics } from '../core/Physics';
import type { FoodId } from '../game/Items';

/**
 * The cave: a rocky arch on the hillside between the alpine peak and the desert, leading (via a soft fade)
 * into a self-contained underground basin ~45 m below. The interior is a floor heightfield whose rim rises into
 * walls, plus a ceiling heightfield; light is baked into vertex "glow" from crystals and mushrooms (no real point
 * lights → cheap on iPad). Bats, glowing pool fish, beetles and a friendly mole live inside; bats also circle the
 * entrance outside. Only one side is ever drawn (Game hides the island while you're underground).
 */
const n2 = new Noise2D(911);
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const A = 19, B = 12;             // chamber half-axes (m)
const T0 = -19, T1 = -28, TR = 3; // tunnel along local -x
const POOL = { x: 9, z: 3, r: 4.3 };
const X0 = -32, X1 = 23, Z0 = -15, Z1 = 15, STEP = 0.75;
const CRYSTAL_COLS = ['#5ff0ff', '#c38cff', '#ffb35a'];

export interface Bat { x: number; y: number; z: number; hx: number; hy: number; hz: number; st: 0 | 1; t: number; ph: number; r: number; }

export class Cave {
  outside = new THREE.Group();
  interior = new THREE.Group();
  /** world point of the arch opening, and its outward (downhill) direction */
  mouth = new THREE.Vector3(); dir = new THREE.Vector3();
  /** interior origin (world) */
  O = new THREE.Vector3();
  inside = false;
  floorMesh!: THREE.Mesh;
  itemSpots: { id: FoodId; x: number; y: number; z: number }[] = [];
  mole = { x: 0, z: 0, y: 0, up: 0, look: 0, joy: 0, fed: 0 };
  bats: Bat[] = [];
  private batMesh!: THREE.InstancedMesh; private outBats!: THREE.InstancedMesh; private fish!: THREE.InstancedMesh; private beetles!: THREE.InstancedMesh;
  private beetleS: { x: number; z: number; a: number; t: number }[] = [];
  private moleObj = new THREE.Group(); private moleBody = new THREE.Group();
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(); private s = new THREE.Vector3(); private v = new THREE.Vector3();
  private lights: { x: number; y: number; z: number; c: THREE.Color; i: number }[] = [];
  high = true;
  stats = { stalactites: 0, crystals: 0 };

  constructor(physics: Physics) {
    this.findMouth();
    this.O.set(this.mouth.x, -46, this.mouth.z);
    this.buildEntrance(physics);
    this.buildInterior(physics);
    this.interior.visible = false;
  }

  // ---------- shape ----------
  /** 0 = centre of the walkable space, 1 = the wall */
  shape(lx: number, lz: number) {
    const ell = Math.hypot(lx / A, lz / B);
    const tx = Math.min(T0, Math.max(T1, lx));
    const tun = Math.hypot(lx - tx, lz) / TR * (lx < T1 ? 1.6 : 1) + 0.0;
    return Math.min(ell, tun);
  }
  private floorL(lx: number, lz: number) {
    const e = this.shape(lx, lz);
    const bumps = n2.fbm(lx * 0.18, lz * 0.18, 3) * 0.35;
    const dp = Math.hypot(lx - POOL.x, lz - POOL.z) / POOL.r;
    const pool = 1.5 * smooth(1, 0.35, dp);
    return bumps - pool + smooth(0.78, 1.08, e) * 10;
  }
  private ceilL(lx: number, lz: number) {
    const ell = Math.hypot(lx / A, lz / B);
    return 2.9 + 5.2 * Math.pow(Math.max(0, 1 - ell), 0.55) + n2.fbm(lx * 0.25 + 30, lz * 0.25, 3) * 0.9;
  }
  /** world-space floor height inside the cave */
  floorAt(x: number, z: number) { return this.O.y + this.floorL(x - this.O.x, z - this.O.z); }
  ceilAt(x: number, z: number) { return this.O.y + this.ceilL(x - this.O.x, z - this.O.z); }
  shapeAt(x: number, z: number) { return this.shape(x - this.O.x, z - this.O.z); }
  /** inside-cave spawn (coming in) and the exit trigger at the tunnel's end */
  get entry() { return { x: this.O.x + T1 + 4.2, z: this.O.z, facing: Math.PI / 2 }; }
  get exitPt() { return { x: this.O.x + T1 + 0.3, z: this.O.z }; }
  /** where you stand outside after leaving */
  get outsideSpot() { return { x: this.mouth.x + this.dir.x * 3.4, z: this.mouth.z + this.dir.z * 3.4, facing: Math.atan2(this.dir.x, this.dir.z) }; }
  /** the trigger just inside the arch */
  get doorPt() { return { x: this.mouth.x + this.dir.x * 0.5, z: this.mouth.z + this.dir.z * 0.5 }; }

  private findMouth() {
    // hillside between the alpine peak (north) and the desert (west), facing downhill
    const tx = -27, tz = -21;
    let best: { x: number; z: number; s: number } | null = null;
    for (let r = 0; r < 18; r += 0.75) for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2, x = tx + Math.cos(a) * r, z = tz + Math.sin(a) * r;
      const h = heightAt(x, z), sl = slopeAt(x, z);
      if (h < 2.6 || h > 7.5 || sl < 0.3 || sl > 1.0) continue;
      // need flat-ish standable ground 3 m downhill
      const g = this.grad(x, z), ox = x - g.x * 3.4, oz = z - g.z * 3.4;
      if (heightAt(ox, oz) < 1 || slopeAt(ox, oz) > 0.55) continue;
      const score = r + Math.abs(sl - 0.55) * 6;
      if (!best || score < best.s) best = { x, z, s: score };
    }
    const p = best ?? { x: tx, z: tz };
    const g = this.grad(p.x, p.z);
    this.mouth.set(p.x, heightAt(p.x, p.z), p.z);
    this.dir.set(-g.x, 0, -g.z).normalize(); // outward = downhill
  }
  private grad(x: number, z: number) {
    const d = 0.8, gx = heightAt(x + d, z) - heightAt(x - d, z), gz = heightAt(x, z + d) - heightAt(x, z - d);
    const l = Math.hypot(gx, gz) || 1; return { x: gx / l, z: gz / l }; // uphill
  }

  // ---------- entrance ----------
  private buildEntrance(physics: Physics) {
    const rnd = mulberry32(5150), M = this.mouth, D = this.dir, R = new THREE.Vector3(D.z, 0, -D.x);
    const rockMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
    const b = new Baker();
    const put = (off: THREE.Vector3, r: number, col: string, sc: [number, number, number] = [1, 1, 1], solid = true) => {
      const p = M.clone().add(off);
      b.add(new THREE.DodecahedronGeometry(r, 0), col, [p.x - M.x, p.y - M.y, p.z - M.z], [rnd() * 3, rnd() * 3, rnd() * 3], sc);
      if (solid) physics.addBall(p.x, p.y, p.z, r * Math.min(...sc) * 0.9);
    };
    const at = (side: number, up: number, out: number) => R.clone().multiplyScalar(side).add(new THREE.Vector3(0, up, 0)).addScaledVector(D, out);
    // pillars + lintel framing a ~2.2 m opening
    for (const s of [-1, 1]) { put(at(s * 1.75, 0.6, 0), 1.0, '#7a706a', [1, 1.3, 1]); put(at(s * 1.6, 1.9, -0.2), 0.85, '#8a807a'); put(at(s * 2.6, 0.4, -0.6), 1.1, '#6a625e'); }
    put(at(0, 3.0, -0.3), 1.2, '#8a807a', [1.6, 0.8, 1], true); put(at(-0.9, 2.9, -0.1), 0.7, '#7a706a', [1, 1, 1], false); put(at(1.0, 2.8, -0.2), 0.75, '#6a625e', [1, 1, 1], false);
    put(at(0, 2.2, -1.6), 1.6, '#5e5652', [1.4, 1, 1], false);
    for (let i = 0; i < 6; i++) put(at((rnd() - 0.5) * 6, 0.05, 0.6 + rnd() * 1.8), 0.18 + rnd() * 0.25, '#8a807a', [1, 0.7, 1], false);
    const rocks = new THREE.Mesh(b.build(), rockMat); rocks.position.copy(M); rocks.castShadow = rocks.receiveShadow = true;
    // the dark opening: a soft radial "void" that fades at the edges
    const vg = new THREE.CircleGeometry(1.25, 24); const cols: number[] = []; const pa = vg.attributes.position;
    for (let i = 0; i < pa.count; i++) { const r = Math.hypot(pa.getX(i), pa.getY(i)) / 1.25; const c = new THREE.Color('#08060c').lerp(new THREE.Color('#2a2430'), r * r); cols.push(c.r, c.g, c.b); }
    vg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); vg.scale(1, 1.15, 1);
    const voidM = new THREE.Mesh(vg, new THREE.MeshBasicNodeMaterial({ vertexColors: true, fog: false }));
    voidM.position.copy(M).addScaledVector(D, -0.25).add(new THREE.Vector3(0, 1.25, 0)); voidM.lookAt(voidM.position.clone().add(D));
    // glowing crystals at the threshold + a lantern post
    const cb = new Baker(); cb.ao = false;
    for (let i = 0; i < 7; i++) { const s = (i % 2 ? 1 : -1) * (1.1 + rnd() * 0.5), p = at(s, 0.1, 0.2 + rnd() * 0.6); cb.add(new THREE.OctahedronGeometry(0.12 + rnd() * 0.08, 0), CRYSTAL_COLS[i % 2], [p.x, p.y + 0.15, p.z], [rnd() * 0.5, rnd() * 3, rnd() * 0.5], [0.6, 2, 0.6]); }
    const lp = at(2.3, 0, 1.1);
    cb.add(new THREE.BoxGeometry(0.2, 0.24, 0.2), '#ffd27a', [lp.x, 1.7, lp.z]);
    const post = new THREE.Mesh(new Baker().add(new THREE.CylinderGeometry(0.06, 0.07, 1.6, 6), '#6b4a2a', [lp.x, 0.8, lp.z]).add(new THREE.BoxGeometry(0.3, 0.05, 0.3), '#4a3424', [lp.x, 1.56, lp.z]).build(), rockMat);
    post.position.copy(M); post.castShadow = true; this.outside.add(post);
    const glowMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.3, flatShading: true }); glowMat.emissive = new THREE.Color('#ffffff'); glowMat.emissiveIntensity = 0.8;
    const glow = new THREE.Mesh(cb.build(), glowMat); glow.position.set(M.x, heightAt(M.x, M.z), M.z);
    glow.position.y = M.y;
    this.outside.add(rocks, voidM, glow);
    // a few bats circling the entrance at a distance
    this.outBats = new THREE.InstancedMesh(batGeo(), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.8, flatShading: true }), 4);
    this.outBats.frustumCulled = false; this.outside.add(this.outBats);
  }

  // ---------- interior ----------
  private buildInterior(physics: Physics) {
    const rnd = mulberry32(777), O = this.O;
    // light sources: crystal clusters and mushroom patches, placed near the walls
    const crystals: { x: number; z: number; c: number; s: number }[] = [];
    for (let i = 0, tries = 0; i < 16 && tries < 2000; tries++) {
      const lx = X0 + 2 + rnd() * (X1 - X0 - 4), lz = Z0 + 1 + rnd() * (Z1 - Z0 - 2), e = this.shape(lx, lz);
      if (e < 0.55 || e > 0.8 || Math.hypot(lx - POOL.x, lz - POOL.z) < POOL.r + 0.5) continue;
      crystals.push({ x: lx, z: lz, c: i % 3, s: 0.8 + rnd() * 0.8 }); i++;
    }
    const shrooms: { x: number; z: number; s: number }[] = [];
    for (let i = 0, tries = 0; i < 26 && tries < 3000; tries++) {
      const lx = X0 + 2 + rnd() * (X1 - X0 - 4), lz = Z0 + 1 + rnd() * (Z1 - Z0 - 2), e = this.shape(lx, lz);
      if (e < 0.35 || e > 0.78 || Math.hypot(lx - POOL.x, lz - POOL.z) < POOL.r) continue;
      shrooms.push({ x: lx, z: lz, s: 0.6 + rnd() * 0.8 }); i++;
    }
    for (const c of crystals) this.lights.push({ x: c.x, y: this.floorL(c.x, c.z) + 0.8, z: c.z, c: new THREE.Color(CRYSTAL_COLS[c.c]), i: 1.6 * c.s });
    for (const s of shrooms) this.lights.push({ x: s.x, y: this.floorL(s.x, s.z) + 0.3, z: s.z, c: new THREE.Color('#5ff0e0'), i: 0.5 * s.s });
    this.lights.push({ x: POOL.x, y: -0.6, z: POOL.z, c: new THREE.Color('#2ad8d0'), i: 2.2 });
    this.lights.push({ x: T1 - 1, y: 1.5, z: 0, c: new THREE.Color('#ffe6b0'), i: 3.5 }); // daylight from the tunnel mouth
    // floor + ceiling grids with baked glow
    const nx = Math.round((X1 - X0) / STEP) + 1, nz = Math.round((Z1 - Z0) / STEP) + 1;
    const mk = (ceil: boolean) => {
      const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3), glow = new Float32Array(nx * nz * 3);
      const c = new THREE.Color(), g = new THREE.Color();
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const lx = X0 + i * STEP, lz = Z0 + j * STEP, k = (j * nx + i) * 3;
        const y = ceil ? this.ceilL(lx, lz) : this.floorL(lx, lz);
        pos[k] = lx + O.x; pos[k + 1] = y + O.y; pos[k + 2] = lz + O.z;
        const v = n2.noise(lx * 0.4, lz * 0.4 + (ceil ? 50 : 0)) * 0.5 + 0.5;
        c.set(ceil ? '#2a2634' : '#3a3542').lerp(new THREE.Color(ceil ? '#3a3446' : '#4a4452'), v);
        if (!ceil) { const wet = smooth(POOL.r + 1.5, POOL.r, Math.hypot(lx - POOL.x, lz - POOL.z)); c.lerp(new THREE.Color('#2f3a44'), wet * 0.7); }
        col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
        g.setRGB(0, 0, 0);
        for (const L of this.lights) { const d2 = (L.x - lx) ** 2 + (L.y - y) ** 2 + (L.z - lz) ** 2; const f = L.i / (1 + d2 * 1.1); g.r += L.c.r * f; g.g += L.c.g * f; g.b += L.c.b * f; }
        glow[k] = Math.min(0.9, g.r * 0.22); glow[k + 1] = Math.min(0.9, g.g * 0.22); glow[k + 2] = Math.min(0.9, g.b * 0.22);
      }
      const idx: number[] = [];
      for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b2 = a + 1, c2 = a + nx, d = c2 + 1;
        if (ceil) idx.push(a, b2, c2, b2, d, c2); else idx.push(a, c2, b2, b2, c2, d);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setAttribute('glow', new THREE.BufferAttribute(glow, 3));
      geo.setIndex(idx); geo.computeVertexNormals();
      return geo;
    };
    const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.92, flatShading: true });
    mat.emissiveNode = attribute('glow', 'vec3');
    const floor = new THREE.Mesh(mk(false), mat); floor.receiveShadow = true; this.floorMesh = floor;
    const ceil = new THREE.Mesh(mk(true), mat);
    this.interior.add(floor, ceil);
    const fg = floor.geometry;
    physics.addTrimesh(new Float32Array(fg.attributes.position.array), new Uint32Array(fg.index!.array));
    // stalactites (hang from the ceiling) + stalagmites
    const coneG = new THREE.ConeGeometry(0.28, 1.6, 6); coneG.translate(0, 0.8, 0);
    const stoneMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, flatShading: true });
    const NT = 70, NM = 26;
    const tites = new THREE.InstancedMesh(coneG, stoneMat, NT), mites = new THREE.InstancedMesh(coneG, stoneMat, NM);
    let nt = 0, nm = 0;
    const cc = new THREE.Color();
    for (let tries = 0; tries < 3000 && nt < NT; tries++) {
      const lx = X0 + rnd() * (X1 - X0), lz = Z0 + rnd() * (Z1 - Z0); if (this.shape(lx, lz) > 0.9) continue;
      const sc = 0.5 + rnd() * 1.1;
      this.v.set(lx + O.x, this.ceilL(lx, lz) + O.y + 0.2, lz + O.z);
      tites.setMatrixAt(nt, this.m.compose(this.v, this.q.setFromEuler(this.e.set(Math.PI + (rnd() - 0.5) * 0.15, rnd() * 6, 0)), this.s.set(sc * 0.8, sc * (0.8 + rnd()), sc * 0.8)));
      tites.setColorAt(nt++, cc.set('#5a5262').lerp(new THREE.Color('#7a7084'), rnd()));
    }
    const en = this.entry;
    for (let tries = 0; tries < 3000 && nm < NM; tries++) {
      const lx = X0 + rnd() * (X1 - X0), lz = Z0 + rnd() * (Z1 - Z0), e = this.shape(lx, lz); if (e > 0.82 || e < 0.45) continue;
      if (Math.hypot(lx - POOL.x, lz - POOL.z) < POOL.r + 0.6 || Math.hypot(lx + O.x - en.x, lz + O.z - en.z) < 3) continue;
      const sc = 0.5 + rnd() * 0.9, y = this.floorL(lx, lz) + O.y - 0.1;
      this.v.set(lx + O.x, y, lz + O.z);
      mites.setMatrixAt(nm, this.m.compose(this.v, this.q.setFromEuler(this.e.set((rnd() - 0.5) * 0.1, rnd() * 6, 0)), this.s.set(sc, sc * (0.7 + rnd() * 0.6), sc)));
      mites.setColorAt(nm++, cc.set('#5a5262').lerp(new THREE.Color('#857a8a'), rnd()));
      if (sc > 0.8) physics.addCylinder(lx + O.x, y + 0.6, lz + O.z, 0.6, 0.25 * sc);
    }
    tites.count = nt; mites.count = nm; tites.castShadow = false; mites.castShadow = true;
    this.stats.stalactites = nt;
    this.interior.add(tites, mites);
    // crystal clusters (one mesh per colour so emissive matches)
    for (let ci = 0; ci < 3; ci++) {
      const list = crystals.filter((c) => c.c === ci);
      const cg = new Baker(); cg.ao = false;
      for (let k = 0; k < 6; k++) cg.add(new THREE.OctahedronGeometry(0.16, 0), k % 2 ? '#ffffff' : CRYSTAL_COLS[ci], [Math.cos(k * 2.4) * 0.22 * (k / 6), 0.25 + (k % 3) * 0.1, Math.sin(k * 2.4) * 0.22 * (k / 6)], [Math.cos(k) * 0.4, k, Math.sin(k) * 0.4], [0.55, 2.4 - k * 0.2, 0.55]);
      const cm = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.2, metalness: 0.1, flatShading: true });
      cm.emissive = new THREE.Color(CRYSTAL_COLS[ci]); cm.emissiveIntensity = 1.4;
      const im = new THREE.InstancedMesh(cg.build(), cm, Math.max(1, list.length));
      list.forEach((c, k) => { this.v.set(c.x + O.x, this.floorL(c.x, c.z) + O.y - 0.05, c.z + O.z); im.setMatrixAt(k, this.m.compose(this.v, this.q.setFromEuler(this.e.set(0, rnd() * 6, 0)), this.s.setScalar(c.s))); });
      im.count = list.length; this.interior.add(im);
    }
    this.stats.crystals = crystals.length;
    // glow mushrooms
    const sg = new Baker(); sg.ao = false;
    sg.add(new THREE.CylinderGeometry(0.03, 0.045, 0.22, 6), '#d8f0ea', [0, 0.11, 0]).add(new THREE.SphereGeometry(0.14, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#5ff0e0', [0, 0.2, 0], [0, 0, 0], [1, 0.7, 1])
      .add(new THREE.CylinderGeometry(0.02, 0.03, 0.14, 6), '#d8f0ea', [0.14, 0.07, 0.05]).add(new THREE.SphereGeometry(0.08, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), '#8ffff0', [0.14, 0.13, 0.05], [0, 0, 0], [1, 0.7, 1]);
    const smat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.4 }); smat.emissive = new THREE.Color('#40e8d8'); smat.emissiveIntensity = 0.9;
    const sm = new THREE.InstancedMesh(sg.build(), smat, shrooms.length);
    shrooms.forEach((s, k) => { this.v.set(s.x + O.x, this.floorL(s.x, s.z) + O.y - 0.03, s.z + O.z); sm.setMatrixAt(k, this.m.compose(this.v, this.q.setFromEuler(this.e.set(0, rnd() * 6, 0)), this.s.setScalar(s.s))); });
    this.interior.add(sm);
    // the pool: dark teal water that breathes with light
    const pmat = new THREE.MeshStandardNodeMaterial({ color: '#0f4a56', roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.82 });
    pmat.emissiveNode = vec3(0.05, 0.42, 0.42).mul(float(0.55).add(sin(time.mul(1.3)).mul(0.12)));
    const pool = new THREE.Mesh(new THREE.CircleGeometry(POOL.r + 0.4, 32).rotateX(-Math.PI / 2), pmat);
    pool.position.set(POOL.x + O.x, O.y - 0.4, POOL.z + O.z); this.interior.add(pool);
    // glowing cave fish
    const fg2 = new Baker(); fg2.ao = false;
    fg2.add(new THREE.SphereGeometry(0.08, 8, 5), '#a8fff4', [0, 0, 0], [0, 0, 0], [0.6, 0.7, 1.4]).add(new THREE.ConeGeometry(0.06, 0.1, 4), '#6ff0ff', [0, 0, -0.14], [-Math.PI / 2, 0, 0], [1, 1, 0.3]);
    const fmat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.3 }); fmat.emissive = new THREE.Color('#5ff0ff'); fmat.emissiveIntensity = 1.1;
    this.fish = new THREE.InstancedMesh(fg2.build(), fmat, 7); this.fish.frustumCulled = false; this.interior.add(this.fish);
    // bats hanging from the ceiling
    this.batMesh = new THREE.InstancedMesh(batGeo(), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.8, flatShading: true }), 10);
    this.batMesh.frustumCulled = false; this.interior.add(this.batMesh);
    for (let i = 0, tries = 0; i < 10 && tries < 500; tries++) {
      const lx = -12 + rnd() * 28, lz = -9 + rnd() * 18; if (this.shape(lx, lz) > 0.7) continue;
      const hy = this.ceilL(lx, lz) + O.y - 0.15;
      this.bats.push({ x: lx + O.x, y: hy, z: lz + O.z, hx: lx + O.x, hy, hz: lz + O.z, st: 0, t: 0, ph: rnd() * 6, r: 2 + rnd() * 2 }); i++;
    }
    // beetles
    const bg = new Baker(); bg.ao = false;
    bg.add(new THREE.SphereGeometry(0.07, 8, 5), '#2a5a4a', [0, 0.05, 0], [0, 0, 0], [0.8, 0.55, 1.2]).add(new THREE.SphereGeometry(0.035, 6, 4), '#1a2a24', [0, 0.05, 0.08]).add(new THREE.SphereGeometry(0.02, 5, 4), '#7ff0c0', [0.03, 0.08, -0.02]);
    const bmat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.4 }); bmat.emissive = new THREE.Color('#103028'); bmat.emissiveIntensity = 1;
    this.beetles = new THREE.InstancedMesh(bg.build(), bmat, 8); this.beetles.frustumCulled = false; this.interior.add(this.beetles);
    for (let i = 0; i < 8; i++) this.beetleS.push({ x: -8 + rnd() * 18, z: -6 + rnd() * 12, a: rnd() * 6, t: rnd() * 3 });
    // the friendly mole, in a dirt mound near the middle
    this.mole.x = O.x - 6; this.mole.z = O.z - 4.5; this.mole.y = this.floorAt(this.mole.x, this.mole.z);
    const mb = new Baker(); mb.ao = false;
    mb.add(new THREE.SphereGeometry(0.42, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#6a4a32', [0, -0.02, 0], [0, 0, 0], [1.2, 0.5, 1.2]);
    const mound = new THREE.Mesh(mb.build(), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
    const body = new Baker(); body.ao = false;
    body.add(new THREE.SphereGeometry(0.22, 12, 9), '#5a4a5a', [0, 0.18, 0], [0, 0, 0], [1, 1.1, 0.95])
      .add(new THREE.SphereGeometry(0.05, 8, 6), '#ff9ab0', [0, 0.24, 0.21]).add(new THREE.SphereGeometry(0.025, 6, 4), '#111111', [0.08, 0.3, 0.17]).add(new THREE.SphereGeometry(0.025, 6, 4), '#111111', [-0.08, 0.3, 0.17])
      .add(new THREE.SphereGeometry(0.07, 8, 5), '#ffc0c8', [0.17, 0.12, 0.12], [0, 0, 0], [1, 0.5, 1.2]).add(new THREE.SphereGeometry(0.07, 8, 5), '#ffc0c8', [-0.17, 0.12, 0.12], [0, 0, 0], [1, 0.5, 1.2]);
    const bodyM = new THREE.Mesh(body.build(), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.7 }));
    this.moleBody.add(bodyM); this.moleObj.add(mound, this.moleBody);
    this.moleObj.position.set(this.mole.x, this.mole.y, this.mole.z); this.interior.add(this.moleObj);
    physics.addCylinder(this.mole.x, this.mole.y + 0.3, this.mole.z, 0.3, 0.35);
    // tunnel-mouth daylight
    const day = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3), new THREE.MeshBasicNodeMaterial({ color: '#fff0c8', fog: false }));
    day.position.set(O.x + T1 - 1.6, this.floorL(T1 - 1.6, 0) + O.y + 1.3, O.z); day.rotation.y = Math.PI / 2; this.interior.add(day);
    // collectibles
    const spots = (id: FoodId, n: number, emin: number, emax: number) => {
      for (let i = 0, tries = 0; i < n && tries < 2000; tries++) {
        const lx = X0 + 2 + rnd() * (X1 - X0 - 4), lz = Z0 + 1 + rnd() * (Z1 - Z0 - 2), e = this.shape(lx, lz);
        if (e < emin || e > emax || Math.hypot(lx - POOL.x, lz - POOL.z) < POOL.r + 0.4 || lx < T1 + 2) continue;
        if (this.itemSpots.some((s) => Math.hypot(s.x - lx - O.x, s.z - lz - O.z) < 1.4)) continue;
        this.itemSpots.push({ id, x: lx + O.x, y: this.floorL(lx, lz) + O.y - 0.02, z: lz + O.z }); i++;
      }
    };
    spots('crystal', 9, 0.3, 0.72); spots('glowcap', 8, 0.25, 0.72); spots('geode', 5, 0.2, 0.7); spots('relic', 2, 0.4, 0.72);
  }

  setQuality(high: boolean) { this.high = high; this.batMesh.count = high ? 10 : 6; this.beetles.count = high ? 8 : 4; }

  /** camera inside: pull in along the ray until it's under the ceiling, above the floor and inside the walls */
  clampCamera(target: THREE.Vector3, pos: THREE.Vector3) {
    const d = pos.clone().sub(target), len = d.length(); d.divideScalar(len || 1);
    let ok = 0.6;
    for (let t = 0.6; t <= len; t += 0.2) {
      const x = target.x + d.x * t, y = target.y + d.y * t, z = target.z + d.z * t;
      if (y > this.ceilAt(x, z) - 0.45 || y < this.floorAt(x, z) + 0.35 || this.shapeAt(x, z) > 0.86) break;
      ok = t;
    }
    pos.copy(target).addScaledVector(d, ok);
  }

  update(dt: number, t: number, p: THREE.Vector3) {
    const m = this.m, q = this.q, s = this.s, v = this.v, e = this.e;
    if (!this.inside) {
      // bats circling the entrance (only when near)
      const near = Math.hypot(p.x - this.mouth.x, p.z - this.mouth.z) < 45;
      this.outBats.visible = near;
      if (near) for (let i = 0; i < 4; i++) {
        const a = t * (0.7 + i * 0.13) + i * 1.6, r = 3 + i * 0.8;
        v.set(this.mouth.x + Math.cos(a) * r + this.dir.x * 2, this.mouth.y + 3.5 + Math.sin(t * 2 + i) * 0.6 + i * 0.3, this.mouth.z + Math.sin(a) * r + this.dir.z * 2);
        const flap = 0.35 + Math.abs(Math.sin(t * 14 + i)) * 0.9;
        this.outBats.setMatrixAt(i, m.compose(v, q.setFromEuler(e.set(0, -a, 0)), s.set(flap, 1, 1)));
      }
      this.outBats.instanceMatrix.needsUpdate = true;
      return;
    }
    const O = this.O;
    // bats: hang still; flutter about when you come close, then return home
    this.bats.forEach((b, i) => {
      if (i >= this.batMesh.count) return;
      const d = Math.hypot(p.x - b.hx, p.z - b.hz);
      if (b.st === 0 && d < 5) { b.st = 1; b.t = 5 + Math.random() * 4; }
      let flap = 0.25;
      if (b.st === 1) {
        b.t -= dt; b.ph += dt * 1.6;
        const tx = b.hx + Math.cos(b.ph) * b.r, tz = b.hz + Math.sin(b.ph) * b.r, ty = Math.max(this.floorAt(tx, tz) + 1.6, b.hy - 1.4 + Math.sin(b.ph * 2) * 0.4);
        const k = b.t > 0 ? 1 : 0;
        const gx = k ? tx : b.hx, gy = k ? ty : b.hy, gz = k ? tz : b.hz;
        b.x += (gx - b.x) * Math.min(1, dt * 3); b.y += (gy - b.y) * Math.min(1, dt * 3); b.z += (gz - b.z) * Math.min(1, dt * 3);
        flap = 0.35 + Math.abs(Math.sin(t * 16 + i)) * 0.9;
        if (b.t <= 0 && Math.hypot(b.x - b.hx, b.y - b.hy, b.z - b.hz) < 0.1 && d > 5) b.st = 0;
        this.batMesh.setMatrixAt(i, m.compose(v.set(b.x, b.y, b.z), q.setFromEuler(e.set(0, -b.ph, 0)), s.set(flap, 1, 1)));
      } else {
        // hanging upside down, wings wrapped, a gentle sway
        this.batMesh.setMatrixAt(i, m.compose(v.set(b.hx, b.hy - 0.12, b.hz), q.setFromEuler(e.set(Math.PI + Math.sin(t * 1.2 + i) * 0.1, i, 0)), s.set(flap, 1, 1)));
      }
    });
    this.batMesh.instanceMatrix.needsUpdate = true;
    // fish circling under the pool surface
    for (let i = 0; i < 7; i++) {
      const a = t * (0.4 + i * 0.07) * (i % 2 ? 1 : -1) + i, r = 1 + (i % 4) * 0.8;
      v.set(O.x + POOL.x + Math.cos(a) * r, O.y - 0.75 - (i % 3) * 0.15, O.z + POOL.z + Math.sin(a) * r);
      this.fish.setMatrixAt(i, m.compose(v, q.setFromEuler(e.set(0, -a + (i % 2 ? 0 : Math.PI), Math.sin(t * 6 + i) * 0.2)), s.setScalar(1)));
    }
    this.fish.instanceMatrix.needsUpdate = true;
    // beetles trundle about, scuttle away from feet
    this.beetleS.forEach((b, i) => {
      if (i >= this.beetles.count) return;
      b.t -= dt; if (b.t <= 0) { b.a += (Math.random() - 0.5) * 2.5; b.t = 1 + Math.random() * 2; }
      let sp = 0.25;
      const wx = O.x + b.x, wz = O.z + b.z, dd = Math.hypot(p.x - wx, p.z - wz);
      if (dd < 1.4) { b.a = Math.atan2(wx - p.x, wz - p.z); sp = 1.2; }
      const nx = b.x + Math.sin(b.a) * sp * dt, nz = b.z + Math.cos(b.a) * sp * dt;
      if (this.shape(nx, nz) < 0.72 && Math.hypot(nx - POOL.x, nz - POOL.z) > POOL.r) { b.x = nx; b.z = nz; } else b.a += Math.PI * 0.7;
      v.set(O.x + b.x, this.floorL(b.x, b.z) + O.y, O.z + b.z);
      this.beetles.setMatrixAt(i, m.compose(v, q.setFromEuler(e.set(0, b.a, 0)), s.setScalar(1.3)));
    });
    this.beetles.instanceMatrix.needsUpdate = true;
    // mole pops up when you come close, peeks at you, does a happy wiggle when fed
    const mo = this.mole, md = Math.hypot(p.x - mo.x, p.z - mo.z);
    mo.up += ((md < 4.5 ? 1 : 0) - mo.up) * Math.min(1, dt * 4);
    mo.joy = Math.max(0, mo.joy - dt);
    const want = Math.atan2(p.x - mo.x, p.z - mo.z); let dl = want - mo.look; dl = Math.atan2(Math.sin(dl), Math.cos(dl)); mo.look += dl * Math.min(1, dt * 5);
    const k = mo.up;
    this.moleBody.position.y = -0.35 + k * 0.42 + Math.sin(t * 3) * 0.02 * k + (mo.joy > 0 ? Math.abs(Math.sin(t * 14)) * 0.12 : 0);
    this.moleBody.rotation.y = mo.look + (mo.joy > 0 ? Math.sin(t * 20) * 0.3 : 0);
    this.moleBody.scale.setScalar(0.4 + k * 0.6);
  }
}

function batGeo() {
  const b = new Baker(); b.ao = false;
  b.add(new THREE.SphereGeometry(0.08, 8, 6), '#3a3048', [0, 0, 0], [0, 0, 0], [0.9, 1, 1.2])
    .add(new THREE.SphereGeometry(0.035, 6, 4), '#ff6a8a', [0.03, 0.04, 0.08]).add(new THREE.SphereGeometry(0.035, 6, 4), '#ff6a8a', [-0.03, 0.04, 0.08])
    .add(new THREE.ConeGeometry(0.03, 0.06, 4), '#3a3048', [0.04, 0.09, 0.02]).add(new THREE.ConeGeometry(0.03, 0.06, 4), '#3a3048', [-0.04, 0.09, 0.02]);
  for (const s of [-1, 1]) b.add(new THREE.SphereGeometry(0.16, 8, 4), '#4a3c5c', [s * 0.18, 0.01, 0], [0, 0, s * 0.15], [1, 0.12, 0.6]);
  return b.build();
}
