import * as THREE from 'three/webgpu';
import { Baker } from '../world/Baker';
import type { Slot } from '../game/Items';

/** Procedural low-poly wearables, built from primitives in the island's vertex-colour style. */
const sph = (r: number, w = 12, h = 9) => new THREE.SphereGeometry(r, w, h);
const hemi = (r: number) => new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
const cyl = (a: number, b: number, h: number, s = 16) => new THREE.CylinderGeometry(a, b, h, s);
const cone = (r: number, h: number, s = 12) => new THREE.ConeGeometry(r, h, s);
const torus = (r: number, t: number, rs = 8, ts = 20) => new THREE.TorusGeometry(r, t, rs, ts);
const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z);

const baseMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.62 });
const glowMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.35, emissive: new THREE.Color('#ffb000'), emissiveIntensity: 0.35 });

const caveMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.1, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.55 });
const beamMat = new THREE.MeshBasicNodeMaterial({ color: '#fff2b0', transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
function mesh(b: Baker, glow: boolean | 'cave' = false) {
  b.ao = false;
  const m = new THREE.Mesh(b.build(), glow === 'cave' ? caveMat : glow ? glowMat : baseMat);
  m.castShadow = true;
  return m;
}
function star(r: number, depth: number) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 + Math.PI / 2, rr = i % 2 ? r * 0.45 : r; i ? s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
}
function heart(r: number, depth: number) {
  const s = new THREE.Shape();
  s.moveTo(0, -r); s.bezierCurveTo(r * 1.4, -r * 0.1, r * 0.9, r * 1.1, 0, r * 0.45); s.bezierCurveTo(-r * 0.9, r * 1.1, -r * 1.4, -r * 0.1, 0, -r);
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
}

export interface Built { obj: THREE.Object3D; top?: number; anim?: (t: number, o: THREE.Object3D) => void; }
type Builder = () => Built;

// Positions are relative to the slot socket: hat/face/sprout = head centre (r 0.33),
// neck = collar, back = middle of the back.
const B: Record<string, Builder> = {
  // ---------------- hats ----------------
  straw: () => ({ obj: mesh(new Baker().add(cyl(0.5, 0.5, 0.03, 24), '#f2d27a', [0, 0.24, 0], [-0.12, 0, 0])
    .add(cyl(0.25, 0.28, 0.17, 20), '#f0c862', [0, 0.33, -0.02], [-0.12, 0, 0]).add(cyl(0.285, 0.285, 0.05, 20), '#e05a4a', [0, 0.28, -0.02], [-0.12, 0, 0])), top: 0.43 }),
  bucket: () => ({ obj: mesh(new Baker().add(cyl(0.31, 0.44, 0.12, 20), '#c9b48a', [0, 0.25, 0]).add(cyl(0.27, 0.31, 0.15, 20), '#d8c49a', [0, 0.38, 0])), top: 0.46 }),
  party: () => {
    const b = new Baker().add(cone(0.17, 0.44, 14), '#ff7eb6', [0.04, 0.5, 0], [0, 0, -0.18]);
    for (let i = 0; i < 3; i++) b.add(cyl(0.15 - i * 0.045, 0.16 - i * 0.045, 0.035, 14), '#ffe14d', [0.03 + i * 0.022, 0.38 + i * 0.11, 0], [0, 0, -0.18]);
    b.add(sph(0.06), '#7fc8ff', [0.12, 0.73, 0]);
    return { obj: mesh(b), top: 0.33 };
  },
  beanie: () => ({ obj: mesh(new Baker().add(hemi(0.355), '#e05a4a', [0, 0.06, 0], [0, 0, 0], [1, 1.02, 1]).add(torus(0.335, 0.05, 8, 24), '#c9443a', [0, 0.08, 0], [Math.PI / 2, 0, 0])
    .add(sph(0.08), '#f4f0e8', [0, 0.44, 0])), top: 0.5 }),
  chef: () => ({ obj: mesh(new Baker().add(cyl(0.26, 0.27, 0.2, 20), '#ffffff', [0, 0.34, 0]).add(sph(0.3, 14, 10), '#fbfbf6', [0, 0.53, 0], [0, 0, 0], [1, 0.6, 1])
    .add(sph(0.16), '#ffffff', [0.14, 0.6, 0.05]).add(sph(0.16), '#ffffff', [-0.13, 0.6, -0.03])), top: 0.7 }),
  mushcap: () => {
    const b = new Baker().add(hemi(0.5), '#e0402e', [0, 0.18, 0], [0, 0, 0], [1, 0.62, 1]);
    for (let i = 0; i < 7; i++) { const a = i * 0.9, r = i ? 0.3 : 0; b.add(sph(0.055, 8, 6), '#ffffff', [Math.cos(a) * r, 0.18 + Math.sqrt(Math.max(0, 0.25 - r * r)) * 0.62, Math.sin(a) * r], [0, 0, 0], [1, 0.4, 1]); }
    return { obj: mesh(b), top: 0.5 };
  },
  flowercrown: () => {
    const b = new Baker().add(torus(0.3, 0.025, 6, 24), '#5fae4a', [0, 0.2, 0], [Math.PI / 2 - 0.1, 0, 0]);
    const cols = ['#ff7eb6', '#ffd84d', '#ffffff', '#b98cff', '#ff9a5c'];
    for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; b.add(sph(0.065, 8, 6), cols[i % 5], [Math.cos(a) * 0.3, 0.2 + Math.sin(a) * 0.03, Math.sin(a) * 0.3]); }
    return { obj: mesh(b), top: 0.34 };
  },
  pirate: () => {
    const b = new Baker().add(hemi(0.32), '#2a2a32', [0, 0.18, 0], [0, 0, 0], [1, 0.7, 1]);
    for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2 + Math.PI / 2; b.add(box(0.5, 0.18, 0.04), '#2a2a32', [Math.cos(a) * 0.3, 0.27, Math.sin(a) * 0.3], [0.35, -a + Math.PI / 2, 0]); }
    b.add(sph(0.05), '#f4f0e8', [0, 0.32, 0.33]).add(box(0.12, 0.02, 0.01), '#f4f0e8', [0, 0.26, 0.335], [0, 0, 0.6]);
    return { obj: mesh(b), top: 0.42 };
  },
  frog: () => ({ obj: mesh(new Baker().add(hemi(0.37), '#5fbf4a', [0, -0.02, -0.02], [-0.15, 0, 0], [1.05, 1.05, 1.05])
    .add(sph(0.1), '#7fd65a', [-0.15, 0.33, 0.1]).add(sph(0.1), '#7fd65a', [0.15, 0.33, 0.1])
    .add(sph(0.06), '#ffffff', [-0.15, 0.36, 0.16]).add(sph(0.06), '#ffffff', [0.15, 0.36, 0.16])
    .add(sph(0.032), '#1a1a1a', [-0.15, 0.37, 0.21]).add(sph(0.032), '#1a1a1a', [0.15, 0.37, 0.21])), top: 0.44 }),
  tophat: () => ({ obj: mesh(new Baker().add(cyl(0.4, 0.4, 0.03, 24), '#2a2630', [0, 0.26, 0]).add(cyl(0.22, 0.22, 0.42, 20), '#2f2a36', [0, 0.48, 0])
    .add(cyl(0.225, 0.225, 0.07, 20), '#e05a4a', [0, 0.31, 0])), top: 0.69 }),
  wizard: () => {
    const b = new Baker().add(cyl(0.46, 0.46, 0.03, 24), '#3d4a9a', [0, 0.24, 0]).add(cone(0.3, 0.75, 16), '#4a5ab8', [0.05, 0.6, 0], [0, 0, -0.2]);
    for (let i = 0; i < 5; i++) b.add(sph(0.03, 6, 4), '#ffe14d', [Math.cos(i * 1.3) * 0.18, 0.4 + i * 0.07, Math.sin(i * 1.3) * 0.18 + 0.05]);
    return { obj: mesh(b), top: 0.33 };
  },
  viking: () => ({ obj: mesh(new Baker().add(hemi(0.36), '#a8acb4', [0, 0.04, 0]).add(torus(0.355, 0.035, 6, 24), '#c9a84a', [0, 0.05, 0], [Math.PI / 2, 0, 0])
    .add(cone(0.07, 0.32, 10), '#f4ead8', [-0.38, 0.28, 0], [0, 0, 0.7]).add(cone(0.07, 0.32, 10), '#f4ead8', [0.38, 0.28, 0], [0, 0, -0.7])), top: 0.42 }),
  crown: () => {
    const b = new Baker().add(cyl(0.27, 0.25, 0.14, 20), '#ffc93a', [0, 0.3, 0]);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; b.add(cone(0.06, 0.15, 6), '#ffc93a', [Math.cos(a) * 0.25, 0.44, Math.sin(a) * 0.25]); b.add(sph(0.035, 8, 6), i % 2 ? '#e0405a' : '#4a8aff', [Math.cos(a) * 0.27, 0.3, Math.sin(a) * 0.27]); }
    return { obj: mesh(b, true), top: 0.4 };
  },
  halo: () => ({ obj: mesh(new Baker().add(torus(0.27, 0.035, 8, 28), '#ffe27a', [0, 0.62, 0], [Math.PI / 2, 0, 0]), true), top: 0.33,
    anim: (t, o) => { o.position.y = Math.sin(t * 2) * 0.03; o.rotation.y = t * 0.6; } }),
  // ---------------- seaside set ----------------
  sailor: () => ({ obj: mesh(new Baker().add(cyl(0.3, 0.27, 0.16, 20), '#ffffff', [0, 0.3, 0], [-0.1, 0, 0]).add(cyl(0.305, 0.305, 0.05, 20), '#2f4f9a', [0, 0.24, 0], [-0.1, 0, 0])
    .add(cyl(0.02, 0.02, 0.01, 8), '#e05a4a', [0, 0.3, 0.3], [Math.PI / 2 - 0.1, 0, 0])), top: 0.4 }),
  captain: () => ({ obj: mesh(new Baker().add(cyl(0.3, 0.3, 0.13, 20), '#ffffff', [0, 0.36, 0], [-0.08, 0, 0], [1.1, 1, 1.1]).add(cyl(0.3, 0.3, 0.06, 20), '#1f2a4a', [0, 0.28, 0], [-0.08, 0, 0])
    .add(sph(0.2, 14, 6), '#1f2a4a', [0, 0.25, 0.25], [0, 0, 0], [1, 0.12, 0.7]).add(sph(0.045, 8, 6), '#ffc93a', [0, 0.32, 0.31])), top: 0.44 }),
  fishhat: () => {
    const b = new Baker().add(sph(0.3, 14, 10), '#ff9a3c', [0, 0.32, 0], [0, 0, 0], [0.75, 0.55, 1.15])
      .add(sph(0.1, 10, 6), '#ffffff', [0, 0.33, 0.05], [0, 0, 0], [0.77, 0.5, 0.2])
      .add(cone(0.16, 0.22, 4), '#ff7a2a', [0, 0.34, -0.42], [-Math.PI / 2, 0, 0], [1, 1, 0.25])
      .add(sph(0.05, 8, 6), '#ffffff', [0.2, 0.38, 0.22]).add(sph(0.05, 8, 6), '#ffffff', [-0.2, 0.38, 0.22])
      .add(sph(0.026, 6, 4), '#1a1a1a', [0.23, 0.38, 0.25]).add(sph(0.026, 6, 4), '#1a1a1a', [-0.23, 0.38, 0.25]);
    return { obj: mesh(b), top: 0.5, anim: (t, o) => { o.rotation.y = Math.sin(t * 3) * 0.08; } };
  },
  coralcrown: () => {
    const b = new Baker().add(torus(0.29, 0.035, 6, 24), '#ff8fa3', [0, 0.22, 0], [Math.PI / 2 - 0.08, 0, 0]);
    const cols = ['#ff6f91', '#ff9a3c', '#a46cff', '#ffd23f', '#3fd6c6'];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2, x = Math.cos(a) * 0.28, z = Math.sin(a) * 0.28, c = cols[i % 5];
      b.add(cyl(0.022, 0.03, 0.2, 6), c, [x, 0.32, z], [0, 0, 0.2 * Math.cos(a)]).add(cyl(0.016, 0.02, 0.1, 6), c, [x + 0.04, 0.4, z], [0, 0, -0.7]).add(sph(0.03, 6, 4), c, [x, 0.43, z]);
    }
    b.add(sph(0.05, 10, 8), '#f8f4ff', [0, 0.25, 0.31]);
    return { obj: mesh(b), top: 0.42 };
  },
  goggles: () => ({ obj: mesh(new Baker().add(sph(0.075, 10, 8), '#6fe0ff', [-0.11, 0.03, 0.31], [0, 0, 0], [1, 0.85, 0.45]).add(sph(0.075, 10, 8), '#6fe0ff', [0.11, 0.03, 0.31], [0, 0, 0], [1, 0.85, 0.45])
    .add(torus(0.335, 0.018, 6, 28), '#ff7a2a', [0, 0.03, 0], [Math.PI / 2, 0, 0])) }),
  kelpscarf: () => scarf(['#3f9a5a', '#5fbf6a', '#2f7a4a']),
  shellneck: () => {
    const b = new Baker().add(torus(0.26, 0.012, 4, 24), '#c9a87a', [0, 0, 0], [Math.PI / 2, 0, 0]);
    const cols = ['#ffd9c9', '#ffb8a8', '#fff2dc'];
    for (let i = 0; i < 5; i++) { const a = Math.PI / 2 + (i - 2) * 0.42; b.add(cone(0.05, 0.1, 8), cols[i % 3], [Math.cos(a) * 0.27, -0.05 - (2 - Math.abs(i - 2)) * 0.02, Math.sin(a) * 0.27], [Math.PI, 0, 0]); }
    return { obj: mesh(b) };
  },
  pearls: () => {
    const b = new Baker();
    for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; b.add(sph(0.035, 8, 6), '#fbf6f0', [Math.cos(a) * 0.27, -Math.max(0, Math.sin(a)) * 0.08, Math.sin(a) * 0.27]); }
    b.add(sph(0.06, 10, 8), '#ffe8f0', [0, -0.12, 0.27]);
    return { obj: mesh(b, true) };
  },
  floatie: () => ({ obj: mesh(new Baker().add(torus(0.4, 0.12, 8, 22), '#ffd84d', [0, -0.2, 0.3], [Math.PI / 2, 0, 0])
    .add(sph(0.12, 10, 8), '#ffd84d', [0, -0.05, 0.78]).add(cone(0.05, 0.1, 6), '#ff9a2e', [0, -0.07, 0.92], [Math.PI / 2, 0, 0])
    .add(sph(0.022, 6, 4), '#1a1a1a', [0.07, -0.01, 0.86]).add(sph(0.022, 6, 4), '#1a1a1a', [-0.07, -0.01, 0.86])),
    anim: (t, o) => { o.rotation.z = Math.sin(t * 1.7) * 0.04; } }),
  // ---------------- cave set ----------------
  minerhelmet: () => {
    const g = new THREE.Group();
    g.add(mesh(new Baker().add(hemi(0.36), '#ffc93a', [0, 0.12, 0], [-0.05, 0, 0], [1, 0.95, 1.05]).add(cyl(0.4, 0.4, 0.03, 20), '#e8a92a', [0, 0.13, -0.02], [-0.05, 0, 0])
      .add(box(0.05, 0.08, 0.3), '#e8a92a', [0, 0.44, -0.02], [-0.05, 0, 0])));
    const lamp = mesh(new Baker().add(cyl(0.07, 0.08, 0.08, 12), '#6a6a72', [0, 0.32, 0.33], [Math.PI / 2 - 0.15, 0, 0]).add(cyl(0.06, 0.06, 0.02, 12), '#fff6c0', [0, 0.32, 0.375], [Math.PI / 2 - 0.15, 0, 0]), 'cave');
    const beam = new THREE.Mesh(new THREE.ConeGeometry(0.42, 2.2, 14, 1, true).translate(0, -1.1, 0).rotateX(-Math.PI / 2 + 0.15), beamMat);
    beam.position.set(0, 0.32, 0.38); beam.castShadow = false;
    g.add(lamp, beam);
    return { obj: g, top: 0.5, anim: (t, o) => { const b = o.children[2] as THREE.Mesh; (b.material as THREE.MeshBasicNodeMaterial).opacity = 0.13 + Math.sin(t * 7) * 0.01 + Math.sin(t * 2.3) * 0.02; } };
  },
  crystalcrown: () => {
    const b = new Baker().add(torus(0.27, 0.04, 8, 24), '#e8c35a', [0, 0.27, 0], [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2, tall = i % 2 ? 0.12 : 0.2; b.add(new THREE.OctahedronGeometry(0.06, 0), i % 3 === 0 ? '#c99bff' : '#7ff0ff', [Math.cos(a) * 0.27, 0.3 + tall * 0.5, Math.sin(a) * 0.27], [0, a, 0], [0.7, tall / 0.06 * 0.5, 0.7]); }
    return { obj: mesh(b, 'cave'), top: 0.45, anim: (t, o) => { o.rotation.y = Math.sin(t * 0.8) * 0.06; } };
  },
  batwings: () => {
    const g = new THREE.Group();
    for (const s of [-1, 1]) {
      const b = new Baker();
      for (let k = 0; k < 3; k++) b.add(sph(0.16 - k * 0.025, 9, 5), k % 2 ? '#4a3a66' : '#5a4878', [s * (0.16 + k * 0.13), 0.06 - k * 0.05, 0], [0, 0, s * (0.2 + k * 0.25)], [1, 0.75, 0.08]);
      b.add(cyl(0.012, 0.012, 0.42, 5), '#2a2238', [s * 0.27, 0.1, 0.012], [0, 0, s * 1.35]);
      const w = mesh(b); w.userData.side = s; g.add(w);
    }
    g.position.z = -0.1;
    return { obj: g, anim: (t, o) => { for (const c of o.children) c.rotation.y = c.userData.side * (0.3 + Math.sin(t * 7) * 0.4); } };
  },
  crystalneck: () => ({ obj: mesh(new Baker().add(torus(0.24, 0.014, 5, 22), '#5a4a3a', [0, 0.02, 0], [Math.PI / 2 - 0.15, 0, 0])
    .add(new THREE.OctahedronGeometry(0.06, 0), '#7ff0ff', [0, -0.08, 0.25], [0, 0, 0], [0.7, 1.3, 0.7]), 'cave') }),
  glowsprout: () => {
    const b = new Baker().add(cyl(0.015, 0.02, 0.18, 6), '#cfe8e0', [0, 0.09, 0])
      .add(new THREE.SphereGeometry(0.09, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#5ff0e0', [0, 0.17, 0], [0, 0, 0], [1, 0.8, 1])
      .add(new THREE.SphereGeometry(0.05, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), '#a8fff0', [0.07, 0.1, 0.02], [0, 0, 0.4], [1, 0.8, 1]);
    return { obj: mesh(b, 'cave'), anim: (t, o) => { o.rotation.z = Math.sin(t * 2.1) * 0.1; } };
  },
  kelpsprout: () => sprout((b) => { for (let i = 0; i < 3; i++) b.add(new THREE.CapsuleGeometry(0.025, 0.16, 3, 6), i % 2 ? '#3f9a5a' : '#5fbf6a', [(i - 1) * 0.05, 0.2 + (i % 2) * 0.03, 0], [0, 0, (i - 1) * 0.35]); }, false, '#3f9a5a'),
  pearlsprout: () => sprout((b) => b.add(sph(0.06, 8, 6), '#ffb8c9', [0.05, 0.19, 0], [0, 0, 0.35], [1.2, 0.35, 1]).add(sph(0.06, 8, 6), '#ffb8c9', [0.05, 0.25, 0], [0, 0, -0.35], [1.2, 0.35, 1]).add(sph(0.045, 10, 8), '#fffaf4', [0.03, 0.22, 0.02]), true),
  // ---------------- face ----------------
  roundglasses: () => ({ obj: mesh(new Baker().add(torus(0.075, 0.014), '#5a3a2a', [-0.11, 0.02, 0.32]).add(torus(0.075, 0.014), '#5a3a2a', [0.11, 0.02, 0.32])
    .add(cyl(0.01, 0.01, 0.07, 6), '#5a3a2a', [0, 0.03, 0.33], [0, 0, Math.PI / 2])) }),
  rosy: () => ({ obj: mesh(new Baker().add(sph(0.075), '#ff7a90', [-0.19, -0.08, 0.27], [0, 0, 0], [1, 0.55, 0.3]).add(sph(0.075), '#ff7a90', [0.19, -0.08, 0.27], [0, 0, 0], [1, 0.55, 0.3])
    .add(sph(0.018), '#ffffff', [-0.11, 0.04, 0.33]).add(sph(0.018), '#ffffff', [0.13, 0.04, 0.33])) }),
  sunglasses: () => ({ obj: mesh(new Baker().add(box(0.15, 0.09, 0.03), '#1f1f26', [-0.11, 0.02, 0.32], [0, -0.25, 0]).add(box(0.15, 0.09, 0.03), '#1f1f26', [0.11, 0.02, 0.32], [0, 0.25, 0])
    .add(box(0.07, 0.02, 0.02), '#1f1f26', [0, 0.05, 0.335])) }),
  mustache: () => ({ obj: mesh(new Baker().add(new THREE.CapsuleGeometry(0.03, 0.09, 4, 8), '#6b4a2e', [-0.06, -0.08, 0.31], [0, 0, 1.2]).add(new THREE.CapsuleGeometry(0.03, 0.09, 4, 8), '#6b4a2e', [0.06, -0.08, 0.31], [0, 0, -1.2])) }),
  heartglasses: () => ({ obj: mesh(new Baker().add(heart(0.075, 0.02), '#ff4a7a', [-0.11, 0.02, 0.31]).add(heart(0.075, 0.02), '#ff4a7a', [0.11, 0.02, 0.31])
    .add(box(0.07, 0.015, 0.015), '#ff4a7a', [0, 0.04, 0.325])) }),
  monocle: () => ({ obj: mesh(new Baker().add(torus(0.075, 0.014), '#ffc93a', [0.11, 0.02, 0.32]).add(cyl(0.006, 0.006, 0.3, 4), '#ffc93a', [0.17, -0.12, 0.3], [0, 0, 0.3]), true) }),
  starglasses: () => ({ obj: mesh(new Baker().add(star(0.09, 0.02), '#ffd84d', [-0.11, 0.02, 0.31]).add(star(0.09, 0.02), '#ffd84d', [0.11, 0.02, 0.31])
    .add(box(0.07, 0.015, 0.015), '#ffb02e', [0, 0.04, 0.33])) }),
  snorkel: () => ({ obj: mesh(new Baker().add(box(0.36, 0.14, 0.05), '#5fc8ff', [0, 0.02, 0.32]).add(torus(0.2, 0.02, 6, 20), '#2f6fb0', [0, 0.04, 0], [Math.PI / 2, 0, 0], [1.05, 1, 1])
    .add(cyl(0.025, 0.025, 0.45, 8), '#ffb02e', [0.3, 0.2, 0.12])) }),
  // ---------------- neck ----------------
  redscarf: () => scarf(['#e05a4a']),
  bluescarf: () => scarf(['#4a8aff']),
  stripescarf: () => scarf(['#f4f0e8', '#4fbf4a', '#ffd84d']),
  bandana: () => ({ obj: mesh(new Baker().add(torus(0.27, 0.03, 6, 22), '#e05a4a', [0, 0, 0], [Math.PI / 2, 0, 0]).add(cone(0.17, 0.26, 3), '#e05a4a', [0, -0.08, 0.25], [Math.PI, 0, 0], [1, 1, 0.3])
    .add(sph(0.018), '#ffffff', [0.05, -0.04, 0.3]).add(sph(0.018), '#ffffff', [-0.05, -0.1, 0.29])) }),
  bowtie: () => ({ obj: mesh(new Baker().add(cone(0.07, 0.15, 4), '#e05a4a', [-0.075, 0.02, 0.29], [0, 0, -Math.PI / 2]).add(cone(0.07, 0.15, 4), '#e05a4a', [0.075, 0.02, 0.29], [0, 0, Math.PI / 2])
    .add(sph(0.035), '#c9443a', [0, 0.02, 0.3])) }),
  bell: () => ({ obj: mesh(new Baker().add(torus(0.27, 0.03, 6, 22), '#e05a4a', [0, 0, 0], [Math.PI / 2, 0, 0]).add(sph(0.065), '#ffc93a', [0, -0.07, 0.29]).add(box(0.08, 0.01, 0.01), '#6b4a2a', [0, -0.09, 0.355]), true),
    anim: (t, o) => { o.rotation.z = Math.sin(t * 6) * 0.04; } }),
  lei: () => {
    const b = new Baker(), cols = ['#ff4a6b', '#ffb02e', '#ffffff', '#ff7aa8', '#ffe14d'];
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; b.add(sph(0.06, 8, 6), cols[i % 5], [Math.cos(a) * 0.28, -Math.max(0, Math.sin(a)) * 0.1, Math.sin(a) * 0.28]); }
    return { obj: mesh(b) };
  },
  medal: () => ({ obj: mesh(new Baker().add(box(0.04, 0.24, 0.01), '#4a8aff', [-0.05, -0.08, 0.29], [0, 0, 0.35]).add(box(0.04, 0.24, 0.01), '#e05a4a', [0.05, -0.08, 0.29], [0, 0, -0.35])
    .add(cyl(0.07, 0.07, 0.02, 16), '#ffc93a', [0, -0.22, 0.3], [Math.PI / 2, 0, 0]).add(star(0.04, 0.01), '#fff2b0', [0, -0.22, 0.31]), true) }),
  // ---------------- back ----------------
  backpack: () => ({ obj: mesh(new Baker().add(new THREE.CapsuleGeometry(0.17, 0.15, 4, 10), '#ffd166', [0, 0, 0]).add(box(0.2, 0.13, 0.06), '#f2b84a', [0, -0.07, -0.16])
    .add(box(0.04, 0.4, 0.03), '#c98e3a', [-0.12, 0.08, 0.15]).add(box(0.04, 0.4, 0.03), '#c98e3a', [0.12, 0.08, 0.15])) }),
  explorer: () => ({ obj: mesh(new Baker().add(box(0.34, 0.38, 0.2), '#8a5a3a', [0, 0, -0.04]).add(cyl(0.08, 0.08, 0.42, 12), '#5f8f4a', [0, 0.25, -0.06], [0, 0, Math.PI / 2])
    .add(cyl(0.06, 0.06, 0.02, 14), '#ffc93a', [0, -0.02, -0.15], [Math.PI / 2, 0, 0]).add(box(0.36, 0.05, 0.22), '#6b4a2e', [0, -0.1, -0.04])) }),
  balloon: () => {
    const g = new THREE.Group();
    const s = mesh(new Baker().add(cyl(0.006, 0.006, 1.1, 4), '#f4f0e8', [0, 0.55, 0]));
    const ball = mesh(new Baker().add(sph(0.24, 14, 10), '#ff4a5a', [0, 0, 0], [0, 0, 0], [1, 1.15, 1]).add(cone(0.04, 0.06, 6), '#e03a4a', [0, -0.28, 0], [Math.PI, 0, 0]));
    ball.position.y = 1.35; g.add(s, ball); g.position.set(0.15, 0.1, -0.05);
    return { obj: g, anim: (t, o) => { o.rotation.z = Math.sin(t * 1.3) * 0.12; o.rotation.x = Math.cos(t * 1.1) * 0.08; } };
  },
  leafwings: () => wings('#7fcf5a', '#5fae4a', 0.42, 0.18, 0.5),
  butterfly: () => {
    const g = new THREE.Group();
    for (const s of [-1, 1]) {
      const w = mesh(new Baker().add(sph(0.22, 10, 6), '#ffa63a', [s * 0.24, 0.12, 0], [0, 0, s * 0.3], [1, 1, 0.12]).add(sph(0.16, 10, 6), '#ff7a3a', [s * 0.2, -0.14, 0], [0, 0, -s * 0.3], [1, 1, 0.12])
        .add(sph(0.06, 8, 6), '#2a2a2a', [s * 0.3, 0.2, 0.025], [0, 0, 0], [1, 1, 0.4]).add(sph(0.05, 8, 6), '#ffffff', [s * 0.18, 0.06, 0.025], [0, 0, 0], [1, 1, 0.4]));
      w.userData.side = s; g.add(w);
    }
    g.position.z = -0.1;
    return { obj: g, anim: (t, o) => { for (const c of o.children) c.rotation.y = c.userData.side * (0.35 + Math.sin(t * 5) * 0.35); } };
  },
  cape: () => cape('#e05a4a', '#c9443a'),
  royalcape: () => {
    const c = cape('#7a3ab8', '#5f2a9a');
    const fur = new Baker();
    for (let i = 0; i < 9; i++) { const a = Math.PI * (0.05 + i / 9.5); fur.add(sph(0.07, 8, 6), '#ffffff', [Math.cos(a) * 0.3, 0.32, -Math.sin(a) * 0.1 + 0.18]); }
    fur.add(sph(0.05, 8, 6), '#ffc93a', [0, 0.3, 0.33]);
    c.obj.add(mesh(fur));
    return c;
  },
  shell: () => {
    const b = new Baker().add(sph(0.34, 14, 8, ), '#5f9a4a', [0, 0, -0.05], [Math.PI / 2, 0, 0], [1, 0.45, 1.15]);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; b.add(cyl(0.08, 0.08, 0.02, 6), '#8fc06a', [Math.cos(a) * 0.17, Math.sin(a) * 0.2, -0.2], [Math.PI / 2, 0, 0]); }
    b.add(cyl(0.09, 0.09, 0.02, 6), '#8fc06a', [0, 0, -0.205], [Math.PI / 2, 0, 0]);
    return { obj: mesh(b) };
  },
  // ---------------- sprouts (base sits on top of head / hat) ----------------
  leaf: () => sprout((b) => b.add(sph(0.09, 10, 8), '#6dcc4f', [0.1, 0.17, 0], [0, 0, 0.4], [1.6, 0.35, 0.8])),
  twoleaf: () => sprout((b) => b.add(sph(0.09, 10, 8), '#6dcc4f', [0.1, 0.17, 0], [0, 0, 0.4], [1.6, 0.35, 0.8]).add(sph(0.08, 10, 8), '#8fdc63', [-0.09, 0.14, 0.02], [0, 0, -0.5], [1.5, 0.35, 0.8])),
  flower: () => sprout((b) => { for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; b.add(sph(0.05, 8, 6), '#ffffff', [Math.cos(a) * 0.07, 0.2, Math.sin(a) * 0.07], [0, 0, 0], [1, 0.4, 1]); } b.add(sph(0.045, 8, 6), '#ffd84d', [0, 0.215, 0]); }),
  cherrysprout: () => sprout((b) => b.add(cyl(0.01, 0.01, 0.12, 4), '#4f8a3a', [0.05, 0.2, 0], [0, 0, -0.6]).add(sph(0.05, 10, 8), '#e0303a', [0.1, 0.15, 0]).add(sph(0.05, 10, 8), '#e0303a', [-0.06, 0.13, 0.02])
    .add(sph(0.06, 8, 6), '#6dcc4f', [0.02, 0.26, 0], [0, 0, 0.3], [1.4, 0.3, 0.7])),
  starsprout: () => sprout((b) => b.add(star(0.09, 0.03), '#ffd84d', [0, 0.22, -0.015]), true),
  goldsprout: () => sprout((b) => b.add(sph(0.09, 10, 8), '#ffd24a', [0.1, 0.17, 0], [0, 0, 0.4], [1.6, 0.35, 0.8]).add(sph(0.08, 10, 8), '#ffe27a', [-0.09, 0.14, 0.02], [0, 0, -0.5], [1.5, 0.35, 0.8]), true, '#ffc93a'),
};

