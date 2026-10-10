import * as THREE from 'three/webgpu';
import { abs, attribute, cos, float, instanceIndex, positionLocal, sin, time, vec3, vertexColor } from 'three/tsl';
import { Baker } from './Baker';
import { heightAt, biomeWeights, WATER_LEVEL } from './Terrain';
import { Biome, BIOME_COUNT } from './Biomes';
import { atOffshore, shoreRadius, offshore } from './Shore';
import { mulberry32 } from './noise';

/**
 * The reef ecosystem in the swim zone: coral + kelp baked into angular sectors (one draw call each,
 * frustum- and distance-culled), and a handful of instanced creatures that are recycled around the
 * player so the reef always feels alive without simulating the whole ring.
 */
const sph = (r: number, w = 7, h = 5) => new THREE.SphereGeometry(r, w, h);
const cyl = (a: number, b: number, h: number, s = 6) => new THREE.CylinderGeometry(a, b, h, s);
const cone = (r: number, h: number, s = 6) => new THREE.ConeGeometry(r, h, s);
const TAU = Math.PI * 2;
const CORAL_COLS = ['#ff6f91', '#ff9a3c', '#a46cff', '#ffd23f', '#3fd6c6', '#ff4d6d', '#ff8fd0', '#7ad8ff'];

function coralGeo(kind: number, col: string, rnd: () => number): THREE.BufferGeometry {
  const b = new Baker(); b.ao = true;
  const c = new THREE.Color(col), dark = c.clone().multiplyScalar(0.75);
  switch (kind) {
    case 0: { // branching staghorn
      b.add(cyl(0.05, 0.07, 0.35), dark, [0, 0.17, 0]);
      for (let i = 0; i < 5; i++) { const a = rnd() * TAU, t = 0.3 + rnd() * 0.5; b.add(cyl(0.025, 0.045, 0.4 + rnd() * 0.2), c, [Math.cos(a) * 0.1, 0.35, Math.sin(a) * 0.1], [Math.sin(a) * t, 0, -Math.cos(a) * t]); b.add(sph(0.04), c.clone().offsetHSL(0, 0, 0.12), [Math.cos(a) * (0.1 + t * 0.32), 0.55 + (1 - t) * 0.1, Math.sin(a) * (0.1 + t * 0.32)]); }
      break;
    }
    case 1: { // brain coral dome
      b.add(new THREE.SphereGeometry(0.42, 9, 6, 0, TAU, 0, Math.PI / 2), c, [0, -0.02, 0], [0, 0, 0], [1, 0.75, 1]);
      for (let i = 0; i < 6; i++) { const a = i * 1.05; b.add(new THREE.TorusGeometry(0.2, 0.025, 3, 8, 2.4), dark, [Math.cos(a) * 0.12, 0.22, Math.sin(a) * 0.12], [Math.PI / 2, 0, a]); }
      break;
    }
    case 2: { // sea fan
      const s = new THREE.Shape(); s.moveTo(0, 0); s.quadraticCurveTo(-0.55, 0.45, -0.32, 0.85); s.quadraticCurveTo(0, 1.05, 0.32, 0.85); s.quadraticCurveTo(0.55, 0.45, 0, 0);
      b.add(new THREE.ShapeGeometry(s, 4), c, [0, 0, 0]).add(new THREE.ShapeGeometry(s, 4), c, [0, 0, 0.01], [0, Math.PI, 0]).add(cyl(0.03, 0.04, 0.2), dark, [0, 0.08, 0]);
      break;
    }
    case 3: { // tube sponge cluster
      for (let i = 0; i < 4; i++) { const a = i * 1.7 + rnd(), r = i ? 0.12 : 0, h = 0.35 + rnd() * 0.35; b.add(new THREE.CylinderGeometry(0.075, 0.06, h, 7, 1, true), c, [Math.cos(a) * r, h / 2, Math.sin(a) * r]).add(new THREE.TorusGeometry(0.07, 0.018, 3, 8), c.clone().offsetHSL(0, 0, 0.1), [Math.cos(a) * r, h, Math.sin(a) * r], [Math.PI / 2, 0, 0]); }
      break;
    }
    case 4: { // table / plate coral
      b.add(cyl(0.06, 0.09, 0.3), dark, [0, 0.15, 0]).add(cyl(0.5, 0.35, 0.07, 9), c, [0, 0.32, 0]).add(cyl(0.3, 0.2, 0.06, 8), c.clone().offsetHSL(0, 0, 0.08), [0.15, 0.4, 0.05]);
      break;
    }
    case 5: { // anemone
      b.add(cyl(0.12, 0.14, 0.12, 8), dark, [0, 0.06, 0]);
      for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; b.add(new THREE.CapsuleGeometry(0.018, 0.16, 2, 4), c, [Math.cos(a) * 0.09, 0.2, Math.sin(a) * 0.09], [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5], 1, (y) => Math.max(0, y - 0.1) * 2.5); }
      break;
    }
  }
  return b.build();
}
function kelpGeo(rnd: () => number): THREE.BufferGeometry {
  const b = new Baker(); b.ao = false;
  const n = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const h = 0.7 + rnd() * 0.3, a = rnd() * TAU, g = new THREE.PlaneGeometry(0.075, h, 1, 4);
    const col = i % 2 ? '#4f8a2a' : '#7aa83a';
    b.add(g, col, [Math.cos(a) * 0.1, h / 2, Math.sin(a) * 0.1], [0, a, 0], 1, (y) => Math.pow(Math.max(0, y) / h, 1.5));
  }
  return b.build();
}
function rock(rnd: () => number) { const b = new Baker(); b.add(new THREE.DodecahedronGeometry(0.35, 0), '#8a8f86', [0, 0.05, 0], [rnd(), rnd(), rnd()], [1.2, 0.6, 1]); return b.build(); }

