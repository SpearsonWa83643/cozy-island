import * as THREE from 'three/webgpu';
import { theme } from '../theme/theme';
import { heightAt } from './Terrain';
import { Flora } from './Flora';
import type { Fauna, Agent } from './Fauna';
import type { BuildMode } from '../build/BuildMode';
import type { Reef } from './Reef';
import type { AudioEngine } from '../audio/Audio';

/** Flora kinds that rustle / sway when tapped (trees, bushes, flowers). */
const TREES = new Set(['oak', 'blossom', 'birch', 'snowpine', 'pine', 'maple', 'palm', 'willow', 'deadtree']);
const PLANTS = new Set([
  'bush', 'berry', 'blueberry', 'lupine', 'sunflower', 'foxglove', 'fern', 'toadstool',
  'autumnbush', 'tropplant', 'hibiscus', 'pumpkin', 'brownshroom', 'barrel', 'prickly',
  'saguaro', 'reeds', 'marshbush', 'drytuft',
]);
const ROCKS = new Set(['rock', 'snowrock', 'sandstone']);

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
  rock: boolean;
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

interface PropSquash {
  obj: THREE.Object3D;
  t: number;
  dur: number;
  base: number;
}

interface Ripple {
  mesh: THREE.Mesh;
  t: number;
  life: number;
  size: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _c = new THREE.Color();

function isPlant(name: string) { return TREES.has(name) || PLANTS.has(name); }
function isTree(name: string) { return TREES.has(name); }
function isRock(name: string) { return ROCKS.has(name); }

/** Approximate canopy / puff height above ground for hit-testing + FX. */
function tipY(spot: Spot) {
  if (isRock(spot.name)) return spot.h + 0.25 + spot.sc * 0.45;
  const tree = isTree(spot.name);
  const h = tree ? 1.8 + spot.sc * 1.6 : 0.35 + spot.sc * 0.55;
  return spot.h + h;
}

function tints(name: string): string[] {
  if (isRock(name)) {
    if (name === 'snowrock') return ['#e8eef4', '#c8d0d8', '#a8b0b8', '#fff8f0'];
    if (name === 'sandstone') return ['#d08a5a', '#e0a070', '#c07040', '#f0c090'];
    return ['#c8c0b4', '#a8a098', '#8a8478', '#e0d8cc'];
  }
  if (theme.id === 'halloween') return ['#c8a0e8', '#ff8a2a', '#8fcf6a', '#fff1e0'];
  if (name === 'blossom' || name === 'hibiscus') return ['#ffc6dc', '#ffe0f0', '#ffffff', '#ff9ab8'];
  if (name === 'maple' || name === 'autumnbush' || name === 'pumpkin') return ['#e8562e', '#f2a12e', '#f5c242', '#d9432a'];
  if (name === 'sunflower' || name === 'lupine' || name === 'foxglove') return ['#ffd84d', '#ff9a5c', '#b98cff', '#ff7eb6', '#ffffff'];
  if (name.includes('pine') || name === 'fern' || name === 'willow') return ['#4a8a3a', '#6fb05a', '#3f7a35'];
  if (name === 'birch') return ['#f0d36a', '#8fcf6a', '#e8e4d8'];
  if (name === 'palm' || name === 'tropplant') return ['#2fa84a', '#3fbf5a', '#ff3a6b'];
  return ['#8fcf6a', '#f0d36a', '#5fa84a', '#c8e07a'];
}

const ANIMAL_UP: Record<string, number> = {
  bunny: 0.35, deer: 1.0, duck: 0.28, crab: 0.15, bird: 0.15, fish: 0.1, butterfly: 0.05,
};
const ANIMAL_ICONS: Record<string, string[]> = {
  bunny: ['💕', '✨', '🐰', '🎵'],
  deer: ['✨', '💕', '🎵', '💫'],
  duck: ['💦', '💕', '🎵', '✨'],
  crab: ['✨', '💕', '🦀', '💫'],
  bird: ['🎵', '✨', '💕', '🐦'],
  fish: ['💦', '✨', '💕', '🐟'],
  butterfly: ['✨', '💕', '🦋', '🌸'],
};

/**
 * Tap reactions: flora lean/squash, rocks wobble, animals hop/startle, water ripples, build props bounce.
 * Cooldown per target so spam stays cute. Counters exposed for tests.
 */
export class TapReact {
  group = new THREE.Group();
  /** test counters (flora.reactions still bumped for trees/plants) */
  animalHits = 0;
  rockHits = 0;
  waterHits = 0;
  propHits = 0;
  /** last flora/rock spot successfully tapped (Gameplay harvest hook) */
  lastSpot: Spot | null = null;

