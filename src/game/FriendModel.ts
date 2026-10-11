import * as THREE from 'three/webgpu';

/**
 * Articulated close-up versions of the island animals for the friend screen.
 * Parts are separate pivots so the creature can blink, look at the finger, lean
 * into a pet, wiggle ears/tail, flap wings, click claws and chomp.
 */
export interface Rig {
  root: THREE.Group;     // hop / spin
  body: THREE.Group;     // breathe / lean / shake
  head: THREE.Group;     // look / nod / head-shake
  eyes: THREE.Group[];   // blink (scale.y)
  ears: THREE.Group[];   // wiggle / flick
  tail: THREE.Group | null;
  wings: THREE.Group[];  // duck / bird flap
  claws: THREE.Group[];  // crab clicks
  nose: THREE.Object3D | null;
  mouth: THREE.Vector3;  // head-local point where food goes
  /** body-local points on the coat where dirt can sit */
  dirtSpots: { p: THREE.Vector3; n: THREE.Vector3; r: number }[];
  dirtParent: THREE.Group;
  height: number;
  pickables: THREE.Object3D[];
}

const mats = new Map<string, THREE.MeshStandardNodeMaterial>();
function mat(color: string, rough = 0.72) {
  const k = color + rough;
  let m = mats.get(k);
  if (!m) { m = new THREE.MeshStandardNodeMaterial({ color, roughness: rough }); m.fog = false; mats.set(k, m); }
  return m;
}
const S = (r: number) => new THREE.SphereGeometry(r, 18, 14);
const C = (a: number, b: number, h: number, s = 10) => new THREE.CylinderGeometry(a, b, h, s);
const K = (r: number, l: number) => new THREE.CapsuleGeometry(r, l, 4, 10);
const Co = (r: number, h: number) => new THREE.ConeGeometry(r, h, 10);

function m(geo: THREE.BufferGeometry, color: string, pos: number[] = [0, 0, 0], rot: number[] = [0, 0, 0], scl: number[] = [1, 1, 1], rough?: number) {
  const o = new THREE.Mesh(geo, mat(color, rough));
  o.position.set(pos[0], pos[1], pos[2]); o.rotation.set(rot[0], rot[1], rot[2]); o.scale.set(scl[0], scl[1], scl[2]);
  o.castShadow = true;
  return o;
}
function pivot(parent: THREE.Object3D, pos: number[], rot: number[] = [0, 0, 0]) {
  const g = new THREE.Group(); g.position.set(pos[0], pos[1], pos[2]); g.rotation.set(rot[0], rot[1], rot[2]); parent.add(g); return g;
}
/** an eye: white, iris, glint; the group squashes to blink */
function eye(parent: THREE.Object3D, pos: number[], r: number, iris = '#2a211c') {
  const g = pivot(parent, pos);
  g.add(m(S(r), '#ffffff', [0, 0, 0], [0, 0, 0], [1, 1, 0.7], 0.3));
  g.add(m(S(r * 0.66), iris, [0, 0, r * 0.38], [0, 0, 0], [1, 1, 0.6], 0.25));
  g.add(m(S(r * 0.22), '#ffffff', [r * 0.22, r * 0.25, r * 0.72], [0, 0, 0], [1, 1, 0.5], 0.1));
  return g;
}
function spotsOnEllipsoid(center: THREE.Vector3, rad: THREE.Vector3, n: number, r: number, filter: (v: THREE.Vector3) => boolean = () => true) {
  // golden-spiral samples over the whole coat, filtered, then an even subset (so spots spread all around)
  const cand: Rig['dirtSpots'] = [], N = 80;
  for (let i = 0; i < N; i++) {
    const k = (i + 0.5) / N, phi = Math.acos(1 - 2 * k), th = Math.PI * (1 + Math.sqrt(5)) * i;
    const nrm = new THREE.Vector3(Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th));
    if (nrm.y < -0.3 || !filter(nrm)) continue;
    const p = new THREE.Vector3(nrm.x * rad.x, nrm.y * rad.y, nrm.z * rad.z).add(center);
    cand.push({ p, n: nrm.clone(), r });
  }
  const out: Rig['dirtSpots'] = [];
  for (let j = 0; j < n && cand.length; j++) out.push(cand[Math.floor((j * cand.length) / n)]);
  return out;
}
function base(): Rig {
  const root = new THREE.Group(), body = pivot(root, [0, 0, 0]);
  return { root, body, head: new THREE.Group(), eyes: [], ears: [], tail: null, wings: [], claws: [], nose: null, mouth: new THREE.Vector3(), dirtSpots: [], dirtParent: body, height: 1, pickables: [] };
}

