import * as THREE from 'three/webgpu';
import { theme } from '../theme/theme';
import type { Flora } from './Flora';
import type { AudioEngine } from '../audio/Audio';

/** Flora kinds that rustle / sway when tapped (trees, bushes, flowers — not rocks/shells/lilies). */
const TREES = new Set(['oak', 'blossom', 'birch', 'snowpine', 'pine', 'maple', 'palm', 'willow', 'deadtree']);
const PLANTS = new Set([
  'bush', 'berry', 'blueberry', 'lupine', 'sunflower', 'foxglove', 'fern', 'toadstool',
  'autumnbush', 'tropplant', 'hibiscus', 'pumpkin', 'brownshroom', 'barrel', 'prickly',
  'saguaro', 'reeds', 'marshbush', 'drytuft',
]);

type Spot = { name: string; x: number; z: number; h: number; sc: number };

interface Lean {
  mesh: THREE.InstancedMesh;
  index: number;
  base: THREE.Matrix4;
  t: number;
  dur: number;
  amp: number;
  yaw: number;
  tree: boolean;
}

interface Burst {
  mesh: THREE.InstancedMesh;
  life: number;
  max: number;
  n: number;
  px: Float32Array; py: Float32Array; pz: Float32Array;
  vx: Float32Array; vy: Float32Array; vz: Float32Array;
  spin: Float32Array;
  size: Float32Array;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _c = new THREE.Color();

function isReactable(name: string) { return TREES.has(name) || PLANTS.has(name); }
function isTree(name: string) { return TREES.has(name); }

/** Approximate canopy / puff height above ground for hit-testing + FX. */
function tipY(spot: Spot) {
  const tree = isTree(spot.name);
  const h = tree ? 1.8 + spot.sc * 1.6 : 0.35 + spot.sc * 0.55;
  return spot.h + h;
}

function tints(name: string): string[] {
  if (theme.id === 'halloween') return ['#c8a0e8', '#ff8a2a', '#8fcf6a', '#fff1e0'];
  if (name === 'blossom' || name === 'hibiscus') return ['#ffc6dc', '#ffe0f0', '#ffffff', '#ff9ab8'];
  if (name === 'maple' || name === 'autumnbush' || name === 'pumpkin') return ['#e8562e', '#f2a12e', '#f5c242', '#d9432a'];
  if (name === 'sunflower' || name === 'lupine' || name === 'foxglove') return ['#ffd84d', '#ff9a5c', '#b98cff', '#ff7eb6', '#ffffff'];
  if (name.includes('pine') || name === 'fern' || name === 'willow') return ['#4a8a3a', '#6fb05a', '#3f7a35'];
  if (name === 'birch') return ['#f0d36a', '#8fcf6a', '#e8e4d8'];
  if (name === 'palm' || name === 'tropplant') return ['#2fa84a', '#3fbf5a', '#ff3a6b'];
  return ['#8fcf6a', '#f0d36a', '#5fa84a', '#c8e07a'];
}

/**
 * Tap reactions for instanced flora: lean/squash the matched instance, burst leaves/petals, soft rustle.
 * Cooldown per spot so spam stays gentle. Exposed via `flora.reactions` for tests.
 */
export class TapReact {
  group = new THREE.Group();
  private cool = new Map<string, number>();
  private leans: Lean[] = [];
  private bursts: Burst[] = [];
  private leafGeo = new THREE.PlaneGeometry(1, 0.7);
  private petalGeo = new THREE.CircleGeometry(0.5, 5);
  private now = 0;

  constructor(private flora: Flora, private audio: AudioEngine, private emote: (p: THREE.Vector3, icon: string) => void) {
    this.group.name = 'tap-react';
  }