  private cool = new Map<string, number>();
  private leans: Lean[] = [];
  private bursts: Burst[] = [];
  private propSquash: PropSquash[] = [];
  private ripples: Ripple[] = [];
  private leafGeo = new THREE.PlaneGeometry(1, 0.7);
  private petalGeo = new THREE.CircleGeometry(0.5, 5);
  private pebbleGeo = new THREE.IcosahedronGeometry(0.5, 0);
  private now = 0;
  private fauna: Fauna | null = null;
  private build: BuildMode | null = null;
  private reef: Reef | null = null;
  private camera: THREE.Camera | null = null;

  constructor(private flora: Flora, private audio: AudioEngine, private emote: (p: THREE.Vector3, icon: string) => void) {
    this.group.name = 'tap-react';
    // pooled water ripple rings
    const ringGeo = new THREE.RingGeometry(0.55, 0.85, 28).rotateX(-Math.PI / 2);
    for (let i = 0; i < 10; i++) {
      const mat = new THREE.MeshBasicNodeMaterial({ color: '#e8f8ff', transparent: true, opacity: 0, depthWrite: false });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false; mesh.renderOrder = 4; mesh.frustumCulled = false;
      this.group.add(mesh);
      this.ripples.push({ mesh, t: 1, life: 1, size: 1 });
    }
  }

  /** Optional world hooks (animals, props, water) — set once after construct. */
  bind(opts: { fauna?: Fauna; build?: BuildMode; reef?: Reef; camera?: THREE.Camera }) {
    if (opts.fauna) this.fauna = opts.fauna;
    if (opts.build) this.build = opts.build;
    if (opts.reef) this.reef = opts.reef;
    if (opts.camera) this.camera = opts.camera;
  }

  /**
   * Flora / rock under screen coords. Returns `'core'` when the tap landed on the plant/rock
   * (caller may skip walking), `'slop'` for a generous near-miss, or false.
   */
  tapAt(cx: number, cy: number, project: (v: THREE.Vector3) => { x: number; y: number }, lim: number, player: THREE.Vector3): false | 'core' | 'slop' {
    const spots = this.flora.spots;
    let best: Spot | null = null, core = false;
    let bestScore = Infinity;
    this.lastSpot = null;
    for (const sp of spots) {
      if (!isPlant(sp.name) && !isRock(sp.name)) continue;
      if (this.flora.gone.has(Flora.key(sp.name, sp.x, sp.z))) continue;
      const far = Math.hypot(sp.x - player.x, sp.z - player.z);
      if (far > 24) continue;
      const a = project(_v.set(sp.x, sp.h + 0.1, sp.z));
      const b = project(_v.set(sp.x, tipY(sp), sp.z));
      const ex = b.x - a.x, ey = b.y - a.y, len2 = ex * ex + ey * ey || 1;
      const u = Math.max(0, Math.min(1, ((cx - a.x) * ex + (cy - a.y) * ey) / len2));
      const d = Math.hypot(a.x + ex * u - cx, a.y + ey * u - cy);
      const pxH = Math.sqrt(len2), hM = tipY(sp) - sp.h;
      const canopy = isTree(sp.name) ? (pxH / hM) * 1.1 * sp.sc * Math.min(1, u * 1.6) : isRock(sp.name) ? lim * 0.35 : 0;
      const reach = lim + canopy;
      if (d > reach) continue;
      const score = d / reach + far * 0.02;
      if (score < bestScore) {
        bestScore = score; best = sp;
        core = d <= canopy + (isTree(sp.name) ? 18 : isRock(sp.name) ? 22 : 26);
      }
    }
    if (!best) return false;

    const key = `${best.name}|${best.x.toFixed(2)}|${best.z.toFixed(2)}`;
    const until = this.cool.get(key) ?? 0;
    const tree = isTree(best.name);
    const rock = isRock(best.name);
    const res = core ? 'core' : 'slop';
    this.lastSpot = best;
    if (until > this.now) return res;

    this.cool.set(key, this.now + (tree ? 0.85 : rock ? 0.75 : 0.65));
    if (rock) {
      this.rockHits++;
      this.punch(best, false, true);
      this.burst(best, false, true);
      this.audio.rockClack();
      this.emote(new THREE.Vector3(best.x, tipY(best) + 0.15, best.z), Math.random() < 0.5 ? '✨' : '💫');
    } else {
      this.flora.reactions++;
      this.punch(best, tree, false);
      this.burst(best, tree, false);
      this.audio.rustleTap(tree ? 0.9 : 1.15);
      this.audio.pop(tree ? 0.55 : 0.85);
      const icons = tree
        ? (theme.id === 'halloween' ? ['🍂', '💜', '✨', '🍃'] : ['🍃', '🍂', '✨', '🌿'])
        : (best.name === 'blossom' || best.name === 'hibiscus' ? ['🌸', 'petal', '✨', '🌺'] : ['🌸', '🌼', '✨', '🍃']);
      const icon = icons[Math.floor(Math.random() * icons.length)];
      this.emote(new THREE.Vector3(best.x, tipY(best), best.z), icon === 'petal' ? '🌸' : icon);
    }
    return res;
  }

