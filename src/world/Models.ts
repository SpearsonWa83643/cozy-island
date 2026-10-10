import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

type Rnd = () => number;

const matCache = new Map<string, THREE.MeshStandardNodeMaterial>();
export function mat(hex: string, opts: { rough?: number; flat?: boolean; emissive?: string; ei?: number } = {}) {
  const key = `${hex}|${opts.rough ?? 0.85}|${opts.flat ?? true}|${opts.emissive ?? ''}|${opts.ei ?? 0}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardNodeMaterial({
      color: hex, roughness: opts.rough ?? 0.85, metalness: 0, flatShading: opts.flat ?? true,
    });
    if (opts.emissive) { m.emissive = new THREE.Color(opts.emissive); m.emissiveIntensity = opts.ei ?? 1; }
    matCache.set(key, m);
  }
  return m;
}

function shadowed<T extends THREE.Object3D>(o: T, cast = true): T {
  o.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = cast; c.receiveShadow = true; } });
  return o;
}

const blobGeo = new THREE.IcosahedronGeometry(1, 1);
const LEAF_COLORS = ['#7ccf5a', '#5fb84a', '#8fdc63', '#4fa845', '#a3d95f'];
const BLOSSOM_COLORS = ['#ffb3c8', '#ff9fb8', '#ffd0dc'];

export function makeRoundTree(rnd: Rnd, blossom = false): THREE.Group {
  const g = new THREE.Group();
  const h = 1.6 + rnd() * 1.0;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, h, 7), mat('#9a6b4a'));
  trunk.position.y = h / 2;
  g.add(trunk);
  const palette = blossom ? BLOSSOM_COLORS : LEAF_COLORS;
  const base = palette[Math.floor(rnd() * palette.length)];
  const blobs = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < blobs; i++) {
    const s = 0.75 + rnd() * 0.55;
    const b = new THREE.Mesh(blobGeo, mat(i === 0 ? base : palette[Math.floor(rnd() * palette.length)]));
    const a = rnd() * Math.PI * 2;
    const r = i === 0 ? 0 : 0.55 + rnd() * 0.3;
    b.position.set(Math.cos(a) * r, h + 0.35 + rnd() * 0.6 + (i === 0 ? 0.3 : 0), Math.sin(a) * r);
    b.scale.set(s, s * (0.85 + rnd() * 0.2), s);
    b.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    g.add(b);
  }
  return shadowed(g);
}

export function makePine(rnd: Rnd): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 1.0, 6), mat('#8a5c3e'));
  trunk.position.y = 0.5;
  g.add(trunk);
  const tiers = 3 + Math.floor(rnd() * 2);
  const col = ['#3f9a5a', '#4aa864', '#378a52'][Math.floor(rnd() * 3)];
  for (let i = 0; i < tiers; i++) {
    const r = 1.3 - i * 0.28;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r, 1.3, 7), mat(col));
    cone.position.y = 1.2 + i * 0.75;
    cone.rotation.y = rnd() * Math.PI;
    g.add(cone);
  }
  return shadowed(g);
}

export function makeBush(rnd: Rnd): THREE.Group {
  const g = new THREE.Group();
  const n = 2 + Math.floor(rnd() * 3);
  const berry = rnd() < 0.4;
  for (let i = 0; i < n; i++) {
    const s = 0.35 + rnd() * 0.3;
    const b = new THREE.Mesh(blobGeo, mat(LEAF_COLORS[Math.floor(rnd() * LEAF_COLORS.length)]));
    b.position.set((rnd() - 0.5) * 0.8, s * 0.7, (rnd() - 0.5) * 0.8);
    b.scale.setScalar(s);
    g.add(b);
    if (berry) {
      const d = new THREE.Mesh(blobGeo, mat('#ff6b7a', { rough: 0.5 }));
      d.scale.setScalar(0.07);
      d.position.copy(b.position).add(new THREE.Vector3(0, s * 0.85, s * 0.3));
      g.add(d);
    }
  }
  return shadowed(g);
}

export function makeRock(rnd: Rnd): THREE.Mesh {
  const geo = new THREE.DodecahedronGeometry(1, 0);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  // jitter (keep shared verts consistent by hashing position)
  const seen = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const k = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let f = seen.get(k);
    if (f === undefined) { f = 0.8 + rnd() * 0.4; seen.set(k, f); }
    pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f, pos.getZ(i) * f);
  }
  geo.computeVertexNormals();
  const tone = ['#b3aca2', '#a29b91', '#c2bcb2'][Math.floor(rnd() * 3)];
  const m = new THREE.Mesh(geo, mat(tone, { rough: 0.95 }));
  return shadowed(m);
}

// ---------- Buildables ----------
const blockGeo = new RoundedBoxGeometry(1, 1, 1, 2, 0.08);
export function makeBlock(): THREE.Group {
  const g = new THREE.Group();
  const b = new THREE.Mesh(blockGeo, mat('#d9a36a', { rough: 0.8, flat: false }));
  b.position.y = 0.5;
  g.add(b);
  // plank lines
  for (const y of [0.33, 0.66]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(1.01, 0.03, 1.01), mat('#b47f4c'));
    l.position.y = y;
    g.add(l);
  }
  return shadowed(g);
}

export function makeFence(): THREE.Group {
  const g = new THREE.Group();
  const wood = mat('#f2e3c9', { rough: 0.7 });
  for (const x of [-0.42, 0.42]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.9, 0.14), wood);
    post.position.set(x, 0.45, 0);
    g.add(post);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.14, 4), wood);
    cap.position.set(x, 0.97, 0); cap.rotation.y = Math.PI / 4;
    g.add(cap);
  }
  for (const y of [0.35, 0.7]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.1, 0.07), wood);
    rail.position.set(0, y, 0);
    g.add(rail);
  }
  return shadowed(g);
}

export function makeLamp(): THREE.Group {
  const g = new THREE.Group();
  const iron = mat('#3d4a5c', { rough: 0.5 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.15, 8), iron);
  base.position.y = 0.075;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.7, 8), iron);
  pole.position.y = 0.9;
  const bulb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 2), mat('#fff1b8', { emissive: '#ffcf6b', ei: 2.6, flat: false }));
  bulb.position.y = 1.9;
  bulb.castShadow = false;
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.22, 8), iron);
  hat.position.y = 2.15;
  g.add(base, pole, bulb, hat);
  shadowed(g);
  bulb.castShadow = false;
  return g;
}

export function makeFlowerPot(): THREE.Group {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.22, 0.4, 10), mat('#e07a52'));
  pot.position.y = 0.2;
  g.add(pot);
  const cols = ['#ff7eb6', '#ffd84d', '#ffffff', '#b98cff'];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const f = new THREE.Mesh(blobGeo, mat(cols[i % cols.length], { rough: 0.6 }));
    f.scale.setScalar(0.1);
    f.position.set(Math.cos(a) * 0.14, 0.52 + (i % 2) * 0.06, Math.sin(a) * 0.14);
    g.add(f);
  }
  const leaf = new THREE.Mesh(blobGeo, mat('#5fb84a'));
  leaf.scale.set(0.24, 0.12, 0.24); leaf.position.y = 0.42;
  g.add(leaf);
  return shadowed(g);
}
