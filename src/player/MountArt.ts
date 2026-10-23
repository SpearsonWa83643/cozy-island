import * as THREE from 'three/webgpu';
import type { MountId } from './MountDefs';

/**
 * Procedural mount rigs. Every rig exposes the same hinge groups (body / head / wings with hinged
 * tips / tail / legs) so Mount's flight animation drives any of them; `animate` adds per-mount flair
 * (wagging tail, floppy ears, rainbow shimmer…).
 */
export type RigPhase = 'off' | 'arrive' | 'wait' | 'hop' | 'ride' | 'leave';
export interface MountRig {
  id: MountId;
  body: THREE.Group;
  head: THREE.Group;
  wingL: THREE.Group; wingR: THREE.Group;
  tipL: THREE.Group; tipR: THREE.Group;
  tail: THREE.Group;
  legs: THREE.Group;
  mats: THREE.MeshStandardNodeMaterial[];
  /** rider seat in body space */
  seat: THREE.Vector3;
  /** flap amplitude / rate multipliers */
  amp: number; rate: number;
  /** ground shadow size */
  shadow: number;
  /** tail fans out while hovering (eagle-style) */
  fanTail: boolean;
  /** flight feel multipliers: turn rate and speed response (dragonfly darts) */
  turn?: number; accel?: number;
  /** hums its wings: periodic buzz sound while it's about */
  buzz?: boolean;
  /** swims at the sea surface instead of flying (sea turtle): flippers on the wing hinges, no shadow */
  swim?: boolean;
  animate?: (t: number, dt: number, phase: RigPhase, speed: number, flap: number) => void;
}

const SCALE = 1.55;
type V3 = [number, number, number];

class Kit {
  mats: THREE.MeshStandardNodeMaterial[] = [];
  m(hex: string, rough = 0.8, flat = true, glow = 0) {
    const m = new THREE.MeshStandardNodeMaterial({ color: hex, roughness: rough, metalness: 0, flatShading: flat });
    if (glow > 0) { m.emissive = new THREE.Color(hex); m.emissiveIntensity = glow; }
    this.mats.push(m); return m;
  }
  mesh(g: THREE.BufferGeometry, mt: THREE.Material, p: V3, s: V3 = [1, 1, 1], r: V3 = [0, 0, 0]) {
    const o = new THREE.Mesh(g, mt); o.position.set(...p); o.scale.set(...s); o.rotation.set(...r); return o;
  }
  sph(r: number, w = 14, h = 10) { return new THREE.SphereGeometry(r, w, h); }
  /** thin flat membrane from (x, z) outline points, lying in the XZ plane */
  membrane(pts: [number, number][], thick = 0.035) {
    const sh = new THREE.Shape();
    pts.forEach(([x, z], i) => (i ? sh.lineTo(x, -z) : sh.moveTo(x, -z)));
    const g = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: false });
    g.rotateX(-Math.PI / 2); g.translate(0, -thick / 2, 0);
    return g;
  }
}

function empty(id: MountId, k: Kit): MountRig {
  return {
    id, body: new THREE.Group(), head: new THREE.Group(), wingL: new THREE.Group(), wingR: new THREE.Group(),
    tipL: new THREE.Group(), tipR: new THREE.Group(), tail: new THREE.Group(), legs: new THREE.Group(),
    mats: k.mats, seat: new THREE.Vector3(0, 0.36, -0.02), amp: 1, rate: 1, shadow: 1, fanTail: true,
  };
}
function finish(r: MountRig, scale = SCALE) {
  r.body.add(r.head, r.tail, r.legs, r.wingL, r.wingR);
  r.body.scale.setScalar(scale);
  r.body.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  return r;
}
/** two eyes with a shine, on a head group */
function eyes(k: Kit, head: THREE.Group, x: number, y: number, z: number, r = 0.05) {
  const eye = k.m('#2a1a12', 0.3, false), shine = k.m('#ffffff', 0.2, false);
  for (const s of [-1, 1]) {
    head.add(k.mesh(k.sph(r, 10, 8), eye, [s * x, y, z]));
    head.add(k.mesh(k.sph(r * 0.33, 6, 5), shine, [s * (x + r * 0.3), y + r * 0.5, z + r * 0.8]));
  }
}