/** append transformed geometry (non-indexed; position/color/sway) */
function concat(parts: { g: THREE.BufferGeometry; m: THREE.Matrix4 }[]) {
  let n = 0; for (const p of parts) n += p.g.attributes.position.count;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), sw = new Float32Array(n), nor = new Float32Array(n * 3);
  let o = 0; const v = new THREE.Vector3(), nm = new THREE.Matrix3();
  for (const { g, m } of parts) {
    const P = g.attributes.position, C = g.attributes.color, S = g.attributes.sway, N = g.attributes.normal;
    nm.getNormalMatrix(m);
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(m); pos.set([v.x, v.y, v.z], (o + i) * 3);
      v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor.set([v.x, v.y, v.z], (o + i) * 3);
      col.set([C.getX(i), C.getY(i), C.getZ(i)], (o + i) * 3); sw[o + i] = S ? S.getX(i) : 0;
    }
    o += P.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('sway', new THREE.BufferAttribute(sw, 1));
  g.computeBoundingSphere();
  return g;
}

// ---------------- creature geometry ----------------
function fishGeo() {
  const b = new Baker(); b.ao = false;
  b.add(sph(0.11, 7, 5), '#ffffff', [0, 0, 0], [0, 0, 0], [0.45, 0.8, 1.2]).add(cone(0.08, 0.12, 4), '#e8e8e8', [0, 0, -0.17], [-Math.PI / 2, 0, 0], [0.25, 1, 1])
    .add(sph(0.02, 5, 4), '#202020', [0.045, 0.02, 0.07]).add(sph(0.02, 5, 4), '#202020', [-0.045, 0.02, 0.07]);
  return b.build();
}
function turtleGeo() {
  const b = new Baker(); b.ao = false;
  b.add(new THREE.SphereGeometry(0.42, 9, 5, 0, TAU, 0, Math.PI / 2), '#5f8a4a', [0, 0, 0], [0, 0, 0], [1, 0.5, 1.2])
    .add(sph(0.4, 9, 4), '#e8d49a', [0, 0, 0], [0, 0, 0], [1, 0.12, 1.15]).add(sph(0.13, 7, 5), '#8fbf6a', [0, 0.04, 0.55])
    .add(sph(0.025, 5, 4), '#1a1a1a', [0.06, 0.08, 0.64]).add(sph(0.025, 5, 4), '#1a1a1a', [-0.06, 0.08, 0.64]);
  for (let i = 0; i < 6; i++) b.add(new THREE.CircleGeometry(0.11, 6), '#3f6a3a', [Math.cos(i) * 0.18, 0.205 - Math.abs(Math.cos(i)) * 0.02, Math.sin(i) * 0.24], [-Math.PI / 2, 0, 0]);
  // flippers carry sway so the shader can flap them
  b.add(sph(0.2, 6, 4), '#8fbf6a', [0.42, 0, 0.25], [0, 0.5, 0], [1, 0.15, 0.45], (y) => 1).add(sph(0.2, 6, 4), '#8fbf6a', [-0.42, 0, 0.25], [0, -0.5, 0], [1, 0.15, 0.45], () => -1)
    .add(sph(0.12, 6, 4), '#8fbf6a', [0.25, 0, -0.42], [0, -0.5, 0], [1, 0.15, 0.5]).add(sph(0.12, 6, 4), '#8fbf6a', [-0.25, 0, -0.42], [0, 0.5, 0], [1, 0.15, 0.5]);
  return b.build();
}
function rayGeo() {
  const b = new Baker(); b.ao = false;
  b.add(sph(0.6, 8, 4), '#5a6a8a', [0, 0, 0], [0, Math.PI / 4, 0], [1, 0.12, 1]).add(sph(0.58, 8, 4), '#e8ecf4', [0, -0.02, 0], [0, Math.PI / 4, 0], [1, 0.08, 1])
    .add(cyl(0.012, 0.03, 0.9, 4), '#4a5a7a', [0, 0, -0.85], [Math.PI / 2, 0, 0]);
  return b.build();
}
function jellyGeo() {
  const b = new Baker(); b.ao = false;
  b.add(new THREE.SphereGeometry(0.22, 10, 5, 0, TAU, 0, Math.PI / 2), '#ffb8e8', [0, 0, 0], [0, 0, 0], [1, 0.8, 1]);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; b.add(cyl(0.008, 0.004, 0.45, 3), '#ffd8f4', [Math.cos(a) * 0.12, -0.22, Math.sin(a) * 0.12], [0, 0, 0], 1, (y) => -y); }
  return b.build();
}
function dolphinGeo() {
  const b = new Baker(); b.ao = false;
  b.add(sph(0.35, 9, 6), '#7f9ab8', [0, 0, 0], [0, 0, 0], [0.7, 0.75, 2.1]).add(sph(0.3, 8, 5), '#e4ecf4', [0, -0.08, 0.05], [0, 0, 0], [0.6, 0.5, 1.8])
    .add(cone(0.08, 0.3, 4), '#6f8aa8', [0, 0.25, -0.05], [-0.4, 0, 0], [0.3, 1, 1]).add(cone(0.06, 0.25, 4), '#7f9ab8', [0, -0.02, 0.83], [Math.PI / 2, 0, 0])
    .add(sph(0.2, 6, 4), '#6f8aa8', [0, 0, -0.8], [0, 0, 0], [1.4, 0.12, 0.5]).add(sph(0.03, 5, 4), '#1a1a1a', [0.15, 0.06, 0.48]).add(sph(0.03, 5, 4), '#1a1a1a', [-0.15, 0.06, 0.48]);
  return b.build();
}
function bottleGeo() {
  const b = new Baker(); b.ao = false;
  b.add(cyl(0.09, 0.1, 0.3, 8), '#9fe8d0', [0, 0, 0], [Math.PI / 2, 0, 0]).add(cyl(0.035, 0.07, 0.12, 8), '#9fe8d0', [0, 0, 0.2], [Math.PI / 2, 0, 0])
    .add(cyl(0.036, 0.036, 0.06, 6), '#b07a4a', [0, 0, 0.29], [Math.PI / 2, 0, 0]).add(cyl(0.06, 0.06, 0.2, 6), '#f4e4c0', [0, 0, -0.01], [Math.PI / 2, 0, 0]);
  return b.build();
}
function ringGeo() { const g = new THREE.RingGeometry(0.82, 1, 24, 1); g.rotateX(-Math.PI / 2); return g; }