  /**
   * Find the nearest reactable flora spot under screen coords. On hit: punch the instance,
   * spawn a short leaf/petal burst, play rustle, bump `flora.reactions`.
   * Returns `'core'` when the tap landed on the plant (caller may skip walking),
   * `'slop'` for a generous near-miss (react but still walk), or false.
   */
  tapAt(cx: number, cy: number, project: (v: THREE.Vector3) => { x: number; y: number }, lim: number, player: THREE.Vector3): false | 'core' | 'slop' {
    const spots = this.flora.spots;
    let best: Spot | null = null, core = false;
    let bestScore = Infinity;
    for (const sp of spots) {
      if (!isReactable(sp.name)) continue;
      const far = Math.hypot(sp.x - player.x, sp.z - player.z);
      if (far > 24) continue;
      // screen-space distance to the plant's vertical axis (base → top), widened by the canopy for trees
      const a = project(_v.set(sp.x, sp.h + 0.1, sp.z));
      const b = project(_v.set(sp.x, tipY(sp), sp.z));
      const ex = b.x - a.x, ey = b.y - a.y, len2 = ex * ex + ey * ey || 1;
      const u = Math.max(0, Math.min(1, ((cx - a.x) * ex + (cy - a.y) * ey) / len2));
      const d = Math.hypot(a.x + ex * u - cx, a.y + ey * u - cy);
      const pxH = Math.sqrt(len2), hM = tipY(sp) - sp.h;
      const canopy = isTree(sp.name) ? (pxH / hM) * 1.1 * sp.sc * Math.min(1, u * 1.6) : 0;
      const reach = lim + canopy;
      if (d > reach) continue;
      // prefer closer-to-centre hits, then nearer plants (front-most)
      const score = d / reach + far * 0.02;
      if (score < bestScore) { bestScore = score; best = sp; core = d <= canopy + (isTree(sp.name) ? 18 : 26); }
    }
    if (!best) return false;

    const key = `${best.name}|${best.x.toFixed(2)}|${best.z.toFixed(2)}`;
    const until = this.cool.get(key) ?? 0;
    const tree = isTree(best.name);
    const res = core ? 'core' : 'slop';
    if (until > this.now) return res;

    this.cool.set(key, this.now + (tree ? 0.85 : 0.65));
    this.flora.reactions++;
    this.punch(best, tree);
    this.burst(best, tree);
    this.audio.rustleTap(tree ? 0.9 : 1.15);
    this.audio.pop(tree ? 0.55 : 0.85);
    const icons = tree
      ? (theme.id === 'halloween' ? ['🍂', '💜', '✨', '🍃'] : ['🍃', '🍂', '✨', '🌿'])
      : (best.name === 'blossom' || best.name === 'hibiscus' ? ['🌸', 'petal', '✨', '🌺'] : ['🌸', '🌼', '✨', '🍃']);
    const icon = icons[Math.floor(Math.random() * icons.length)];
    this.emote(new THREE.Vector3(best.x, tipY(best), best.z), icon === 'petal' ? '🌸' : icon);
    return res;
  }

  private punch(sp: Spot, tree: boolean) {
    const hit = this.findInstance(sp);
    if (!hit) return;
    // restore any prior lean on the same instance first
    for (let i = this.leans.length - 1; i >= 0; i--) {
      const L = this.leans[i];
      if (L.mesh === hit.mesh && L.index === hit.index) {
        L.mesh.setMatrixAt(L.index, L.base); L.mesh.instanceMatrix.needsUpdate = true;
        this.leans.splice(i, 1);
      }
    }
    this.leans.push({
      mesh: hit.mesh, index: hit.index, base: hit.base,
      t: 0, dur: tree ? 0.7 : 0.42,
      amp: tree ? 0.22 : 0.14,
      yaw: Math.random() * Math.PI * 2,
      tree,
    });
  }