// ------------------------------------------------------------ bald eagle (free)
function eagle(): MountRig {
  const k = new Kit(), r = empty('eagle', k);
  const brown = k.m('#6b4630'), dark = k.m('#4a2e1f'), white = k.m('#fbf7ee', 0.6, false), gold = k.m('#f2b13b', 0.45, false), feather = k.m('#7d5438');
  const { body, head, tail, legs } = r;
  body.add(k.mesh(k.sph(0.42), brown, [0, 0, 0], [0.95, 0.78, 1.45]));
  body.add(k.mesh(k.sph(0.3), feather, [0, -0.08, 0.22], [1, 0.8, 1.1]));
  body.add(k.mesh(k.sph(0.2, 10, 8), k.m('#c9a26b', 0.9), [0, 0.27, -0.02], [1.1, 0.35, 1.3]));
  head.position.set(0, 0.24, 0.6);
  head.add(k.mesh(k.sph(0.27), white, [0, 0.06, 0.02], [1, 0.95, 1.05]));
  head.add(k.mesh(k.sph(0.22), white, [0, -0.06, -0.12], [1.1, 0.9, 1]));
  const beak = new THREE.ConeGeometry(0.075, 0.24, 8); beak.rotateX(Math.PI / 2);
  head.add(k.mesh(beak, gold, [0, 0.0, 0.3]));
  head.add(k.mesh(k.sph(0.06, 8, 6), gold, [0, -0.03, 0.4], [1, 0.8, 1]));
  eyes(k, head, 0.15, 0.1, 0.18);
  for (const s of [-1, 1]) head.add(k.mesh(k.sph(0.045, 8, 6), brown, [s * 0.14, 0.17, 0.14], [1.4, 0.45, 1], [0, 0, s * -0.3]));
  tail.position.set(0, 0.04, -0.6);
  for (let i = -2; i <= 2; i++) tail.add(k.mesh(new THREE.BoxGeometry(0.12, 0.035, 0.5), white, [i * 0.075, 0, -0.22], [1, 1, 1], [0, i * 0.18, 0]));
  for (const s of [-1, 1]) {
    legs.add(k.mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.26, 6), gold, [s * 0.14, -0.32, 0.06]));
    legs.add(k.mesh(k.sph(0.065, 8, 6), gold, [s * 0.14, -0.46, 0.12], [1, 0.6, 1.3]));
  }
  const wing = (root: THREE.Group, tip: THREE.Group, s: number) => {
    root.position.set(s * 0.3, 0.14, 0.06);
    root.add(k.mesh(new THREE.BoxGeometry(0.95, 0.07, 0.62), brown, [s * 0.47, 0, -0.02]));
    root.add(k.mesh(new THREE.BoxGeometry(0.8, 0.075, 0.24), dark, [s * 0.45, 0.01, 0.22]));
    tip.position.set(s * 0.93, 0, -0.03);
    tip.add(k.mesh(new THREE.BoxGeometry(0.55, 0.05, 0.5), dark, [s * 0.27, 0, -0.04]));
    for (let i = 0; i < 4; i++) tip.add(k.mesh(new THREE.BoxGeometry(0.34, 0.03, 0.1), dark, [s * (0.6 + i * 0.02), 0, 0.13 - i * 0.12], [1, 1, 1], [0, s * (-0.12 - i * 0.12), 0]));
    root.add(tip);
  };
  wing(r.wingL, r.tipL, 1); wing(r.wingR, r.tipR, -1);
  return finish(r);
}