interface Fish { x: number; y: number; z: number; vx: number; vy: number; vz: number; ox: number; oy: number; oz: number; }
interface School { th: number; off: number; y: number; dir: number; sp: number; fish: Fish[]; color: THREE.Color; cx: number; cz: number; }
interface Glider { th: number; off: number; y: number; dir: number; sp: number; x: number; z: number; yaw: number; ph: number; up: number; }
interface Dolphin { th: number; off: number; dir: number; jumpT: number; wait: number; x: number; y: number; z: number; yaw: number; pitch: number; }
export interface SeaBottle { x: number; z: number; y: number; active: boolean; respawn: number; idx: number; ph: number; }

export class Reef {
  group = new THREE.Group();
  private sectors: { mesh: THREE.Mesh; th: number }[] = [];
  private high = true;
  private fishMesh: THREE.InstancedMesh; private schools: School[] = [];
  private turtleMesh: THREE.InstancedMesh; private turtles: Glider[] = [];
  private rayMesh: THREE.InstancedMesh; private rays: Glider[] = [];
  private jellyMesh: THREE.InstancedMesh; private jellies: Glider[] = [];
  private dolMesh: THREE.InstancedMesh; private dolphins: Dolphin[] = [];
  private bottleMesh: THREE.InstancedMesh; bottles: SeaBottle[] = [];
  private ringMesh: THREE.InstancedMesh; private rings: { x: number; z: number; t: number; life: number; size: number }[] = []; private ringI = 0;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(); private s = new THREE.Vector3(); private v = new THREE.Vector3();
  private rnd = mulberry32(4242);
  onSplash: (x: number, z: number, big: boolean) => void = () => {};
  /** counts (tests / perf) */
  stats = { coral: 0, kelp: 0 };