function scarf(cols: string[]): Built {
  const b = new Baker();
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; b.add(sph(0.085, 8, 6), cols[i % cols.length], [Math.cos(a) * 0.25, 0, Math.sin(a) * 0.25], [0, -a, 0], [1, 0.9, 1.2]); }
  b.add(box(0.11, 0.3, 0.05), cols[0], [0.12, -0.17, 0.26], [0.1, 0, 0.12]).add(box(0.11, 0.06, 0.055), cols[cols.length > 1 ? 1 : 0], [0.14, -0.3, 0.27], [0.1, 0, 0.12]);
  return { obj: mesh(b), anim: (t, o) => { o.rotation.x = Math.sin(t * 2.2) * 0.03; } };
}
function wings(a: string, b2: string, len: number, wid: number, tilt: number): Built {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const w = mesh(new Baker().add(sph(1, 10, 6), a, [s * len * 0.9, 0.08, 0], [0, 0, s * tilt], [len, wid, 0.04]).add(cyl(0.008, 0.008, len * 1.7, 4), b2, [s * len * 0.9, 0.08, 0.03], [0, 0, Math.PI / 2 + s * tilt]));
    w.userData.side = s; g.add(w);
  }
  g.position.z = -0.08;
  return { obj: g, anim: (t, o) => { for (const c of o.children) c.rotation.y = c.userData.side * (0.2 + Math.sin(t * 2.4) * 0.18); } };
}
function cape(c: string, dark: string): Built {
  const geo = new THREE.CylinderGeometry(0.3, 0.42, 0.85, 16, 4, true, Math.PI * 0.6, Math.PI * 0.8);
  const b = new Baker().add(geo, c, [0, -0.08, 0.3]).add(box(0.5, 0.05, 0.05), dark, [0, 0.32, 0.18]);
  const m = mesh(b);
  const cm = baseMat.clone(); cm.side = THREE.DoubleSide; m.material = cm;
  return { obj: m, anim: (t, o) => { o.rotation.x = -0.08 - Math.sin(t * 1.7) * 0.05; } };
}
function sprout(f: (b: Baker) => void, glow = false, stem = '#6dcc4f'): Built {
  const b = new Baker().add(cyl(0.015, 0.02, 0.18, 6), stem, [0, 0.09, 0]);
  f(b);
  return { obj: mesh(b, glow), anim: (t, o) => { o.rotation.z = Math.sin(t * 2.1) * 0.12; } };
}