// ------------------------------------------------------------ pterodactyl (pterodactyl_egg)
function pterodactyl(): MountRig {
  const k = new Kit(), r = empty('pterodactyl', k);
  const teal = k.m('#5cae97'), back = k.m('#78c4ad'), deep = k.m('#3f7f73'), belly = k.m('#f0e2bd', 0.85),
    crest = k.m('#ff8f4f', 0.6, true, 0.08), beakM = k.m('#f7cf82', 0.5, false), skin = k.m('#a6e3cf', 0.7, true, 0.14), spot = k.m('#4a8f80');
  skin.side = THREE.DoubleSide;
  const { body, head, tail, legs } = r;
  r.seat.set(0, 0.34, -0.06); r.amp = 0.9; r.rate = 0.82; r.shadow = 1.25; r.fanTail = false;
  body.add(k.mesh(k.sph(0.4), teal, [0, 0, 0], [0.85, 0.72, 1.5]));
  body.add(k.mesh(k.sph(0.3), back, [0, 0.12, -0.05], [0.95, 0.5, 1.3]));
  body.add(k.mesh(k.sph(0.28), belly, [0, -0.13, 0.08], [0.95, 0.6, 1.25]));
  // freckles along the back
  for (let i = 0; i < 5; i++) for (const s of [-1, 1]) body.add(k.mesh(k.sph(0.035, 6, 5), spot, [s * (0.12 + (i % 2) * 0.05), 0.24 - i * 0.012, 0.25 - i * 0.14], [1, 0.4, 1]));
  // neck → head with a long friendly beak and a big swept-back crest
  const neck = new THREE.CylinderGeometry(0.12, 0.17, 0.45, 10); neck.rotateX(Math.PI / 2 - 0.7);
  body.add(k.mesh(neck, teal, [0, 0.16, 0.56]));
  head.position.set(0, 0.36, 0.78);
  head.add(k.mesh(k.sph(0.2), teal, [0, 0, 0], [0.95, 0.9, 1.15]));
  const bk = new THREE.ConeGeometry(0.1, 0.62, 10); bk.rotateX(Math.PI / 2);
  head.add(k.mesh(bk, beakM, [0, -0.04, 0.42], [1, 0.75, 1]));
  head.add(k.mesh(new THREE.BoxGeometry(0.1, 0.012, 0.36), k.m('#b07f45', 0.6), [0, -0.055, 0.32])); // smile line
  const cr = new THREE.ConeGeometry(0.14, 0.6, 4); cr.rotateX(-Math.PI / 2 + 0.35);
  head.add(k.mesh(cr, crest, [0, 0.14, -0.32], [0.35, 1, 1]));
  eyes(k, head, 0.13, 0.06, 0.1, 0.055);
  for (const s of [-1, 1]) head.add(k.mesh(k.sph(0.04, 8, 6), k.m('#ff9fae', 0.9, false), [s * 0.15, -0.04, 0.12], [1, 0.6, 1])); // blush
  // long tail with a diamond tip
  tail.position.set(0, 0.0, -0.58);
  const tl = new THREE.CylinderGeometry(0.025, 0.09, 0.8, 8); tl.rotateX(Math.PI / 2);
  tail.add(k.mesh(tl, teal, [0, 0, -0.36]));
  tail.add(k.mesh(new THREE.OctahedronGeometry(0.12, 0), crest, [0, 0, -0.8], [0.25, 1, 1.2]));
  // little tucked feet
  for (const s of [-1, 1]) {
    legs.add(k.mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.2, 6), deep, [s * 0.12, -0.28, -0.22]));
    legs.add(k.mesh(k.sph(0.055, 8, 6), beakM, [s * 0.12, -0.38, -0.18], [1, 0.5, 1.4]));
  }
  // membrane wings: bony leading edge, a little claw at the wrist, then a long pointed tip
  const wing = (root: THREE.Group, tip: THREE.Group, s: number) => {
    root.position.set(s * 0.26, 0.12, 0.1);
    root.add(k.mesh(k.membrane([[0, 0.12], [1.0, 0.1], [1.0, -0.12], [0.55, -0.42], [0, -0.55]].map(([x, z]) => [s * x, z] as [number, number])), skin, [0, 0, 0]));
    const bone = new THREE.CylinderGeometry(0.045, 0.06, 1.0, 8); bone.rotateZ(Math.PI / 2);
    root.add(k.mesh(bone, teal, [s * 0.5, 0.01, 0.12]));
    root.add(k.mesh(new THREE.ConeGeometry(0.03, 0.12, 6), beakM, [s * 1.0, 0.0, 0.2], [1, 1, 1], [Math.PI / 2, 0, 0])); // wrist claw
    tip.position.set(s * 1.0, 0, 0.0);
    tip.add(k.mesh(k.membrane([[0, 0.12], [0.98, -0.06], [0.4, -0.26], [0, -0.3]].map(([x, z]) => [s * x, z] as [number, number])), skin, [0, 0, 0]));
    const tb = new THREE.CylinderGeometry(0.018, 0.045, 0.95, 6); tb.rotateZ(Math.PI / 2);
    tip.add(k.mesh(tb, teal, [s * 0.47, 0.01, 0.02], [1, 1, 1], [0, s * 0.22, 0]));
    root.add(tip);
  };
  wing(r.wingL, r.tipL, 1); wing(r.wingR, r.tipR, -1);
  // crest bobs and the tail swishes
  r.animate = (t, _dt, ph) => {
    tail.rotation.y = Math.sin(t * 2.2) * (ph === 'wait' ? 0.35 : 0.15);
    tail.rotation.x = ph === 'wait' ? 0.15 : 0;
    head.rotation.x = Math.sin(t * 1.4) * 0.06;
  };
  return finish(r);
}