  constructor() {
    const rnd = this.rnd;
    // ---------- coral + kelp sectors ----------
    const SECT = 18;
    const kinds = 6, variants = 3;
    const protos: THREE.BufferGeometry[][] = [];
    for (let k = 0; k < kinds; k++) { protos.push([]); for (let v = 0; v < variants; v++) protos[k].push(coralGeo(k, CORAL_COLS[(k * 3 + v * 2) % CORAL_COLS.length], rnd)); }
    const kelps = [kelpGeo(rnd), kelpGeo(rnd), kelpGeo(rnd)], rocks = [rock(rnd), rock(rnd)];
    const parts: { g: THREE.BufferGeometry; m: THREE.Matrix4 }[][] = Array.from({ length: SECT }, () => []);
    const w = new Float32Array(BIOME_COUNT), pt = { x: 0, z: 0 };
    const place = (g: THREE.BufferGeometry, x: number, y: number, z: number, sc: number, tilt = 0.15) => {
      const th = ((Math.atan2(z, x) / TAU) % 1 + 1) % 1, si = Math.floor(th * SECT) % SECT;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * tilt, rnd() * TAU, (rnd() - 0.5) * tilt)), new THREE.Vector3(sc, sc, sc));
      parts[si].push({ g, m });
    };
    for (let i = 0; i < 1500; i++) {
      const th = rnd() * TAU, off = 1.5 + Math.pow(rnd(), 0.8) * 15;
      atOffshore(th, off, pt);
      const h = heightAt(pt.x, pt.z);
      if (h > -0.95 || h < -3.6) continue;
      biomeWeights(pt.x, pt.z, w);
      // reefs bloom on the warm side; patchy elsewhere
      const warm = 0.35 + w[Biome.Tropical] * 0.65 + w[Biome.Desert] * 0.3 - w[Biome.Alpine] * 0.25;
      const patch = Math.sin(pt.x * 0.35 + Math.cos(pt.z * 0.21) * 2) * Math.cos(pt.z * 0.3 - pt.x * 0.1);
      const r = rnd();
      if (r < 0.62 * warm && patch > -0.45) { // coral clusters: a few heads around each point
        const kind = Math.floor(rnd() * kinds), n = 1 + Math.floor(rnd() * 3);
        for (let c = 0; c < n; c++) {
          const k2 = c ? Math.floor(rnd() * kinds) : kind, cx = pt.x + (rnd() - 0.5) * 1.4 * c, cz = pt.z + (rnd() - 0.5) * 1.4 * c, ch = heightAt(cx, cz);
          const room = -0.45 - ch; if (room < 0.4) continue;
          place(protos[k2][Math.floor(rnd() * variants)], cx, ch - 0.05, cz, Math.min(room * 0.9, 0.8 + rnd() * 0.9), k2 === 2 ? 0.4 : 0.15); this.stats.coral++;
        }
      } else if (r < 0.74 && patch < 0.4) {
        // kelp tops stay well under the surface
        const room = -0.5 - h; if (room > 0.5) { place(kelps[Math.floor(rnd() * 3)], pt.x, h - 0.05, pt.z, Math.min(room, 0.7 + rnd() * 0.9), 0); this.stats.kelp++; }
      } else if (r < 0.8) place(rocks[Math.floor(rnd() * 2)], pt.x, h, pt.z, 0.6 + rnd() * 1.2, 1);
    }
    const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide });
    const sway = attribute('sway', 'float'), p = positionLocal;
    mat.positionNode = p.add(vec3(sin(time.mul(1.25).add(p.x.mul(0.55)).add(p.z.mul(0.35))), float(0), cos(time.mul(1.05).add(p.z.mul(0.5)).sub(p.x.mul(0.2)))).mul(sway.mul(0.16)));
    mat.emissiveNode = vertexColor().mul(0.22);
    for (let i = 0; i < SECT; i++) {
      if (!parts[i].length) continue;
      const mesh = new THREE.Mesh(concat(parts[i]), mat);
      mesh.name = 'reef-sector'; mesh.receiveShadow = false; mesh.castShadow = false;
      this.group.add(mesh); this.sectors.push({ mesh, th: ((i + 0.5) / SECT) * TAU });
    }
    for (const k of protos) for (const g of k) g.dispose();

    // ---------- creatures ----------
    const fishMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.4 });
    // tail wag in the shader: vertices behind the body swing sideways
    fishMat.positionNode = p.add(vec3(sin(time.mul(14).add(float(instanceIndex).mul(1.3))).mul(p.z.min(0).mul(-0.5)), 0, 0));
    fishMat.emissiveNode = vertexColor().mul(0.1);
    this.fishMesh = new THREE.InstancedMesh(fishGeo(), fishMat, 5 * 12);
    const FISH_COLS = ['#3f8fff', '#ffd23f', '#ff8a3c', '#4fe0c0', '#ff6fa8'];
    for (let s = 0; s < 5; s++) {
      const color = new THREE.Color(FISH_COLS[s]);
      const fish: Fish[] = [];
      for (let i = 0; i < 12; i++) { const a = rnd() * TAU, r = 0.3 + rnd() * 0.9; fish.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ox: Math.cos(a) * r, oy: (rnd() - 0.5) * 0.5, oz: Math.sin(a) * r }); this.fishMesh.setColorAt(s * 12 + i, color.clone().offsetHSL((rnd() - 0.5) * 0.04, 0, (rnd() - 0.5) * 0.1)); }
      this.schools.push({ th: rnd() * TAU, off: 4 + rnd() * 8, y: -1, dir: rnd() < 0.5 ? 1 : -1, sp: 0.8 + rnd() * 0.5, fish, color, cx: 0, cz: 0 });
    }
    const flap = (amp: number, speed: number) => p.add(vec3(0, sin(time.mul(speed).add(float(instanceIndex).mul(2.1))).mul(abs(p.x).pow(1.3)).mul(amp), 0));
    const turtleMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.6 });
    turtleMat.positionNode = p.add(vec3(0, sin(time.mul(2.2).add(float(instanceIndex))).mul(attribute('sway', 'float')).mul(0.09), cos(time.mul(2.2).add(float(instanceIndex))).mul(abs(attribute('sway', 'float'))).mul(0.08)));
    this.turtleMesh = new THREE.InstancedMesh(turtleGeo(), turtleMat, 3);
    const rayMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.55 });
    rayMat.positionNode = flap(0.55, 2.4);
    this.rayMesh = new THREE.InstancedMesh(rayGeo(), rayMat, 3);
    const jellyMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.2, transparent: true, opacity: 0.72, depthWrite: false });
    const pulse = sin(time.mul(2.6).add(float(instanceIndex).mul(1.7)));
    jellyMat.positionNode = vec3(p.x.mul(pulse.mul(0.12).add(1)), p.y.mul(pulse.mul(-0.12).add(1)), p.z.mul(pulse.mul(0.12).add(1))).add(vec3(sin(time.mul(1.6).add(p.y.mul(6))).mul(attribute('sway', 'float')).mul(0.15), 0, 0));
    jellyMat.emissiveNode = vertexColor().mul(0.45);
    this.jellyMesh = new THREE.InstancedMesh(jellyGeo(), jellyMat, 8);
    const dolMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.35 });
    this.dolMesh = new THREE.InstancedMesh(dolphinGeo(), dolMat, 3);
    const botMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.92 });
    botMat.emissiveNode = vertexColor().mul(0.3);
    this.bottleMesh = new THREE.InstancedMesh(bottleGeo(), botMat, 2);
    const ringMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: '#ffffff' });
    this.ringMesh = new THREE.InstancedMesh(ringGeo(), ringMat, 28);
    this.ringMesh.renderOrder = 3;
    for (let i = 0; i < 28; i++) { this.rings.push({ x: 0, z: 0, t: 1, life: 1, size: 1 }); this.ringMesh.setColorAt(i, new THREE.Color(0, 0, 0)); this.ringMesh.setMatrixAt(i, this.m.makeScale(0, 0, 0)); }
    const mk = (n: number, depth: [number, number], off: [number, number], sp: [number, number]): Glider[] => Array.from({ length: n }, () => ({ th: rnd() * TAU, off: off[0] + rnd() * (off[1] - off[0]), y: depth[0] + rnd() * (depth[1] - depth[0]), dir: rnd() < 0.5 ? 1 : -1, sp: sp[0] + rnd() * (sp[1] - sp[0]), x: 0, z: 0, yaw: 0, ph: rnd() * TAU, up: 0 }));
    this.turtles = mk(3, [-1.1, -0.7], [3, 13], [0.5, 0.8]);
    this.rays = mk(3, [-1.6, -1.2], [4, 14], [0.9, 1.3]);
    this.jellies = mk(8, [-1.4, -0.6], [9, 17], [0.12, 0.25]);
    this.dolphins = Array.from({ length: 3 }, (_, i) => ({ th: rnd() * TAU, off: 25 + rnd() * 8, dir: i % 2 ? 1 : -1, jumpT: -1, wait: 2 + rnd() * 6, x: 0, y: -2, z: 0, yaw: 0, pitch: 0 }));
    for (let i = 0; i < 2; i++) this.bottles.push({ x: 0, z: 0, y: 0, active: false, respawn: 0, idx: i, ph: rnd() * TAU });
    for (const im of [this.fishMesh, this.turtleMesh, this.rayMesh, this.jellyMesh, this.dolMesh, this.bottleMesh, this.ringMesh]) {
      im.frustumCulled = false; im.castShadow = false; this.group.add(im);
      for (let i = 0; i < im.count; i++) if (im !== this.ringMesh) im.setMatrixAt(i, this.m.makeScale(0, 0, 0));
    }
    this.fishMesh.name = 'reef-fish';
  }

  setQuality(high: boolean) { this.high = high; }

  /** expanding foam ring on the water surface (wakes, splashes) */
  ring(x: number, z: number, size = 1, life = 1.2) {
    const r = this.rings[this.ringI]; this.ringI = (this.ringI + 1) % this.rings.length;
    r.x = x; r.z = z; r.t = 0; r.life = life; r.size = size;
  }

  private placeBottle(b: SeaBottle, pth: number) {
    const pt = atOffshore(pth + (this.rnd() - 0.5) * 1.2, 5 + this.rnd() * 10);
    b.x = pt.x; b.z = pt.z; b.active = true;
  }
  takeBottle(b: SeaBottle) { b.active = false; b.respawn = 75 + this.rnd() * 60; this.ring(b.x, b.z, 0.9, 1); this.onSplash(b.x, b.z, false); }
  nearestBottle(x: number, z: number, maxD: number) {
    let best: SeaBottle | null = null, bd = maxD;
    for (const b of this.bottles) if (b.active) { const d = Math.hypot(b.x - x, b.z - z); if (d < bd) { bd = d; best = b; } }
    return best;
  }

  update(dt: number, t: number, player: THREE.Vector3, swimming: boolean, moving: number) {
    const px = player.x, pz = player.z, pth = Math.atan2(pz, px);
    const poff = offshore(px, pz);
    const nearSea = poff > -28;
    const viewD = this.high ? 70 : 46;
    for (const s of this.sectors) {
      // sector centre ~ shoreline + 8 m
      const R = shoreRadius(s.th) + 8, sx = Math.cos(s.th) * R, sz = Math.sin(s.th) * R;
      s.mesh.visible = nearSea && Math.hypot(sx - px, sz - pz) < viewD + 18;
    }
    const m = this.m, q = this.q, e = this.e, sc = this.s, v = this.v;
    const hide = (im: THREE.InstancedMesh, i: number) => im.setMatrixAt(i, m.makeScale(0, 0, 0));
    const spread = this.high ? 1.0 : 0.7;
    const recycle = (o: { th: number }) => { const d = Math.abs(Math.atan2(Math.sin(o.th - pth), Math.cos(o.th - pth))); if (d > spread) o.th = pth + (this.rnd() - 0.5) * spread * 1.4; };

    // ---- fish schools (boids around a wandering centre) ----
    const nS = this.high ? 5 : 3, nF = this.high ? 12 : 7;
    for (let s = 0; s < 5; s++) {
      const sch = this.schools[s];
      if (!nearSea || s >= nS) { for (let i = 0; i < 12; i++) hide(this.fishMesh, s * 12 + i); continue; }
      const before = sch.th; recycle(sch); const jumped = before !== sch.th;
      const R = shoreRadius(sch.th) + sch.off;
      sch.th += sch.dir * sch.sp * dt / R;
      sch.off = 5 + 4.5 * Math.sin(t * 0.07 + s * 2) + 2;
      const cx = Math.cos(sch.th) * R, cz = Math.sin(sch.th) * R;
      const floor = heightAt(cx, cz);
      sch.y = Math.min(-0.55, Math.max(floor + 0.45, (floor + WATER_LEVEL) * 0.5));
      const tx = -Math.sin(sch.th) * sch.dir, tz = Math.cos(sch.th) * sch.dir;
      for (let i = 0; i < 12; i++) {
        const f = sch.fish[i];
        if (i >= nF) { hide(this.fishMesh, s * 12 + i); continue; }
        if (jumped || (f.x === 0 && f.z === 0)) { f.x = cx + f.ox; f.y = sch.y + f.oy; f.z = cz + f.oz; f.vx = tx * sch.sp; f.vz = tz * sch.sp; f.vy = 0; }
        // seek slot, align with school, separate from mates, flee the swimmer
        let ax = (cx + f.ox - f.x) * 1.2 + (tx * sch.sp - f.vx) * 0.8, ay = (sch.y + f.oy - f.y) * 1.5, az = (cz + f.oz - f.z) * 1.2 + (tz * sch.sp - f.vz) * 0.8;
        for (let j = 0; j < nF; j++) { if (j === i) continue; const o = sch.fish[j], dx = f.x - o.x, dy = f.y - o.y, dz = f.z - o.z, d2 = dx * dx + dy * dy + dz * dz; if (d2 < 0.09 && d2 > 1e-5) { ax += dx / d2 * 0.08; ay += dy / d2 * 0.04; az += dz / d2 * 0.08; } }
        const dx = f.x - px, dz = f.z - pz, dp = Math.hypot(dx, dz);
        if (dp < 2.6 && Math.abs(f.y - player.y) < 2.2) { const k = (2.6 - dp) * 6 / (dp || 1); ax += dx * k; az += dz * k; ay -= 0.6; }
        f.vx += ax * dt; f.vy += ay * dt; f.vz += az * dt;
        const spd = Math.hypot(f.vx, f.vy, f.vz), mx = dp < 2.6 ? 4.5 : 1.8;
        if (spd > mx) { f.vx *= mx / spd; f.vy *= mx / spd; f.vz *= mx / spd; }
        f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
        const fl = heightAt(f.x, f.z) + 0.2; if (f.y < fl) f.y = fl; if (f.y > -0.25) f.y = -0.25;
        const yaw = Math.atan2(f.vx, f.vz), pitch = -Math.atan2(f.vy, Math.hypot(f.vx, f.vz)) * 0.6;
        q.setFromEuler(e.set(pitch, yaw, 0, 'YXZ'));
        this.fishMesh.setMatrixAt(s * 12 + i, m.compose(v.set(f.x, f.y, f.z), q, sc.setScalar(0.85 + (i % 3) * 0.12)));
      }
    }
    this.fishMesh.instanceMatrix.needsUpdate = true;

    // ---- gliders: turtles, rays, jellyfish ----
    const glide = (arr: Glider[], im: THREE.InstancedMesh, n: number, scale: number, float: (g: Glider, floor: number) => number, yawOff = 0) => {
      for (let i = 0; i < arr.length; i++) {
        const g = arr[i];
        if (!nearSea || i >= n) { hide(im, i); continue; }
        recycle(g);
        const R = shoreRadius(g.th) + g.off;
        g.th += g.dir * g.sp * dt / R;
        g.x = Math.cos(g.th) * R + Math.sin(t * 0.13 + g.ph) * 1.5; g.z = Math.sin(g.th) * R + Math.cos(t * 0.11 + g.ph) * 1.5;
        const floor = heightAt(g.x, g.z);
        const ty = float(g, floor);
        g.y += (ty - g.y) * Math.min(1, dt * 0.8);
        g.yaw = Math.atan2(-Math.sin(g.th) * g.dir, Math.cos(g.th) * g.dir) + yawOff;
        q.setFromEuler(e.set(Math.sin(t * 0.7 + g.ph) * 0.08, g.yaw, Math.sin(t * 0.5 + g.ph) * 0.1, 'YXZ'));
        im.setMatrixAt(i, m.compose(v.set(g.x, g.y, g.z), q, sc.setScalar(scale)));
      }
      im.instanceMatrix.needsUpdate = true;
    };
    // turtles cruise mid-water and now and then rise to breathe
    glide(this.turtles, this.turtleMesh, this.high ? 3 : 2, 1, (g, fl) => (Math.sin(t * 0.15 + g.ph) > 0.85 ? -0.28 : Math.max(fl + 0.5, -1.0)));
    glide(this.rays, this.rayMesh, this.high ? 3 : 2, 1, (g, fl) => Math.min(-0.7, fl + 0.35));
    glide(this.jellies, this.jellyMesh, this.high ? 8 : 4, 1, (g, fl) => Math.max(fl + 0.6, -0.8 + Math.sin(t * 0.4 + g.ph) * 0.4));

    // ---- dolphins far out: arcs of joy ----
    const nD = this.high ? 3 : 2;
    for (let i = 0; i < 3; i++) {
      const d = this.dolphins[i];
      if (!nearSea || i >= nD) { hide(this.dolMesh, i); continue; }
      recycle(d);
      const R = shoreRadius(d.th) + d.off;
      d.th += d.dir * 4.2 * dt / R;
      d.x = Math.cos(d.th) * R; d.z = Math.sin(d.th) * R;
      d.yaw = Math.atan2(-Math.sin(d.th) * d.dir, Math.cos(d.th) * d.dir);
      if (d.jumpT < 0) { d.wait -= dt; d.y = -1.4; d.pitch = 0; if (d.wait <= 0) { d.jumpT = 0; this.ring(d.x, d.z, 1.2, 1.4); this.onSplash(d.x, d.z, true); } }
      else {
        d.jumpT += dt / 1.3; const k = d.jumpT;
        d.y = -0.9 + Math.sin(Math.min(1, k) * Math.PI) * 2.1; d.pitch = -Math.cos(Math.min(1, k) * Math.PI) * 0.9;
        if (k >= 1) { d.jumpT = -1; d.wait = 3 + this.rnd() * 7; this.ring(d.x, d.z, 1.4, 1.6); this.onSplash(d.x, d.z, true); }
      }
      q.setFromEuler(e.set(d.pitch, d.yaw, 0, 'YXZ'));
      this.dolMesh.setMatrixAt(i, m.compose(v.set(d.x, d.y, d.z), q, sc.setScalar(1)));
    }
    this.dolMesh.instanceMatrix.needsUpdate = true;

    // ---- floating message bottles ----
    for (const b of this.bottles) {
      if (!b.active) { b.respawn -= dt; if (b.respawn <= 0 && nearSea) this.placeBottle(b, pth); }
      if (!b.active) { hide(this.bottleMesh, b.idx); continue; }
      if (Math.hypot(b.x - px, b.z - pz) > 90) this.placeBottle(b, pth);
      b.y = 0.03 + Math.sin(t * 1.6 + b.ph) * 0.06;
      q.setFromEuler(e.set(Math.sin(t * 1.3 + b.ph) * 0.25, t * 0.2 + b.ph, Math.cos(t * 1.1 + b.ph) * 0.2));
      this.bottleMesh.setMatrixAt(b.idx, m.compose(v.set(b.x, b.y, b.z), q, sc.setScalar(1.25)));
      if (Math.sin(t * 1.6 + b.ph) > 0.995) this.ring(b.x, b.z, 0.35, 1);
    }
    this.bottleMesh.instanceMatrix.needsUpdate = true;

    // ---- wake rings ----
    if (swimming && moving > 0.15 && this.rnd() < dt * (2 + moving * 4)) this.ring(px - Math.sin(t) * 0.05, pz, 0.45 + moving * 0.25, 1.1);
    const col = new THREE.Color();
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      if (r.t >= 1) continue;
      r.t = Math.min(1, r.t + dt / r.life);
      const k = 1 - Math.pow(1 - r.t, 2.2);
      this.ringMesh.setMatrixAt(i, m.compose(v.set(r.x, 0.1, r.z), q.identity(), sc.set(r.size * (0.3 + k * 1.4), 1, r.size * (0.3 + k * 1.4))));
      this.ringMesh.setColorAt(i, col.setScalar(0.55 * (1 - r.t) * (r.t < 0.1 ? r.t * 10 : 1)));
      if (r.t >= 1) this.ringMesh.setMatrixAt(i, m.makeScale(0, 0, 0));
    }
    this.ringMesh.instanceMatrix.needsUpdate = true;
    if (this.ringMesh.instanceColor) this.ringMesh.instanceColor.needsUpdate = true;
  }
}