export function buildWearable(id: string): Built | null { const f = B[id]; return f ? f() : null; }

// ---------------- body patterns (canvas textures on the torso) ----------------
const texCache = new Map<string, THREE.CanvasTexture>();
export function bodyTexture(id: string, dye: string): THREE.CanvasTexture {
  const key = id + dye;
  const hit = texCache.get(key); if (hit) return hit;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const fill = (col: string, x = 0, y = 0, w = 128, h = 128) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  switch (id) {
    case 'stripes': fill('#f8f6ee'); for (let y = 0; y < 128; y += 22) fill(dye, 0, y, 128, 10); break;
    case 'dots': fill(dye); g.fillStyle = '#ffffff'; for (let y = 8; y < 128; y += 20) for (let x = (y / 20) % 2 ? 10 : 0; x < 128; x += 20) { g.beginPath(); g.arc(x, y, 4.5, 0, 7); g.fill(); } break;
    case 'overalls': fill(dye); fill('#4a6fb8', 0, 58, 128, 70); fill('#4a6fb8', 20, 20, 10, 40); fill('#4a6fb8', 98, 20, 10, 40); g.fillStyle = '#ffd84d'; g.beginPath(); g.arc(25, 62, 4, 0, 7); g.arc(103, 62, 4, 0, 7); g.fill(); break;
    case 'hoodie': fill('#6dbb4f'); g.fillStyle = '#5aa63f'; for (let i = 0; i < 14; i++) { g.beginPath(); g.ellipse((i * 37) % 128, (i * 53) % 128, 7, 3.5, i, 0, 7); g.fill(); } fill('#5aa63f', 40, 70, 48, 22); break;
    case 'starry': {
      fill('#28306a'); g.fillStyle = '#ffe27a';
      for (let i = 0; i < 26; i++) { const x = (i * 47) % 128, y = (i * 29 + 11) % 128, r = 2 + (i % 3); g.beginPath(); for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2, rr = k % 2 ? r * 0.45 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.fill(); }
      break;
    }
    case 'rainbow': ['#ff8a8a', '#ffb36b', '#ffe27a', '#8fe08a', '#7fc8ff', '#b98cff'].forEach((col, i) => fill(col, 0, i * 22, 128, 22)); break;
    default: fill(dye);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  texCache.set(key, t);
  return t;
}

export interface Sockets { hat: THREE.Group; face: THREE.Group; neck: THREE.Group; back: THREE.Group; sprout: THREE.Group; torso: THREE.Mesh; hair: THREE.Mesh; }

/** Applies an outfit to a character's sockets; keeps per-item animation hooks. */
export class Outfit {
  private anims: { o: THREE.Object3D; f: (t: number, o: THREE.Object3D) => void }[] = [];
  constructor(private s: Sockets) {}
  apply(eq: Partial<Record<Slot, string>>, dye: string) {
    this.anims = [];
    for (const slot of ['hat', 'face', 'neck', 'back', 'sprout'] as const) {
      const sock = this.s[slot];
      for (const c of [...sock.children]) sock.remove(c);
    }
    let top = 0.33;
    for (const slot of ['hat', 'face', 'neck', 'back'] as const) {
      const id = eq[slot]; if (!id) continue;
      const b = buildWearable(id); if (!b) continue;
      this.s[slot].add(b.obj);
      b.obj.traverse((c) => { if ((c as THREE.Mesh).isMesh) c.castShadow = true; });
      if (slot === 'hat' && b.top) top = b.top;
      if (b.anim) this.anims.push({ o: b.obj, f: b.anim });
    }
    const hatCoversHair = eq.hat && ['beanie', 'frog', 'viking', 'mushcap', 'pirate'].includes(eq.hat);
    this.s.hair.visible = !hatCoversHair;
    if (eq.sprout) {
      const b = buildWearable(eq.sprout);
      if (b) { b.obj.position.y = top; this.s.sprout.add(b.obj); if (b.anim) this.anims.push({ o: b.obj, f: b.anim }); }
    }
    const m = this.s.torso.material as THREE.MeshStandardNodeMaterial;
    m.map = bodyTexture(eq.body ?? 'sunny', dye);
    m.color.set('#ffffff');
    m.needsUpdate = true;
  }
  update(t: number) { for (const a of this.anims) a.f(t, a.o); }
}