// ------------------------------------------------------------ cloud puppy (cloud_puppy_tuft)
function cloudPuppy(): MountRig {
  const k = new Kit(), r = empty('cloud_puppy', k);
  const fluff = k.m('#f7fbff', 1, false, 0.06), shade = k.m('#dce9f7', 1, false), blue = k.m('#bcd6f2', 1, false),
    ink = k.m('#2a2230', 0.3, false), tongue = k.m('#ff8fa6', 0.6, false), blush = k.m('#ffc2d1', 0.9, false);
  const { body, head, tail, legs } = r;
  r.seat.set(0, 0.42, -0.06); r.amp = 0.75; r.rate = 1.25; r.shadow = 1.1; r.fanTail = false;
  // a cuddly cloud body made of puffs
  const puffs: [V3, number, THREE.Material][] = [
    [[0, 0, 0], 0.36, fluff], [[0, 0.05, 0.3], 0.3, fluff], [[0, 0.04, -0.3], 0.31, fluff], [[0.2, -0.04, 0.05], 0.26, shade],
    [[-0.2, -0.04, 0.05], 0.26, shade], [[0.17, 0.12, -0.18], 0.2, fluff], [[-0.17, 0.12, -0.18], 0.2, fluff], [[0, -0.16, 0.0], 0.27, blue],
    [[0.15, 0.1, 0.25], 0.18, fluff], [[-0.15, 0.1, 0.25], 0.18, fluff],
  ];
  for (const [p, rr, mt] of puffs) body.add(k.mesh(k.sph(rr, 16, 12), mt, p));
  // puppy head: round, big eyes, black nose, floppy ears, tongue out
  head.position.set(0, 0.26, 0.58);
  head.add(k.mesh(k.sph(0.3, 18, 14), fluff, [0, 0.04, 0], [1.05, 0.95, 1]));
  head.add(k.mesh(k.sph(0.15, 14, 10), shade, [0, -0.04, 0.2], [1.1, 0.8, 0.9])); // muzzle
  head.add(k.mesh(k.sph(0.05, 10, 8), ink, [0, 0.02, 0.33], [1.3, 0.9, 1]));    // nose
  head.add(k.mesh(k.sph(0.014, 6, 5), k.m('#ffffff', 0.2, false), [0.02, 0.04, 0.37]));
  const tg = k.mesh(k.sph(0.05, 10, 8), tongue, [0.03, -0.13, 0.27], [0.9, 0.5, 1.2]); head.add(tg);
  eyes(k, head, 0.11, 0.1, 0.22, 0.05);
  for (const s of [-1, 1]) head.add(k.mesh(k.sph(0.045, 8, 6), blush, [s * 0.17, -0.02, 0.18], [1, 0.6, 0.6]));
  const ears: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const e = new THREE.Group(); e.position.set(s * 0.2, 0.16, -0.02);
    e.add(k.mesh(k.sph(0.1, 12, 10), blue, [s * 0.05, -0.12, 0], [0.7, 1.4, 0.45]));
    head.add(e); ears.push(e);
  }
  // fluffy puff tail
  tail.position.set(0, 0.16, -0.55);
  tail.add(k.mesh(k.sph(0.08, 10, 8), fluff, [0, 0.06, -0.04]));
  tail.add(k.mesh(k.sph(0.13, 14, 10), fluff, [0, 0.16, -0.1]));
  // four little puff paws
  for (const [x, z] of [[0.17, 0.28], [-0.17, 0.28], [0.17, -0.25], [-0.17, -0.25]]) legs.add(k.mesh(k.sph(0.1, 12, 10), shade, [x, -0.32, z], [1, 0.8, 1.1]));
  // cloud wings: a row of shrinking puffs on each side
  const wing = (root: THREE.Group, tip: THREE.Group, s: number) => {
    root.position.set(s * 0.26, 0.18, 0.02);
    root.add(k.mesh(k.sph(0.17, 14, 10), fluff, [s * 0.12, 0, 0.02], [1, 0.75, 1.15]));
    root.add(k.mesh(k.sph(0.15, 14, 10), shade, [s * 0.3, 0.03, -0.06], [1, 0.75, 1.1]));
    root.add(k.mesh(k.sph(0.12, 12, 8), fluff, [s * 0.24, 0.04, 0.12], [1, 0.75, 1]));
    tip.position.set(s * 0.4, 0.02, -0.04);
    tip.add(k.mesh(k.sph(0.12, 12, 10), fluff, [s * 0.1, 0, -0.02], [1, 0.75, 1.1]));
    tip.add(k.mesh(k.sph(0.085, 10, 8), shade, [s * 0.22, 0.02, -0.1], [1, 0.75, 1]));
    root.add(tip);
  };
  wing(r.wingL, r.tipL, 1); wing(r.wingR, r.tipR, -1);
  // happy tail wag, ears flop with the flap, tongue wiggles, body puffs breathe
  const kids = body.children.slice(0, puffs.length);
  r.animate = (t, _dt, ph, speed, flap) => {
    const wag = ph === 'wait' || ph === 'hop' ? 9 : 5;
    tail.rotation.y = Math.sin(t * wag) * 0.5;
    tail.rotation.z = Math.sin(t * wag) * 0.2;
    const flop = Math.sin(flap - 1.2) * 0.35 + Math.min(0.4, speed * 0.03);
    ears[0].rotation.z = -0.25 - flop * 0.6; ears[1].rotation.z = 0.25 + flop * 0.6;
    ears[0].rotation.x = ears[1].rotation.x = -Math.min(0.6, speed * 0.05);
    tg.position.y = -0.13 + Math.sin(t * 7) * 0.008;
    kids.forEach((c, i) => c.scale.setScalar(1 + Math.sin(t * 1.8 + i * 1.3) * 0.035));
  };
  return finish(r);
}