  /**
   * Wild animal under the tap (skips befriended followers — FriendScreen owns those).
   * Plays a lively per-species reaction; returns `'core'` so the caller can skip walking into them
   * when nothing else is interactable.
   */
  tapAnimal(cx: number, cy: number, project: (v: THREE.Vector3) => { x: number; y: number }, lim: number, player: THREE.Vector3): false | 'core' | 'slop' {
    const fauna = this.fauna;
    if (!fauna) return false;
    type Hit = { species: string; x: number; y: number; z: number; d: number; key: string; run: () => void };
    let best: Hit | null = null;
    const consider = (species: string, x: number, y: number, z: number, key: string, run: () => void) => {
      const far = Math.hypot(x - player.x, z - player.z);
      if (far > 22) return;
      const s = project(_v.set(x, y + (ANIMAL_UP[species] ?? 0.25), z));
      const d = Math.hypot(s.x - cx, s.y - cy);
      const reach = lim + (species === 'deer' ? 12 : species === 'bird' || species === 'butterfly' ? 10 : 6);
      if (d > reach) return;
      if (!best || d < best.d) best = { species, x, y, z, d, key, run };
    };

    for (const h of fauna.herds) {
      h.agents.forEach((a, i) => {
        if (i >= h.active && !a.friend) return;
        if (a.friend) return; // FriendScreen
        consider(h.k.name, a.x, a.y, a.z, `${h.k.name}:${a.id}`, () => this.triggerHerd(h.k.name, a, player));
      });
    }
    for (let i = 0; i < fauna.birds.active; i++) {
      const b = fauna.birdState[i];
      if (b.friend) continue;
      consider('bird', b.x, b.y, b.z, `bird:${b.id}`, () => {
        if (b.state === 2) { b.state = 3; b.timer = 0; }
        else { b.ph += 8; b.y += 0.6; }
        b.joy = 1;
      });
    }
    for (let i = 0; i < fauna.flies.active; i++) {
      const f = fauna.flyState[i];
      if (f.y < -5) continue;
      consider('butterfly', f.x, f.y, f.z, `fly:${i}`, () => { f.spook = 2.2; f.hy += 0.8; });
    }
    for (let i = 0; i < fauna.school.active; i++) {
      const f = fauna.school.fish[i];
      const x = f.hx + Math.cos(f.ang) * f.r, z = f.hz + Math.sin(f.ang) * f.r;
      const y = f.jump >= 0 ? -0.3 + Math.sin(Math.PI * Math.min(1, f.jump)) * 1.0 : -0.35;
      consider('fish', x, y, z, `fish:${i}`, () => { if (f.jump < 0) { f.jump = 0; f.next = 8; } });
    }

    if (!best) return false;
    const hit = best as Hit;
    const until = this.cool.get(hit.key) ?? 0;
    const core = hit.d <= lim * 0.85;
    const res: 'core' | 'slop' = core ? 'core' : 'slop';
    if (until > this.now) return res;

    this.cool.set(hit.key, this.now + 0.9);
    this.animalHits++;
    hit.run();
    this.audio.voice(hit.species === 'butterfly' ? 'bird' : hit.species === 'fish' ? 'duck' : hit.species);
    if (hit.species === 'duck' || hit.species === 'fish') {
      this.audio.splash(0, 0.35, false);
      this.spawnRipple(hit.x, hit.z, 0.7, 0.9);
      this.reef?.ring(hit.x, hit.z, 0.7, 0.9);
    } else {
      this.audio.pop(hit.species === 'bunny' ? 1.4 : 1.1);
    }
    const icons = ANIMAL_ICONS[hit.species] ?? ['💕', '✨'];
    this.emote(new THREE.Vector3(hit.x, hit.y + (ANIMAL_UP[hit.species] ?? 0.3) + 0.2, hit.z), icons[Math.floor(Math.random() * icons.length)]);
    return res;
  }

