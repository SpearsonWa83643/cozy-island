import * as THREE from 'three/webgpu';
import { Baker } from '../world/Baker';
import type { Slot } from '../game/Items';

/** Procedural low-poly wearables, built from primitives in the island's vertex-colour style. */
const sph = (r: number, w = 12, h = 9) => new THREE.SphereGeometry(r, w, h);
const cyl = (a: number, b: number, h: number, s = 16) => new THREE.CylinderGeometry(a, b, h, s);
const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z);

export const baseMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.62 });
export const glowMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.35, emissive: new THREE.Color('#ffb000'), emissiveIntensity: 0.35 });

export const caveMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.1, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.55 });
export const beamMat = new THREE.MeshBasicNodeMaterial({ color: '#fff2b0', transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
export function mesh(b: Baker, glow: boolean | 'cave' = false) {
  b.ao = false;
  const m = new THREE.Mesh(b.build(), glow === 'cave' ? caveMat : glow ? glowMat : baseMat);
  m.castShadow = true;
  return m;
}
export function star(r: number, depth: number) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 + Math.PI / 2, rr = i % 2 ? r * 0.45 : r; i ? s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
}
export function heart(r: number, depth: number) {
  const s = new THREE.Shape();
  s.moveTo(0, -r); s.bezierCurveTo(r * 1.4, -r * 0.1, r * 0.9, r * 1.1, 0, r * 0.45); s.bezierCurveTo(-r * 0.9, r * 1.1, -r * 1.4, -r * 0.1, 0, -r);
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
}

export interface Built { obj: THREE.Object3D; top?: number; anim?: (t: number, o: THREE.Object3D) => void; }
export type Builder = () => Built;

// Positions are relative to the slot socket: hat/face/sprout = head centre (r 0.33),
// neck = collar, back = middle of the back.
// Polish 2026-11-17: only the default outfit (backpack + leaf sprout) ships in the main bundle; every other
// wearable builder lives in WearablesExtra, a lazy chunk prefetched during warm-up (loadWearables()).
// A saved outfit that needs it is awaited before warm-up (Outfit.pending) so it still compiles up front.
const B: Record<string, Builder> = {
  backpack: () => ({ obj: mesh(new Baker().add(new THREE.CapsuleGeometry(0.17, 0.15, 4, 10), '#ffd166', [0, 0, 0]).add(box(0.2, 0.13, 0.06), '#f2b84a', [0, -0.07, -0.16])
    .add(box(0.04, 0.4, 0.03), '#c98e3a', [-0.12, 0.08, 0.15]).add(box(0.04, 0.4, 0.03), '#c98e3a', [0.12, 0.08, 0.15])) }),
  leaf: () => sprout((b) => b.add(sph(0.09, 10, 8), '#6dcc4f', [0.1, 0.17, 0], [0, 0, 0.4], [1.6, 0.35, 0.8])),
};
let extraP: Promise<void> | null = null;
/** download (once) and register every non-default wearable builder */
export function loadWearables(): Promise<void> {
  return (extraP ??= import('./WearablesExtra').then(({ EXTRA }) => { Object.assign(B, EXTRA); }));
}
export const hasWearable = (id: string) => !!B[id];

export function sprout(f: (b: Baker) => void, glow = false, stem = '#6dcc4f'): Built {
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
  /** resolves once every builder the last applied outfit needs is loaded (Game awaits it before warm-up) */
  pending: Promise<void> = Promise.resolve();
  private gen = 0;
  constructor(private s: Sockets) {}
  apply(eq: Partial<Record<Slot, string>>, dye: string) {
    const gen = ++this.gen;
    const missing = (['hat', 'face', 'neck', 'back', 'sprout'] as const).some((k) => eq[k] && !hasWearable(eq[k]!));
    // worn piece not downloaded yet: show what we have now, then re-apply once the chunk lands (latest outfit wins)
    if (missing) this.pending = loadWearables().then(() => { if (gen === this.gen) this.apply(eq, dye); });
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