// ------------------------------------------------------------ unicorn (rainbow_horseshoe)
const RAINBOW = ['#ff6f7d', '#ffa64d', '#ffd84d', '#7fd67a', '#6fb8ff', '#b98cff'];
function unicorn(): MountRig {
  const k = new Kit(), r = empty('unicorn', k);
  const white = k.m('#fbf8ff', 0.6, false), shade = k.m('#e7e1f5', 0.7, false), hoof = k.m('#f2b13b', 0.4, false),
    horn = k.m('#ffd96b', 0.35, false, 0.35), pink = k.m('#ffc2d6', 0.8, false), lilac = k.m('#d9c6ff', 0.7), feather = k.m('#ffffff', 0.7);
  const rb = RAINBOW.map((c) => k.m(c, 0.55, false, 0.08));
  const { body, head, tail, legs } = r;
  r.seat.set(0, 0.4, -0.1); r.amp = 0.85; r.rate = 0.95; r.shadow = 1.2; r.fanTail = false;
  body.add(k.mesh(k.sph(0.4, 18, 14), white, [0, 0, 0], [0.82, 0.8, 1.45]));
  body.add(k.mesh(k.sph(0.3, 16, 12), shade, [0, -0.14, 0], [0.9, 0.55, 1.3]));
  // a little rainbow saddle blanket
  body.add(k.mesh(new THREE.BoxGeometry(0.5, 0.04, 0.42), rb[5], [0, 0.31, -0.08], [1, 1, 1], [0.05, 0, 0]));
  body.add(k.mesh(new THREE.BoxGeometry(0.52, 0.035, 0.12), rb[2], [0, 0.32, -0.08], [1, 1, 1], [0.05, 0, 0]));
  // neck rising up-forward, then the head
  const neck = new THREE.CylinderGeometry(0.15, 0.21, 0.5, 12); neck.rotateX(0.55);
  body.add(k.mesh(neck, white, [0, 0.22, 0.48]));
  // rainbow mane down the neck
  for (let i = 0; i < 6; i++) body.add(k.mesh(k.sph(0.08, 10, 8), rb[i], [0, 0.48 - i * 0.07, 0.48 - i * 0.075], [0.8, 1, 1.1]));
  head.position.set(0, 0.5, 0.66);
  head.add(k.mesh(k.sph(0.2, 16, 12), white, [0, 0, 0], [0.9, 0.95, 1.05]));
  head.add(k.mesh(k.sph(0.15, 14, 10), white, [0, -0.07, 0.2], [0.85, 0.75, 1.15])); // snout
  head.add(k.mesh(k.sph(0.07, 10, 8), pink, [0, -0.09, 0.32], [1.4, 0.7, 0.6]));     // soft nose
  for (const s of [-1, 1]) {
    head.add(k.mesh(k.sph(0.016, 6, 5), k.m('#c47a92', 0.6, false), [s * 0.045, -0.08, 0.36]));
    head.add(k.mesh(k.sph(0.04, 8, 6), pink, [s * 0.15, -0.05, 0.12], [1, 0.6, 0.6])); // blush
    const ear = new THREE.ConeGeometry(0.05, 0.14, 6);
    head.add(k.mesh(ear, white, [s * 0.1, 0.19, -0.04], [1, 1, 0.6], [0, 0, s * -0.25]));
    head.add(k.mesh(new THREE.BoxGeometry(0.05, 0.01, 0.012), k.m('#3a2a40', 0.4, false), [s * 0.15, 0.1, 0.14], [1, 1, 1], [0, 0, s * 0.35])); // lashes
  }
  eyes(k, head, 0.12, 0.05, 0.12, 0.05);
  // golden spiral horn
  const hg = new THREE.Group(); hg.position.set(0, 0.2, 0.1); hg.rotation.x = 0.45;
  hg.add(k.mesh(new THREE.ConeGeometry(0.05, 0.32, 10), horn, [0, 0.15, 0]));
  for (let i = 0; i < 3; i++) hg.add(k.mesh(new THREE.TorusGeometry(0.042 - i * 0.011, 0.01, 6, 14), horn, [0, 0.05 + i * 0.075, 0], [1, 1, 1], [Math.PI / 2 + 0.3, 0, 0]));
  head.add(hg);
  // forelock
  head.add(k.mesh(k.sph(0.06, 8, 6), rb[0], [0, 0.17, -0.06]));
  head.add(k.mesh(k.sph(0.05, 8, 6), rb[4], [0.05, 0.14, -0.1]));
  // flowing rainbow tail: one strand per colour
  tail.position.set(0, 0.12, -0.55);
  const strands: THREE.Mesh[] = [];
  RAINBOW.forEach((_, i) => {
    const g = new THREE.CapsuleGeometry(0.045, 0.42, 4, 8); g.rotateX(Math.PI / 2); g.translate(0, 0, -0.24);
    const m = k.mesh(g, rb[i], [(i - 2.5) * 0.035, -0.02 * i, 0], [1, 1, 1], [-0.3 - i * 0.04, (i - 2.5) * 0.08, 0]);
    tail.add(m); strands.push(m);
  });
  // legs tucked like a leaping horse, golden hooves
  for (const [x, z, fore] of [[0.14, 0.32, 1], [-0.14, 0.32, 1], [0.14, -0.3, 0], [-0.14, -0.3, 0]] as [number, number, number][]) {
    const lg = new THREE.Group(); lg.position.set(x, -0.2, z); lg.rotation.x = fore ? -0.9 : 0.8;
    lg.add(k.mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.32, 8), white, [0, -0.16, 0]));
    lg.add(k.mesh(new THREE.CylinderGeometry(0.06, 0.065, 0.07, 8), hoof, [0, -0.34, 0]));
    legs.add(lg);
  }
  // feathered pastel wings
  const wing = (root: THREE.Group, tip: THREE.Group, s: number) => {
    root.position.set(s * 0.26, 0.2, 0.12);
    root.add(k.mesh(new THREE.BoxGeometry(0.8, 0.06, 0.5), feather, [s * 0.4, 0, -0.02]));
    root.add(k.mesh(new THREE.BoxGeometry(0.7, 0.065, 0.2), lilac, [s * 0.38, 0.01, 0.18]));
    tip.position.set(s * 0.78, 0, -0.03);
    tip.add(k.mesh(new THREE.BoxGeometry(0.45, 0.05, 0.42), feather, [s * 0.22, 0, -0.04]));
    for (let i = 0; i < 4; i++) tip.add(k.mesh(new THREE.BoxGeometry(0.32, 0.03, 0.1), i % 2 ? lilac : rb[(i + 3) % 6], [s * (0.5 + i * 0.02), 0, 0.1 - i * 0.1], [1, 1, 1], [0, s * (-0.12 - i * 0.12), 0]));
    root.add(tip);
  };
  wing(r.wingL, r.tipL, 1); wing(r.wingR, r.tipR, -1);
  // tail strands ripple, horn shimmers
  r.animate = (t, _dt, ph, speed) => {
    strands.forEach((m, i) => { m.rotation.x = -0.3 - i * 0.04 + Math.sin(t * 3 + i * 0.6) * 0.12 - Math.min(0.3, speed * 0.02); m.rotation.y = (i - 2.5) * 0.08 + Math.sin(t * 2.2 + i) * 0.06; });
    horn.emissiveIntensity = 0.3 + Math.sin(t * 3) * 0.15 + (ph === 'wait' ? 0.15 : 0);
  };
  return finish(r);
}