  private triggerHerd(species: string, a: Agent, player: THREE.Vector3) {
    a.joy = 1;
    if (species === 'bunny') {
      a.ph += 2;
      a.state = 2; a.timer = 0.85;
      const ang = Math.atan2(a.x - player.x, a.z - player.z) + (Math.random() - 0.5) * 0.8;
      a.tx = a.x + Math.sin(ang) * 2.2; a.tz = a.z + Math.cos(ang) * 2.2;
    } else if (species === 'deer') {
      a.state = 2; a.timer = 1.1;
      const ang = Math.atan2(a.x - player.x, a.z - player.z) + (Math.random() - 0.5) * 0.5;
      a.tx = a.x + Math.sin(ang) * 4; a.tz = a.z + Math.cos(ang) * 4;
      a.ph += 1;
    } else if (species === 'crab') {
      a.state = 2; a.timer = 0.9;
      const side = Math.random() < 0.5 ? 1 : -1;
      const ang = Math.atan2(a.x - player.x, a.z - player.z) + side * 1.4;
      a.tx = a.x + Math.sin(ang) * 2.5; a.tz = a.z + Math.cos(ang) * 2.5;
    } else if (species === 'duck') {
      a.state = 2; a.timer = 0.7;
      const ang = Math.atan2(a.x - player.x, a.z - player.z);
      a.tx = a.x + Math.sin(ang) * 1.4; a.tz = a.z + Math.cos(ang) * 1.4;
      a.ph += 3;
    }
  }

  /** Built / placed prop under the tap — squash-bounce. */
  tapProp(cx: number, cy: number, project: (v: THREE.Vector3) => { x: number; y: number }, lim: number, player: THREE.Vector3): false | 'core' | 'slop' {
    const build = this.build;
    if (!build) return false;
    let best: { obj: THREE.Object3D; d: number; y: number } | null = null;
    for (const p of build.pieces) {
      const o = p.obj;
      const far = Math.hypot(o.position.x - player.x, o.position.z - player.z);
      if (far > 20) continue;
      const midY = o.position.y + p.def.height * 0.45;
      const s = project(_v.set(o.position.x, midY, o.position.z));
      const d = Math.hypot(s.x - cx, s.y - cy);
      const reach = lim + 8;
      if (d > reach) continue;
      if (!best || d < best.d) best = { obj: o, d, y: midY };
    }
    if (!best) return false;
    const key = `prop|${best.obj.position.x.toFixed(2)}|${best.obj.position.z.toFixed(2)}|${best.obj.position.y.toFixed(2)}`;
    const until = this.cool.get(key) ?? 0;
    const core = best.d <= lim * 0.9;
    const res: 'core' | 'slop' = core ? 'core' : 'slop';
    if (until > this.now) return res;
    this.cool.set(key, this.now + 0.7);
    this.propHits++;
    // clear prior squash on same obj
    for (let i = this.propSquash.length - 1; i >= 0; i--) {
      if (this.propSquash[i].obj === best.obj) {
        this.propSquash[i].obj.scale.setScalar(this.propSquash[i].base);
        this.propSquash.splice(i, 1);
      }
    }
    const base = best.obj.scale.x || 1;
    this.propSquash.push({ obj: best.obj, t: 0, dur: 0.38, base });
    this.audio.pop(0.7);
    this.audio.rockClack(0.6);
    this.emote(new THREE.Vector3(best.obj.position.x, best.y + 0.35, best.obj.position.z), Math.random() < 0.5 ? '✨' : '💫');
    return res;
  }