function bunny(col: string): Rig {
  const r = base(), b = r.body, pink = '#ff9fb0';
  b.add(m(S(0.5), col, [0, 0.48, -0.05], [0, 0, 0], [1, 0.92, 1.15]));
  b.add(m(S(0.26), '#fff8f0', [0, 0.36, 0.34], [0, 0, 0], [1, 1, 0.6])); // tummy
  for (const s of [-1, 1]) { b.add(m(S(0.15), col, [s * 0.26, 0.1, 0.28], [0, 0, 0], [1, 0.6, 1.4])); b.add(m(S(0.18), col, [s * 0.3, 0.16, -0.25], [0, 0, 0], [0.9, 0.8, 1.5])); }
  r.tail = pivot(b, [0, 0.42, -0.6]); r.tail.add(m(S(0.16), '#ffffff'));
  r.head = pivot(b, [0, 0.95, 0.22]);
  const h = r.head;
  h.add(m(S(0.36), col, [0, 0.05, 0.05], [0, 0, 0], [1.05, 0.95, 1]));
  for (const s of [-1, 1]) {
    h.add(m(S(0.12), col, [s * 0.12, -0.08, 0.3], [0, 0, 0], [1, 0.8, 0.8])); // cheeks
    h.add(m(S(0.06), '#ffb3c1', [s * 0.22, -0.04, 0.27], [0, 0, 0], [1, 0.7, 0.4])); // blush
    r.eyes.push(eye(h, [s * 0.15, 0.1, 0.355], 0.075));
    const ear = pivot(h, [s * 0.13, 0.32, -0.02], [-0.15, 0, s * -0.18]);
    ear.add(m(K(0.08, 0.42), col, [0, 0.3, 0], [0, 0, 0], [1, 1, 0.55]));
    ear.add(m(K(0.045, 0.34), pink, [0, 0.3, 0.035], [0, 0, 0], [1, 1, 0.4]));
    r.ears.push(ear);
  }
  r.nose = m(S(0.045), pink, [0, -0.02, 0.4], [0, 0, 0], [1.3, 0.9, 1]); h.add(r.nose);
  r.mouth.set(0, -0.12, 0.4);
  r.dirtSpots = spotsOnEllipsoid(new THREE.Vector3(0, 0.48, -0.05), new THREE.Vector3(0.5, 0.46, 0.58), 9, 0.11, (n) => n.z < 0.85 && n.y < 0.75);
  r.height = 1.75;
  return r;
}
function deer(): Rig {
  const r = base(), b = r.body, c = '#b9814f', d = '#8a5a36', cream = '#f4ead8';
  b.add(m(K(0.34, 0.75), c, [0, 1.05, -0.05], [Math.PI / 2, 0, 0]));
  for (let i = 0; i < 6; i++) b.add(m(S(0.05), cream, [(i % 2 ? -1 : 1) * 0.17, 1.28 + (i % 3) * 0.04, -0.35 + i * 0.12], [0, 0, 0], [1, 0.5, 1]));
  for (const [x, z] of [[-0.18, 0.38], [0.18, 0.38], [-0.18, -0.45], [0.18, -0.45]]) { b.add(m(C(0.06, 0.05, 0.85), d, [x, 0.45, z])); b.add(m(S(0.065), '#4a3426', [x, 0.04, z], [0, 0, 0], [1, 0.6, 1.2])); }
  r.tail = pivot(b, [0, 1.15, -0.62], [-0.6, 0, 0]); r.tail.add(m(S(0.1), '#ffffff', [0, 0.06, 0], [0, 0, 0], [0.8, 1.3, 0.7]));
  const neck = pivot(b, [0, 1.25, 0.42], [-0.45, 0, 0]); neck.add(m(C(0.13, 0.17, 0.55), c, [0, 0.25, 0]));
  r.head = pivot(b, [0, 1.72, 0.62]);
  const h = r.head;
  h.add(m(S(0.24), c, [0, 0, 0], [0, 0, 0], [1, 0.95, 1.1]));
  h.add(m(K(0.13, 0.18), c, [0, -0.08, 0.24], [1.35, 0, 0]));
  h.add(m(S(0.07), '#2a2a2a', [0, -0.06, 0.42]));
  r.nose = h.children[h.children.length - 1];
  for (const s of [-1, 1]) {
    r.eyes.push(eye(h, [s * 0.14, 0.06, 0.19], 0.062));
    const ear = pivot(h, [s * 0.18, 0.15, -0.02], [0, 0, s * -0.9]);
    ear.add(m(S(0.1), c, [0, 0.13, 0], [0, 0, 0], [0.55, 1.4, 0.3])); ear.add(m(S(0.06), '#f2c6b0', [0, 0.13, 0.025], [0, 0, 0], [0.5, 1.3, 0.2]));
    r.ears.push(ear);
    const ant = pivot(h, [s * 0.08, 0.2, -0.04], [0, 0, s * -0.35]);
    ant.add(m(C(0.018, 0.026, 0.3, 6), '#efe2c4', [0, 0.15, 0])); ant.add(m(C(0.014, 0.02, 0.14, 6), '#efe2c4', [s * 0.05, 0.24, 0.03], [0.6, 0, s * -0.6]));
  }
  r.mouth.set(0, -0.15, 0.4);
  r.dirtSpots = spotsOnEllipsoid(new THREE.Vector3(0, 1.05, -0.05), new THREE.Vector3(0.34, 0.34, 0.7), 10, 0.1, (n) => Math.abs(n.z) < 0.85);
  r.height = 2.05;
  return r;
}
function duck(): Rig {
  const r = base(), b = r.body;
  b.add(m(S(0.42), '#f6f2ea', [0, 0.4, -0.05], [0, 0, 0], [1, 0.8, 1.3]));
  r.tail = pivot(b, [0, 0.52, -0.55], [-0.5, 0, 0]); r.tail.add(m(Co(0.16, 0.32), '#e8e0d0', [0, 0.1, 0]));
  for (const s of [-1, 1]) {
    const w = pivot(b, [s * 0.36, 0.5, 0.0], [0, 0, 0]);
    w.add(m(S(0.24), '#e6ddcc', [s * 0.06, 0, -0.1], [0, 0, 0], [0.35, 0.65, 1.2]));
    r.wings.push(w);
    b.add(m(C(0.03, 0.03, 0.2, 6), '#ff9a2e', [s * 0.14, 0.06, 0.05])); b.add(m(S(0.1), '#ff9a2e', [s * 0.14, -0.03, 0.12], [0, 0, 0], [1, 0.3, 1.3]));
  }
  r.head = pivot(b, [0, 0.82, 0.3]);
  const h = r.head;
  h.add(m(S(0.26), '#2f7a4a', [0, 0.05, 0]));
  h.add(m(C(0.2, 0.2, 0.05, 14), '#ffffff', [0, -0.16, 0], [0, 0, 0]));
  const beak = pivot(h, [0, -0.02, 0.22]);
  beak.add(m(S(0.11), '#ff9a2e', [0, 0, 0.08], [0, 0, 0], [1.2, 0.45, 1.5]));
  r.nose = beak;
  for (const s of [-1, 1]) r.eyes.push(eye(h, [s * 0.15, 0.1, 0.195], 0.058));
  r.mouth.set(0, -0.04, 0.4);
  r.dirtSpots = spotsOnEllipsoid(new THREE.Vector3(0, 0.4, -0.05), new THREE.Vector3(0.42, 0.34, 0.55), 9, 0.1, (n) => n.z < 0.8);
  r.height = 1.35;
  return r;
}
function crab(): Rig {
  const r = base(), b = r.body, c = '#e8583a', l = '#f58a64';
  b.add(m(S(0.42), c, [0, 0.36, 0], [0, 0, 0], [1.35, 0.6, 1]));
  b.add(m(S(0.3), l, [0, 0.3, 0.12], [0, 0, 0], [1.3, 0.45, 0.9]));
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {
    const leg = pivot(b, [s * 0.45, 0.28, -0.18 + k * 0.17], [0, 0, s * 0.9]);
    leg.add(m(C(0.035, 0.03, 0.4, 6), c, [0, -0.2, 0]));
  }
  for (const s of [-1, 1]) {
    const arm = pivot(b, [s * 0.5, 0.4, 0.25], [0, s * -0.5, 0]);
    arm.add(m(C(0.05, 0.05, 0.3, 6), c, [s * 0.1, 0.05, 0.1], [0, 0, s * 1.2]));
    arm.add(m(S(0.17), c, [s * 0.25, 0.14, 0.2], [0, 0, 0], [1, 0.8, 1.2]));
    const pincer = pivot(arm, [s * 0.25, 0.2, 0.32]);
    pincer.add(m(Co(0.07, 0.22), c, [0, 0.06, 0.06], [1.2, 0, 0]));
    r.claws.push(pincer);
  }
  r.head = pivot(b, [0, 0.55, 0.2]);
  for (const s of [-1, 1]) {
    const stalk = pivot(r.head, [s * 0.14, 0, 0], [0, 0, s * -0.15]);
    stalk.add(m(C(0.03, 0.035, 0.28, 6), c, [0, 0.14, 0]));
    r.eyes.push(eye(stalk, [0, 0.32, 0.02], 0.085, '#1a1a1a'));
    r.ears.push(stalk);
  }
  r.mouth.set(0, -0.12, 0.25);
  r.dirtSpots = spotsOnEllipsoid(new THREE.Vector3(0, 0.36, 0), new THREE.Vector3(0.56, 0.26, 0.42), 8, 0.1, (n) => n.y > 0.1);
  r.height = 1.15;
  return r;
}
function bird(col: string): Rig {
  const r = base(), b = r.body;
  b.add(m(S(0.36), col, [0, 0.45, -0.02], [-0.3, 0, 0], [0.95, 0.9, 1.25]));
  b.add(m(S(0.24), '#fff3e2', [0, 0.38, 0.2], [0, 0, 0], [1, 1, 0.6]));
  r.tail = pivot(b, [0, 0.46, -0.42], [-0.35, 0, 0]); r.tail.add(m(S(0.18), col, [0, 0, -0.12], [0, 0, 0], [0.7, 0.18, 1.3]));
  for (const s of [-1, 1]) {
    const w = pivot(b, [s * 0.32, 0.52, -0.02]);
    w.add(m(S(0.22), col, [s * 0.06, -0.04, -0.12], [0, 0, 0], [0.3, 0.6, 1.3]));
    r.wings.push(w);
    b.add(m(C(0.02, 0.02, 0.2, 6), '#e8a53a', [s * 0.1, 0.1, 0.02])); b.add(m(S(0.06), '#e8a53a', [s * 0.1, 0.01, 0.08], [0, 0, 0], [1, 0.3, 1.6]));
  }
  r.head = pivot(b, [0, 0.82, 0.12]);
  const h = r.head;
  h.add(m(S(0.25), col));
  const beak = pivot(h, [0, -0.02, 0.22]); beak.add(m(Co(0.07, 0.16), '#ffb02e', [0, 0, 0.06], [Math.PI / 2, 0, 0]));
  r.nose = beak;
  for (const s of [-1, 1]) { r.eyes.push(eye(h, [s * 0.13, 0.06, 0.195], 0.06)); h.add(m(S(0.045), '#ff9fb0', [s * 0.17, -0.06, 0.13], [0, 0, 0], [1, 0.7, 0.4])); }
  const tuft = pivot(h, [0, 0.22, 0]); tuft.add(m(Co(0.05, 0.18), col, [0, 0.07, 0], [-0.3, 0, 0])); r.ears.push(tuft);
  r.mouth.set(0, -0.04, 0.36);
  r.dirtSpots = spotsOnEllipsoid(new THREE.Vector3(0, 0.45, -0.02), new THREE.Vector3(0.34, 0.32, 0.45), 8, 0.09, (n) => n.z < 0.75);
  r.height = 1.25;
  return r;
}

export function buildRig(species: string, color: string | null): Rig {
  const r = species === 'deer' ? deer() : species === 'duck' ? duck() : species === 'crab' ? crab() : species === 'bird' ? bird(color ?? '#5a8fd8') : bunny(color ?? '#f4f0e8');
  r.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) r.pickables.push(o); });
  return r;
}

/** dirt blob mesh (shared) */
export const dirtMat = (() => { const mm = new THREE.MeshStandardNodeMaterial({ color: '#6b4a2e', roughness: 1 }); mm.fog = false; return mm; })();
export const dirtGeo = new THREE.SphereGeometry(1, 9, 7);