// ------------------------------------------------------------ dragonfly (shimmer_wing)
function dragonfly(): MountRig {
  const k = new Kit(), r = empty('dragonfly', k);
  const teal = k.m('#2fae9c', 0.35, false), deep = k.m('#1d6f73', 0.4, false), aqua = k.m('#6fe0c8', 0.3, false, 0.12),
    eyeM = k.m('#7b5cff', 0.15, false, 0.18), shine = k.m('#ffffff', 0.1, false), leg = k.m('#21333a', 0.6), gold = k.m('#ffd96b', 0.3, false, 0.25);
  // iridescent see-through wings (Mount.setAlpha keeps their base opacity)
  const wingM = new THREE.MeshStandardNodeMaterial({ color: '#dff6ff', roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
  wingM.emissive = new THREE.Color('#9fd8ff'); wingM.emissiveIntensity = 0.18; wingM.userData.baseOpacity = 0.55;
  const veinM = k.m('#7cc6e6', 0.3, false, 0.15); const tipM = k.m('#6a5acd', 0.4, false);
  k.mats.push(wingM);
  const { body, head, tail, legs } = r;
  r.seat.set(0, 0.3, -0.04); r.amp = 0.42; r.rate = 4.2; r.shadow = 1.15; r.fanTail = false;
  r.turn = 2.2; r.accel = 2.2; r.buzz = true;
  // thorax: a glossy teal bead with a gold stripe
  body.add(k.mesh(k.sph(0.3, 18, 14), teal, [0, 0, 0], [0.95, 0.85, 1.25]));
  body.add(k.mesh(k.sph(0.22, 14, 10), deep, [0, -0.1, 0.02], [1, 0.6, 1.1]));
  for (const s of [-1, 1]) body.add(k.mesh(new THREE.BoxGeometry(0.03, 0.2, 0.32), gold, [s * 0.24, 0.05, 0], [1, 1, 1], [0, 0, s * 0.35]));
  // long segmented abdomen with glowing aqua bands
  tail.position.set(0, 0.02, -0.34);
  const segs: THREE.Group[] = [];
  let parent: THREE.Group = tail;
  for (let i = 0; i < 7; i++) {
    const sg = new THREE.Group(); sg.position.set(0, 0, i === 0 ? 0 : -0.2);
    const rr = 0.12 - i * 0.008;
    sg.add(k.mesh(new THREE.CapsuleGeometry(rr, 0.12, 4, 10).rotateX(Math.PI / 2), i % 2 ? deep : teal, [0, 0, -0.1]));
    sg.add(k.mesh(new THREE.TorusGeometry(rr * 0.98, 0.018, 6, 14), aqua, [0, 0, -0.02]));
    parent.add(sg); segs.push(sg); parent = sg;
  }
  // little tail claspers
  for (const s of [-1, 1]) parent.add(k.mesh(new THREE.ConeGeometry(0.025, 0.14, 6).rotateX(-Math.PI / 2), deep, [s * 0.04, 0, -0.27], [1, 1, 1], [0, s * 0.3, 0]));
  // head: two huge shiny compound eyes and a happy smile
  head.position.set(0, 0.08, 0.42);
  head.add(k.mesh(k.sph(0.16, 14, 10), teal, [0, 0, 0.02], [1.1, 0.9, 0.9]));
  for (const s of [-1, 1]) {
    head.add(k.mesh(k.sph(0.15, 18, 14), eyeM, [s * 0.12, 0.08, 0.06]));
    head.add(k.mesh(k.sph(0.04, 8, 6), shine, [s * 0.15, 0.17, 0.14]));
    head.add(k.mesh(k.sph(0.02, 6, 5), shine, [s * 0.08, 0.12, 0.18]));
    head.add(k.mesh(k.sph(0.035, 8, 6), k.m('#ffb3c7', 0.8, false), [s * 0.1, -0.06, 0.14], [1, 0.6, 0.6])); // blush
  }
  head.add(k.mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 12, Math.PI), leg, [0, -0.06, 0.15], [1, 1, 1], [0, 0, Math.PI]));
  // six thin legs tucked under the thorax
  for (const z of [0.14, 0, -0.14]) for (const s of [-1, 1]) {
    const lg = new THREE.Group(); lg.position.set(s * 0.12, -0.18, z); lg.rotation.z = s * 0.5;
    lg.add(k.mesh(new THREE.CylinderGeometry(0.014, 0.012, 0.22, 5), leg, [0, -0.1, 0]));
    lg.add(k.mesh(new THREE.CylinderGeometry(0.011, 0.009, 0.18, 5), leg, [s * -0.05, -0.24, 0.03], [1, 1, 1], [0.3, 0, s * -0.9]));
    legs.add(lg);
  }
  // four long wings: forewings on the flap hinge, hindwings on their own hinge (driven out of phase in animate)
  const wingShape = (len: number, w: number, s: number) => k.membrane([[0, w * 0.35], [len * 0.35, w * 0.55], [len * 0.85, w * 0.4], [len, 0], [len * 0.85, -w * 0.4], [len * 0.35, -w * 0.5], [0, -w * 0.3]].map(([x, z]) => [s * x, z] as [number, number]), 0.012);
  const addWing = (g: THREE.Group, len: number, w: number, s: number) => {
    g.add(k.mesh(wingShape(len, w, s), wingM, [0, 0, 0]));
    const vein = new THREE.CylinderGeometry(0.008, 0.014, len, 5); vein.rotateZ(Math.PI / 2);
    g.add(k.mesh(vein, veinM, [s * len * 0.5, 0.008, w * 0.18]));
    g.add(k.mesh(new THREE.BoxGeometry(0.1, 0.014, 0.05), tipM, [s * len * 0.84, 0.008, w * 0.12])); // wing spot
  };
  const hind: THREE.Group[] = [];
  for (const [root, tip, s] of [[r.wingL, r.tipL, 1], [r.wingR, r.tipR, -1]] as [THREE.Group, THREE.Group, number][]) {
    root.position.set(s * 0.14, 0.2, 0.1); root.rotation.y = s * -0.12;
    addWing(root, 1.35, 0.34, s);
    tip.position.set(s * 1.35, 0, 0); root.add(tip);
    const h = new THREE.Group(); h.position.set(s * 0.14, 0.18, -0.12);
    addWing(h, 1.2, 0.36, s); body.add(h); hind.push(h);
  }
  // hindwings beat a quarter-cycle behind, the abdomen sways and dips, eyes glimmer, hover jitter
  r.animate = (t, _dt, ph, speed, flap) => {
    const amp = r.amp * (ph === 'wait' ? 0.75 : 0.62);
    const hb = Math.cos(flap - 1.5) * amp;
    hind[0].rotation.z = hb; hind[1].rotation.z = -hb;
    hind[0].rotation.y = 0.18; hind[1].rotation.y = -0.18;
    const sway = Math.sin(t * 2.4) * 0.05, dip = ph === 'wait' ? 0.06 + Math.sin(t * 3) * 0.04 : -Math.min(0.08, speed * 0.006);
    segs.forEach((g, i) => { g.rotation.y = sway * (1 + i * 0.2); g.rotation.x = dip; });
    eyeM.emissiveIntensity = 0.16 + Math.sin(t * 2.2) * 0.06;
    body.position.x = ph === 'wait' ? Math.sin(t * 13) * 0.012 : 0;
  };
  return finish(r, 1.5);
}