  /**
   * Water under the tap point — expanding ripple rings + soft splash.
   * Uses a ground/water ray from the camera when available.
   */
  tapWater(cx: number, cy: number, project: (v: THREE.Vector3) => { x: number; y: number }, lim: number, player: THREE.Vector3, canvas: HTMLElement): false | 'core' | 'slop' {
    // prefer true water: terrain height below shore
    let wx = player.x, wz = player.z, ok = false;
    if (this.camera) {
      const r = canvas.getBoundingClientRect();
      const ndcX = ((cx - r.left) / Math.max(1, r.width)) * 2 - 1;
      const ndcY = -((cy - r.top) / Math.max(1, r.height)) * 2 + 1;
      const cam = this.camera as THREE.PerspectiveCamera;
      // build a world ray (same approach as Gameplay.tapAt)
      const origin = cam.position.clone();
      _v.set(ndcX, ndcY, 0.5).unproject(cam);
      const dir = _v.sub(origin).normalize();
      // intersect calm water plane y≈0.04, then confirm terrain is wet
      if (Math.abs(dir.y) > 1e-4) {
        const t = (0.04 - origin.y) / dir.y;
        if (t > 0.5 && t < 90) {
          const hx = origin.x + dir.x * t, hz = origin.z + dir.z * t;
          if (heightAt(hx, hz) < 0.18) { wx = hx; wz = hz; ok = true; }
        }
      }
      // also try a slightly deeper plane for offshore troughs
      if (!ok && Math.abs(dir.y) > 1e-4) {
        const t = (-0.35 - origin.y) / dir.y;
        if (t > 0.5 && t < 90) {
          const hx = origin.x + dir.x * t, hz = origin.z + dir.z * t;
          if (heightAt(hx, hz) < 0.05) { wx = hx; wz = hz; ok = true; }
        }
      }
    }
    if (!ok) {
      // screen-space fallback: sample wet cells near the player and pick the one under the tap
      let bestD = lim + 50;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2, rad = 2 + (i % 4) * 1.4;
        const px = player.x + Math.cos(a) * rad, pz = player.z + Math.sin(a) * rad;
        if (heightAt(px, pz) >= 0.12) continue;
        const s = project(_v.set(px, 0.06, pz));
        const d = Math.hypot(s.x - cx, s.y - cy);
        if (d < bestD) { bestD = d; wx = px; wz = pz; ok = true; }
      }
      if (!ok || bestD > lim + 50) return false;
    }
    const far = Math.hypot(wx - player.x, wz - player.z);
    if (far > 28) return false;
    const s = project(_v.set(wx, 0.06, wz));
    const d = Math.hypot(s.x - cx, s.y - cy);
    if (d > lim + 40) return false;

    const key = `water|${wx.toFixed(1)}|${wz.toFixed(1)}`;
    const until = this.cool.get(key) ?? 0;
    const core = d <= lim + 18;
    const res: 'core' | 'slop' = core ? 'core' : 'slop';
    if (until > this.now) return res;
    this.cool.set(key, this.now + 0.55);
    this.waterHits++;
    this.spawnRipple(wx, wz, 1.0, 1.15);
    this.spawnRipple(wx + (Math.random() - 0.5) * 0.3, wz + (Math.random() - 0.5) * 0.3, 0.55, 0.85);
    this.reef?.ring(wx, wz, 1.0, 1.1);
    this.audio.splash(0, 0.4, false);
    this.emote(new THREE.Vector3(wx, 0.35, wz), Math.random() < 0.5 ? '💦' : '✨');
    return res;
  }

  private spawnRipple(x: number, z: number, size: number, life: number) {
    const r = this.ripples.find((q) => q.t >= 1) ?? this.ripples[0];
    r.t = 0; r.life = life; r.size = size;
    r.mesh.position.set(x, 0.07, z);
    r.mesh.scale.setScalar(0.12);
    r.mesh.visible = true;
    (r.mesh.material as THREE.MeshBasicNodeMaterial).opacity = 0.75;
  }

