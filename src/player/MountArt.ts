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
  /** hot-air balloon (Order 47): drifts slowly and high, basket rests on the ground while it waits, Jump fires the burner */
  balloon?: boolean;
  /** Order 51a: a boat: floats on top of the water, oars on the wing hinges, Jump is a strong oar stroke (no dive), can cross to the islets */
  boat?: boolean;
  /** body-centre height above ground while waiting, and cruising height (defaults: 1.05 / 5.6) */
  waitAlt?: number; rideAlt?: number;
  /** speed multiplier for steering + tour (balloon drifts) */
  speedK?: number;
  /** burner heat 0..~6, set by Mount each frame (flame size) */
  heat?: number;
  animate?: (t: number, dt: number, phase: RigPhase, speed: number, flap: number) => void;
  /** Order 51c: current wake strength (0 = none), for tests */
  wake?: () => number;
}

export const SCALE = 1.55;
export type V3 = [number, number, number];

export class Kit {
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

export function empty(id: MountId, k: Kit): MountRig {
  return {
    id, body: new THREE.Group(), head: new THREE.Group(), wingL: new THREE.Group(), wingR: new THREE.Group(),
    tipL: new THREE.Group(), tipR: new THREE.Group(), tail: new THREE.Group(), legs: new THREE.Group(),
    mats: k.mats, seat: new THREE.Vector3(0, 0.36, -0.02), amp: 1, rate: 1, shadow: 1, fanTail: true,
  };
}
export function finish(r: MountRig, scale = SCALE) {
  r.body.add(r.head, r.tail, r.legs, r.wingL, r.wingR);
  r.body.scale.setScalar(scale);
  r.body.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  return r;
}
/** two eyes with a shine, on a head group */
export function eyes(k: Kit, head: THREE.Group, x: number, y: number, z: number, r = 0.05) {
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

/**
 * boat wake textures: `froth` tiles along the streak and scrolls back while rowing; `fade` (alpha map, static) is
 * bright at the stern, fading behind and soft at the sides. Shared canvas textures, made once.
 */
let _wake: { froth: THREE.CanvasTexture; fade: THREE.CanvasTexture } | null = null;
function wakeTex() {
  if (_wake) return _wake;
  const W = 32, H = 128;
  const make = (f: (u: number, v: number) => number) => {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d')!, img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const a = Math.round(255 * Math.max(0, Math.min(1, f(x / (W - 1), y / H)))), i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = a; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0); return new THREE.CanvasTexture(c);
  };
  const TAU = Math.PI * 2;
  const froth = make((u, v) => 0.86 + 0.14 * Math.sin(v * TAU * 6 + Math.sin(u * 9) * 2) * Math.sin(u * 23 + Math.sin(v * TAU * 2) * 3));
  froth.wrapT = THREE.RepeatWrapping; froth.colorSpace = THREE.SRGBColorSpace;
  // canvas row 0 is the far end of the streak (flipY), the last row sits at the stern
  const fade = make((u, v) => Math.sin(Math.PI * u) ** 1.5 * (0.2 + 0.8 * v) * Math.min(1, v * 5));
  _wake = { froth, fade };
  return _wake;
}

/** rowboat (Order 51a): planked wooden hull (origin = waterline), thwart seats, a bow ring, two oars on the wing hinges */
function rowboat(): MountRig {
  const k = new Kit(), r = empty('rowboat', k);
  const { body, head, tail } = r;
  r.seat.set(0, 0.12, -0.12); r.amp = 0.9; r.rate = 0.5; r.shadow = 0; r.fanTail = false; r.swim = true; r.boat = true;
  r.turn = 0.7; r.accel = 0.6; r.speedK = 1.05;
  const wood = k.m('#b07a48', 0.85), dark = k.m('#7a4e2c', 0.9), paint = k.m('#e8665a', 0.7), cream = k.m('#f4e6c8', 0.75), rope = k.m('#d9c08a', 0.9, false);
  // hull: the lower half of a stretched sphere, a painted stripe and a wooden gunwale rim
  const hullG = new THREE.SphereGeometry(0.5, 18, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  body.add(k.mesh(hullG, wood, [0, 0.16, 0], [0.82, 0.62, 1.45]));
  body.add(k.mesh(new THREE.TorusGeometry(0.5, 0.045, 6, 28), paint, [0, 0.12, 0], [0.82, 1.45, 1], [Math.PI / 2, 0, 0]));
  body.add(k.mesh(new THREE.TorusGeometry(0.5, 0.04, 6, 28), dark, [0, 0.17, 0], [0.82, 1.45, 1], [Math.PI / 2, 0, 0]));
  // floorboards, two thwarts and a little bow deck with a rope ring
  body.add(k.mesh(new THREE.BoxGeometry(0.42, 0.03, 1.0), dark, [0, -0.08, 0]));
  for (const z of [-0.12, 0.3]) body.add(k.mesh(new THREE.BoxGeometry(0.74, 0.04, 0.14), cream, [0, 0.08, z]));
  body.add(k.mesh(new THREE.BoxGeometry(0.3, 0.03, 0.18), wood, [0, 0.15, 0.6]));
  head.position.set(0, 0.2, 0.68);
  head.add(k.mesh(new THREE.TorusGeometry(0.05, 0.014, 6, 12), rope, [0, 0, 0], [1, 1, 1], [Math.PI / 2, 0, 0]));
  tail.position.set(0, 0.12, -0.7);
  tail.add(k.mesh(new THREE.BoxGeometry(0.34, 0.16, 0.04), wood, [0, 0, 0]));
  // oars in rowlocks on the wing hinges: the generic flap sweeps them, animate dips the blades
  const oars: THREE.Group[] = [];
  for (const [root, s] of [[r.wingL, 1], [r.wingR, -1]] as [THREE.Group, number][]) {
    root.position.set(s * 0.4, 0.18, 0.02);
    const oar = new THREE.Group(); root.add(oar); oars.push(oar);
    oar.add(k.mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.1, 6), wood, [s * 0.42, -0.1, 0], [1, 1, 1], [0, 0, s * 1.35]));
    oar.add(k.mesh(new THREE.BoxGeometry(0.22, 0.02, 0.1), paint, [s * 0.92, -0.2, 0], [1, 1, 1], [0, 0, s * 0.22]));
    root.add(k.mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.08, 6), dark, [0, 0.02, 0]));
  }
  // Order 51c: a foamy V wake trailing from the stern (own material, so call/leave fades don't touch it); one draw each
  const wakeMat = new THREE.MeshBasicNodeMaterial({ map: wakeTex().froth, alphaMap: wakeTex().fade, transparent: true, depthWrite: false, opacity: 0, color: 0xffffff });
  wakeMat.polygonOffset = true; wakeMat.polygonOffsetFactor = -2;
  // both V arms in one hand-built geometry (one draw): uv u across the arm, v = 0 at the stern, 1 at the far end
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (const sd of [1, -1]) {
    const a = sd * 0.3, dx = Math.sin(a), dz = -Math.cos(a), px = -dz, pz = dx, L = 2.6, hw = 0.21, x0 = sd * 0.2, b = pos.length / 3;
    for (const [t, v] of [[0, 0], [L, 1]]) for (const [w, u] of [[-hw, 0], [hw, 1]]) { pos.push(x0 + dx * t + px * w, 0, dz * t + pz * w); uv.push(u, v); }
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2, b, b + 2, b + 1, b + 1, b + 2, b + 3);
  }
  const wakeG = new THREE.BufferGeometry(); wakeG.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); wakeG.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); wakeG.setIndex(idx);
  const wake = new THREE.Mesh(wakeG, wakeMat); wake.position.set(0, -0.08, -0.55); wake.renderOrder = 2; body.add(wake); // just above the waterline (was under it: hidden from above)
  const bowG = new THREE.PlaneGeometry(0.5, 0.9); bowG.rotateX(-Math.PI / 2);
  const bow = new THREE.Mesh(bowG, wakeMat); bow.position.set(0, -0.13, 0.55); bow.renderOrder = 2; body.add(bow);
  wake.visible = bow.visible = false;
  r.wake = () => (wake.visible ? +wakeMat.opacity.toFixed(2) : 0);
  r.animate = (t, dt, ph, speed, flap) => {
    // wake: fades in with speed and scrolls back along the streaks
    const wa = ph === 'ride' ? Math.min(0.8, Math.max(0, speed - 0.4) * 0.16) : 0;
    wakeMat.opacity += (wa - wakeMat.opacity) * Math.min(1, dt * 3);
    wake.visible = bow.visible = wakeMat.opacity > 0.02;
    if (wake.visible && wakeMat.map) wakeMat.map.offset.y = (wakeMat.map.offset.y + dt * speed * 0.35) % 1;
    wake.rotation.x = -body.rotation.x; wake.rotation.z = -body.rotation.z;
    // a rowing stroke: sweep back with blades in, lift and return; resting oars trail in the water
    const row = ph === 'ride' && speed > 0.4 ? 1 : 0.15;
    for (let i = 0; i < 2; i++) { const s = i ? -1 : 1, o = oars[i]; o.rotation.y = s * Math.sin(flap) * 0.55 * row; o.rotation.x = 0; o.rotation.z = -s * Math.max(0, Math.cos(flap)) * 0.18 * row; }
    r.wingL.rotation.set(0, 0, 0); r.wingR.rotation.set(0, 0, 0);
    // gentle bob and roll on the swell
    body.rotation.z = Math.sin(t * 1.1) * 0.04; body.rotation.x = Math.sin(t * 0.8 + 1) * 0.025 - Math.min(0.05, speed * 0.006);
    head.rotation.set(0, 0, 0); tail.rotation.set(0, 0, 0);
  };
  finish(r, 1.5);
  wake.castShadow = bow.castShadow = false; // foam casts no shadow
  return r;
}

/**
 * Builders available right now. Eagle (the free default) and the rowboat (moored at the Home Dock from
 * the first frame) ship in the main bundle; the six treasure mounts live in MountArtExtra, a small lazy
 * chunk that is prefetched after first play and registers itself here.
 */
export const BUILDERS: Partial<Record<MountId, () => MountRig>> = { eagle, rowboat };
let extraP: Promise<void> | null = null;
/** download (once) and register the treasure-mount rigs */
export function loadMountArt(): Promise<void> {
  return (extraP ??= import('./MountArtExtra').then(({ EXTRA }) => { Object.assign(BUILDERS, EXTRA); }));
}
export const hasMountRig = (id: MountId) => !!BUILDERS[id];