// ------------------------------------------------------------ sea turtle (sea_pearl, Shipwreck Cove)
function seaTurtle(): MountRig {
  const k = new Kit(), r = empty('sea_turtle', k);
  const shell = k.m('#4f9a62', 0.55), shellHi = k.m('#7cc489', 0.5), rim = k.m('#3b7a4c', 0.6), belly = k.m('#f1dfa0', 0.7),
    skin = k.m('#8fcf9c', 0.6), skinDk = k.m('#5d9f72', 0.65), pearl = k.m('#fbf4ff', 0.15, false, 0.35);
  const { body, head, tail, legs } = r;
  r.seat.set(0, 0.33, -0.04); r.amp = 0.75; r.rate = 0.42; r.shadow = 0; r.fanTail = false; r.swim = true;
  r.turn = 0.8; r.accel = 0.8;
  // domed shell with a ring of rim plates and lighter scutes on top, cream plastron underneath
  body.add(k.mesh(k.sph(0.62, 18, 12), shell, [0, 0, 0], [1, 0.42, 1.15]));
  body.add(k.mesh(k.sph(0.58, 16, 10), belly, [0, -0.07, 0.02], [0.95, 0.22, 1.08]));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    body.add(k.mesh(k.sph(0.12, 8, 6), rim, [Math.sin(a) * 0.6, -0.03, Math.cos(a) * 0.69], [1.1, 0.45, 1.1]));
  }
  body.add(k.mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.06, 6), shellHi, [0, 0.25, 0.02]));
  for (const [x, z] of [[0, 0.34], [0, -0.32], [0.3, 0.14], [-0.3, 0.14], [0.3, -0.16], [-0.3, -0.16]] as [number, number][])
    body.add(k.mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.05, 6), shellHi, [x, 0.2 - Math.hypot(x, z) * 0.12, z], [1, 1, 1], [z * -0.5, 0, x * 0.6]));
  // a little glowing pearl tucked on the shell's back, where you sit
  body.add(k.mesh(k.sph(0.05, 10, 8), pearl, [0, 0.28, -0.3]));
  // head on a short neck, big friendly eyes and a smile
  head.position.set(0, 0.04, 0.72);
  head.add(k.mesh(new THREE.CapsuleGeometry(0.11, 0.14, 4, 10).rotateX(Math.PI / 2), skin, [0, -0.02, -0.08]));
  head.add(k.mesh(k.sph(0.18, 14, 10), skin, [0, 0.03, 0.1], [0.95, 0.8, 1.1]));
  for (const s of [-1, 1]) head.add(k.mesh(k.sph(0.035, 8, 6), skinDk, [s * 0.08, 0.13, 0.12], [1, 0.5, 1]));
  eyes(k, head, 0.1, 0.07, 0.22, 0.045);
  head.add(k.mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 12, Math.PI), skinDk, [0, -0.04, 0.27], [1, 1, 1], [0, 0, Math.PI]));
  for (const s of [-1, 1]) head.add(k.mesh(k.sph(0.03, 8, 6), k.m('#ffb3c7', 0.8, false), [s * 0.13, -0.01, 0.2], [1, 0.6, 0.6]));
  // long front flippers on the wing hinges (they row like a sea turtle's), tips curl on the tip hinges
  const flipper = (len: number, w: number, s: number) => k.membrane([[0, w * 0.5], [len * 0.4, w * 0.62], [len * 0.85, w * 0.25], [len, -w * 0.05], [len * 0.7, -w * 0.3], [0, -w * 0.45]].map(([x, z]) => [s * x, z] as [number, number]), 0.06);
  for (const [root, tip, s] of [[r.wingL, r.tipL, 1], [r.wingR, r.tipR, -1]] as [THREE.Group, THREE.Group, number][]) {
    root.position.set(s * 0.46, -0.06, 0.38); root.rotation.y = s * 0.55;
    root.add(k.mesh(flipper(0.5, 0.26, s), skin, [0, 0, 0]));
    tip.position.set(s * 0.5, 0, 0); root.add(tip);
    tip.add(k.mesh(flipper(0.34, 0.16, s), skin, [0, 0, -0.01]));
    tip.add(k.mesh(k.sph(0.035, 6, 5), skinDk, [s * 0.12, 0.03, 0.02]));
  }
  // small back flippers paddle on the legs group, a stubby tail
  const back: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const g = new THREE.Group(); g.position.set(s * 0.36, -0.06, -0.58); g.rotation.y = s * -0.6;
    g.add(k.mesh(flipper(0.3, 0.2, s), skin, [0, 0, 0])); legs.add(g); back.push(g);
  }
  tail.position.set(0, -0.03, -0.72);
  tail.add(k.mesh(new THREE.ConeGeometry(0.06, 0.18, 6).rotateX(-Math.PI / 2), skin, [0, 0, -0.06]));
  // back flippers paddle half a stroke behind, the head bobs and peeks round, the pearl twinkles
  r.animate = (t, _dt, ph, speed, flap) => {
    const p = Math.cos(flap - Math.PI * 0.5) * (ph === 'wait' ? 0.18 : 0.3);
    back[0].rotation.z = -p; back[1].rotation.z = p;
    back[0].rotation.x = back[1].rotation.x = Math.sin(flap) * 0.15;
    head.position.y = 0.04 + Math.sin(t * 1.4) * 0.025 + (ph === 'wait' ? 0.04 : 0);
    head.position.z = 0.72 + Math.min(0.06, speed * 0.008);
    tail.rotation.y = Math.sin(t * 2.2) * 0.25;
    pearl.emissiveIntensity = 0.3 + Math.sin(t * 2.6) * 0.15;
  };
  return finish(r, 1.6);
}

export const BUILDERS: Record<MountId, () => MountRig> = { eagle, pterodactyl, cloud_puppy: cloudPuppy, unicorn, dragonfly, sea_turtle: seaTurtle };