  private punch(sp: Spot, tree: boolean, rock: boolean) {
    const hit = this.findInstance(sp);
    if (!hit) return;
    for (let i = this.leans.length - 1; i >= 0; i--) {
      const L = this.leans[i];
      if (L.mesh === hit.mesh && L.index === hit.index) {
        L.mesh.setMatrixAt(L.index, L.base); L.mesh.instanceMatrix.needsUpdate = true;
        this.leans.splice(i, 1);
      }
    }
    this.leans.push({
      mesh: hit.mesh, index: hit.index, base: hit.base,
      t: 0, dur: rock ? 0.48 : tree ? 0.7 : 0.42,
      amp: rock ? 0.18 : tree ? 0.22 : 0.14,
      yaw: Math.random() * Math.PI * 2,
      tree, rock,
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

  private burst(sp: Spot, tree: boolean, rock: boolean) {
    const cols = tints(sp.name);
    const n = rock ? 7 + Math.floor(Math.random() * 4) : tree ? 10 + Math.floor(Math.random() * 5) : 6 + Math.floor(Math.random() * 4);
    const petal = !rock && (!tree || sp.name === 'blossom');
    const geo = rock ? this.pebbleGeo : petal ? this.petalGeo : this.leafGeo;
    const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, transparent: true, depthWrite: false });
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    const px = new Float32Array(n), py = new Float32Array(n), pz = new Float32Array(n);
    const vx = new Float32Array(n), vy = new Float32Array(n), vz = new Float32Array(n);
    const spin = new Float32Array(n), size = new Float32Array(n);
    const cy = tipY(sp) - (rock ? 0.05 : tree ? 0.35 : 0.08) * sp.sc;
    for (let i = 0; i < n; i++) {
      px[i] = sp.x + (Math.random() - 0.5) * (rock ? 0.45 : tree ? 0.9 : 0.35) * sp.sc;
      py[i] = cy + (Math.random() - 0.3) * (rock ? 0.25 : tree ? 0.6 : 0.2);
      pz[i] = sp.z + (Math.random() - 0.5) * (rock ? 0.45 : tree ? 0.9 : 0.35) * sp.sc;
      vx[i] = (Math.random() - 0.5) * (rock ? 1.8 : tree ? 2.2 : 1.6);
      vy[i] = rock ? 1.0 + Math.random() * 1.6 : tree ? 0.4 + Math.random() * 1.4 : 0.8 + Math.random() * 1.2;
      vz[i] = (Math.random() - 0.5) * (rock ? 1.8 : tree ? 2.2 : 1.6);
      spin[i] = (Math.random() - 0.5) * 8;
      size[i] = (rock ? 0.045 : petal ? 0.08 : 0.12) * (0.7 + Math.random() * 0.7) * Math.min(1.4, sp.sc);
      mesh.setColorAt(i, _c.set(cols[i % cols.length]));
      _s.setScalar(size[i]);
      _p.set(px[i], py[i], pz[i]);
      _q.setFromEuler(_e.set(Math.random(), Math.random() * 6, Math.random()));
      mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.group.add(mesh);
    this.bursts.push({ mesh, life: rock ? 0.7 : tree ? 1.15 : 0.75, max: rock ? 0.7 : tree ? 1.15 : 0.75, n, px, py, pz, vx, vy, vz, spin, size });
  }

  update(dt: number) {
    this.now += dt;
    for (let i = this.leans.length - 1; i >= 0; i--) {
      const L = this.leans[i];
      L.t += dt;
      const u = Math.min(1, L.t / L.dur);
      const wave = Math.sin(u * Math.PI);
      L.base.decompose(_p, _q, _s);
      if (L.rock) {
        _e.setFromQuaternion(_q);
        _e.z += Math.sin(L.yaw) * L.amp * wave;
        _e.x += Math.cos(L.yaw) * L.amp * wave * 0.85;
        _e.y += Math.sin(L.yaw * 1.3) * L.amp * 0.35 * wave;
        _q.setFromEuler(_e);
        const hop = wave * 0.06;
        _p.y += hop;
      } else if (L.tree) {
        _e.setFromQuaternion(_q);
        _e.z += Math.sin(L.yaw) * L.amp * wave;
        _e.x += Math.cos(L.yaw) * L.amp * wave * 0.7;
        _q.setFromEuler(_e);
      } else {
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
    for (let i = this.propSquash.length - 1; i >= 0; i--) {
      const P = this.propSquash[i];
      P.t += dt;
      const u = Math.min(1, P.t / P.dur);
      const wave = Math.sin(u * Math.PI);
      const fat = 1 + 0.16 * wave;
      const sq = 1 - 0.22 * wave;
      P.obj.scale.set(P.base * fat, P.base * sq, P.base * fat);
      if (u >= 1) { P.obj.scale.setScalar(P.base); this.propSquash.splice(i, 1); }
    }
    for (const r of this.ripples) {
      if (r.t >= 1) continue;
      r.t += dt / r.life;
      const sc = 0.15 + r.t * r.size;
      r.mesh.scale.setScalar(sc);
      (r.mesh.material as THREE.MeshBasicNodeMaterial).opacity = Math.max(0, (1 - r.t) * 0.7);
      if (r.t >= 1) r.mesh.visible = false;
    }
  }
}