  private findInstance(sp: Spot): { mesh: THREE.InstancedMesh; index: number; base: THREE.Matrix4; pos: THREE.Vector3 } | null {
    let best: { mesh: THREE.InstancedMesh; index: number; base: THREE.Matrix4; pos: THREE.Vector3 } | null = null;
    let bd = 0.35;
    for (const ch of this.flora.group.children) {
      const im = ch as THREE.InstancedMesh;
      if (!im.isInstancedMesh || im.name !== sp.name) continue;
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, _m);
        _p.setFromMatrixPosition(_m);
        const d = Math.hypot(_p.x - sp.x, _p.z - sp.z);
        if (d < bd) {
          bd = d;
          best = { mesh: im, index: i, base: _m.clone(), pos: _p.clone() };
        }
      }
    }
    return best;
  }

  private burst(sp: Spot, tree: boolean) {
    const cols = tints(sp.name);
    const n = tree ? 10 + Math.floor(Math.random() * 5) : 6 + Math.floor(Math.random() * 4);
    const petal = !tree || sp.name === 'blossom';
    const geo = petal ? this.petalGeo : this.leafGeo;
    const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, transparent: true, depthWrite: false });
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    const px = new Float32Array(n), py = new Float32Array(n), pz = new Float32Array(n);
    const vx = new Float32Array(n), vy = new Float32Array(n), vz = new Float32Array(n);
    const spin = new Float32Array(n), size = new Float32Array(n);
    const cy = tipY(sp) - (tree ? 0.35 : 0.08) * sp.sc;
    for (let i = 0; i < n; i++) {
      px[i] = sp.x + (Math.random() - 0.5) * (tree ? 0.9 : 0.35) * sp.sc;
      py[i] = cy + (Math.random() - 0.3) * (tree ? 0.6 : 0.2);
      pz[i] = sp.z + (Math.random() - 0.5) * (tree ? 0.9 : 0.35) * sp.sc;
      vx[i] = (Math.random() - 0.5) * (tree ? 2.2 : 1.6);
      vy[i] = tree ? 0.4 + Math.random() * 1.4 : 0.8 + Math.random() * 1.2;
      vz[i] = (Math.random() - 0.5) * (tree ? 2.2 : 1.6);
      spin[i] = (Math.random() - 0.5) * 8;
      size[i] = (petal ? 0.08 : 0.12) * (0.7 + Math.random() * 0.7) * Math.min(1.4, sp.sc);
      mesh.setColorAt(i, _c.set(cols[i % cols.length]));
      _s.setScalar(size[i]);
      _p.set(px[i], py[i], pz[i]);
      _q.setFromEuler(_e.set(Math.random(), Math.random() * 6, Math.random()));
      mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.group.add(mesh);
    this.bursts.push({ mesh, life: tree ? 1.15 : 0.75, max: tree ? 1.15 : 0.75, n, px, py, pz, vx, vy, vz, spin, size });
  }

  update(dt: number) {
    this.now += dt;
    // leans
    for (let i = this.leans.length - 1; i >= 0; i--) {
      const L = this.leans[i];
      L.t += dt;
      const u = Math.min(1, L.t / L.dur);
      const wave = Math.sin(u * Math.PI); // 0→1→0
      L.base.decompose(_p, _q, _s);
      if (L.tree) {
        _e.setFromQuaternion(_q);
        _e.z += Math.sin(L.yaw) * L.amp * wave;
        _e.x += Math.cos(L.yaw) * L.amp * wave * 0.7;
        _q.setFromEuler(_e);
      } else {
        // squash + slight lean
        const sq = 1 - 0.22 * wave;
        const fat = 1 + 0.14 * wave;
        _s.x *= fat; _s.z *= fat; _s.y *= sq;
        _e.setFromQuaternion(_q);
        _e.z += Math.sin(L.yaw) * L.amp * 0.6 * wave;
        _q.setFromEuler(_e);
      }
      L.mesh.setMatrixAt(L.index, _m.compose(_p, _q, _s));
      L.mesh.instanceMatrix.needsUpdate = true;
      if (u >= 1) {
        L.mesh.setMatrixAt(L.index, L.base);
        L.mesh.instanceMatrix.needsUpdate = true;
        this.leans.splice(i, 1);
      }
    }
    // bursts
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.life -= dt;
      const k = 1 - b.life / b.max;
      const fade = Math.max(0, Math.min(1, b.life * 3));
      (b.mesh.material as THREE.MeshBasicNodeMaterial).opacity = fade;
      for (let j = 0; j < b.n; j++) {
        b.vy[j] -= 3.2 * dt;
        b.px[j] += b.vx[j] * dt;
        b.py[j] += b.vy[j] * dt;
        b.pz[j] += b.vz[j] * dt;
        b.vx[j] *= 1 - 1.2 * dt;
        b.vz[j] *= 1 - 1.2 * dt;
        const sc = b.size[j] * (1 + 0.15 * Math.sin(k * 6 + j)) * (0.55 + 0.45 * fade);
        _p.set(b.px[j], b.py[j], b.pz[j]);
        _q.setFromEuler(_e.set(b.spin[j] * k * 2, b.spin[j] * k * 3, k * 4));
        _s.setScalar(Math.max(0.001, sc));
        b.mesh.setMatrixAt(j, _m.compose(_p, _q, _s));
      }
      b.mesh.instanceMatrix.needsUpdate = true;
      if (b.life <= 0) {
        this.group.remove(b.mesh);
        (b.mesh.material as THREE.Material).dispose();
        b.mesh.dispose();
        this.bursts.splice(i, 1);
      }
    }
  }
}
