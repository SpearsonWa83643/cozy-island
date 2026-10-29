import * as THREE from 'three/webgpu';
import { float, hash, instanceIndex, sin, time, uniform, vec3 } from 'three/tsl';
import { Baker } from '../world/Baker';
import { heightAt } from '../world/Terrain';
import { mulberry32 } from '../world/noise';
import { ISLETS } from '../world/config';
import { theme, type Theme } from './theme';
import { applyGrade } from '../render/Renderer';
import { updateSeason, snapSeason } from './Season';
import { soundscapeFor } from '../audio/soundscapes';
import type { Game } from '../core/Game';

/**
 * Theme "dress" (like cozy-game's themeDress.ts): the seasonal decorations, critters and collectibles laid
 * over the island. Everything repeated is ONE InstancedMesh per kind; candle glow is faked with emissive
 * materials (per-instance flicker in TSL) and only LIGHTS real point lights follow the nearest lanterns.
 */
const LIGHTS = 3;
const sph = (r: number, w = 12, h = 9) => new THREE.SphereGeometry(r, w, h);
const cyl = (a: number, b: number, h: number, s = 10) => new THREE.CylinderGeometry(a, b, h, s);
const cone = (r: number, h: number, s = 8) => new THREE.ConeGeometry(r, h, s);
const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z);

export interface ThemeTarget { kind: 'take'; icon: string; label: string; key: string; pos: THREE.Vector3; run: () => void; }

/** carved pumpkin shell (no face) */
export function pumpkinGeo(r = 0.42) {
  const b = new Baker();
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; b.add(sph(r * 0.58, 12, 9), i % 2 ? '#e8791c' : '#f59a32', [Math.cos(a) * r * 0.42, r * 0.78, Math.sin(a) * r * 0.42], [0, -a, 0], [0.72, 0.86, 1.05]); }
  b.add(cyl(r * 0.07, r * 0.1, r * 0.35, 6), '#5d7a2c', [0, r * 1.5, 0], [0.15, 0, -0.2]);
  return b.build();
}
/** the glowing carved face (triangle eyes + toothy grin), sits just in front of the shell (+z) */
export function faceGeo(r = 0.42) {
  const b = new Baker(); b.ao = false;
  const z = r * 0.84;
  for (const s of [-1, 1]) b.add(cone(r * 0.15, r * 0.22, 3), '#ffffff', [s * r * 0.26, r * 0.95, z], [Math.PI / 2, 0, 0], [1, 1, 0.25]);
  b.add(cone(r * 0.07, r * 0.1, 3), '#ffffff', [0, r * 0.8, z + 0.01], [Math.PI / 2, 0, 0], [1, 1, 0.25]);
  for (let i = 0; i < 5; i++) b.add(box(r * 0.13, i % 2 ? r * 0.1 : r * 0.17, 0.02), '#ffffff', [(i - 2) * r * 0.15, r * (0.55 + Math.abs(i - 2) * 0.05), z - Math.abs(i - 2) * r * 0.06]);
  return b.build();
}
/** candle-glow material: per-instance flicker, emissive only (bloom on High, still bright on Low) */
function flickerMat(col: string, base = 1.6) {
  const m = new THREE.MeshBasicNodeMaterial({ color: col, fog: false });
  const ph = hash(instanceIndex).mul(40);
  const f = sin(time.mul(9).add(ph)).mul(sin(time.mul(13.7).add(ph.mul(1.7)))).mul(0.18).add(sin(time.mul(2.3).add(ph)).mul(0.08)).add(1);
  m.colorNode = vec3(new THREE.Color(col).r, new THREE.Color(col).g, new THREE.Color(col).b).mul(f.mul(float(base)));
  return m;
}
function webTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d')!; x.strokeStyle = 'rgba(255,255,255,.85)'; x.lineWidth = 1.4;
  for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 0.5; x.beginPath(); x.moveTo(0, 0); x.lineTo(Math.cos(a) * 128, Math.sin(a) * 128); x.stroke(); }
  for (let r = 18; r < 128; r += 16) { x.beginPath(); for (let i = 0; i <= 9; i++) { const a = (i / 9) * Math.PI * 0.5, rr = r + (i % 2) * 3; i ? x.quadraticCurveTo(Math.cos(a - 0.08) * rr * 0.93, Math.sin(a - 0.08) * rr * 0.93, Math.cos(a) * rr, Math.sin(a) * rr) : x.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); } x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function mistTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d')!; const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

interface Ghost { obj: THREE.Group; home: THREE.Vector3; ph: number; giggleT: number; treatT: number; spin: number; }
interface Bat { cx: number; cz: number; y: number; r: number; sp: number; ph: number; }
interface Candy { x: number; y: number; z: number; alive: boolean; t: number; }

export class Dress {
  group = new THREE.Group();
  ghosts: Ghost[] = [];
  candies: Candy[] = [];
  /** jack-o'-lantern positions (for the real-light pool + tests) */
  lanterns: THREE.Vector3[] = [];
  /** the pumpkin patch / seasonal focus centre (screenshots/tests) */
  patch = new THREE.Vector3();
  /** tappable seasonal props (snowman, gift, sunflower, …) */
  reactables: { kind: string; pos: THREE.Vector3; i: number }[] = [];
  private bats: Bat[] = [];
  private batMesh: THREE.InstancedMesh | null = null;
  private candyMesh: THREE.InstancedMesh | null = null;
  private mist: THREE.Mesh[] = [];
  private lights: THREE.PointLight[] = [];
  private lightT = 0;
  /** falling petals / leaves / snow / fireflies */
  private fx: { x: number; y: number; z: number; vx: number; vy: number; vz: number; ph: number; kind: number }[] = [];
  private fxMesh: THREE.InstancedMesh | null = null;
  /** Walker, 2026-10-29: drifting pink petals stay on the main island and Blossom Isle, never at the generated islets */
  fxKind = -1; petalsHidden = false;
  private petalsBlocked(x: number, z: number) {
    for (const d of ISLETS) if (d.id !== 'blossom' && Math.hypot(x - d.x, z - d.z) < d.r + 30) return true;
    return false;
  }
  /** brief wiggle timers for tapped props (index into reactables) */
  private wiggle: { i: number; t: number; mesh: THREE.InstancedMesh; base: THREE.Matrix4 }[] = [];
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private v = new THREE.Vector3(); private s = new THREE.Vector3();
  private flick = uniform(1);
  /** Easter egg hunt: tap an egg to find it */
  eggs: { mesh: THREE.InstancedMesh; i: number; pos: THREE.Vector3; found: boolean; base: THREE.Matrix4; pop: number }[] = [];
  eggsFound = 0;
  /** New Year fireworks: pooled sparks (one InstancedMesh), auto-launched + from tapped sky lanterns */
  fw: { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; rocket: boolean; col: THREE.Color }[] = [];
  fireworks = 0;
  private fwMesh: THREE.InstancedMesh | null = null;
  private fwNext = 1.5;
  private skyL: { x: number; y: number; z: number; ph: number; sp: number }[] = [];
  private skyLMesh: THREE.InstancedMesh | null = null;
  private balloons: { x: number; z: number; y: number; ph: number }[] = [];
  private balloonMesh: THREE.InstancedMesh | null = null;

  constructor(private g: Game) { this.rebuild(); snapSeason(theme.season); }

  /** tear down + rebuild for the active theme (called on theme change) */
  rebuild() {
    for (const c of [...this.group.children]) { this.group.remove(c); c.traverse((o) => { if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose(); }); }
    this.ghosts = []; this.candies = []; this.lanterns = []; this.bats = []; this.mist = []; this.lights = []; this.batMesh = this.candyMesh = null;
    this.reactables = []; this.fx = []; this.fxMesh = null; this.fxKind = -1; this.petalsHidden = false; this.wiggle = [];
    this.eggs = []; this.eggsFound = 0; this.fw = []; this.fwMesh = null; this.fwNext = 1.5; this.skyL = []; this.skyLMesh = null; this.balloons = []; this.balloonMesh = null;
    applyGrade(theme.grade);
    this.g.audio.setSoundscape(soundscapeFor(theme));
    const d = theme.dress;
    if (d === 'halloween') this.buildHalloween(theme);
    else if (d === 'spring') this.buildSpring(theme);
    else if (d === 'summer') this.buildSummer(theme);
    else if (d === 'autumn') this.buildAutumn(theme);
    else if (d === 'winter') this.buildWinter(theme);
    else if (d === 'thanksgiving') this.buildThanksgiving(theme);
    else if (d === 'christmas') this.buildChristmas(theme);
    else if (d === 'newyear') this.buildNewYear(theme);
    else if (d === 'valentine') this.buildValentine(theme);
    else if (d === 'easter') this.buildEaster(theme);
  }

  private spots(names: string[]) { return this.g.flora.spots.filter((s) => names.includes(s.name)); }

  private buildHalloween(t: Theme) {
    const rnd = mulberry32(1031);
    const land = (x: number, z: number) => heightAt(x, z) > 0.45;
    // ---- jack-o'-lanterns: most of the pumpkin patch + scattered by trees and near spawn ----
    const pumpkins = this.spots(['pumpkin']);
    const trees = this.spots(['oak', 'maple', 'birch', 'willow', 'pine', 'blossom']);
    const pts: { x: number; z: number; r: number; s: number }[] = [];
    let cx = 0, cz = 0;
    for (const p of pumpkins) { cx += p.x; cz += p.z; }
    if (pumpkins.length) this.patch.set(cx / pumpkins.length, 0, cz / pumpkins.length);
    pumpkins.forEach((p, i) => { if (i % 2 === 0 || rnd() < 0.3) pts.push({ x: p.x + (rnd() - 0.5) * 1.2, z: p.z + (rnd() - 0.5) * 1.2, r: rnd() * 6.28, s: 0.8 + rnd() * 0.5 }); });
    for (let i = 0; i < 26 && trees.length; i++) { const tr = trees[Math.floor(rnd() * trees.length)]; const a = rnd() * 6.28; pts.push({ x: tr.x + Math.cos(a) * 1.3, z: tr.z + Math.sin(a) * 1.3, r: rnd() * 6.28, s: 0.7 + rnd() * 0.5 }); }
    const sp = this.g.player.position;
    for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.28 + 0.4, d = 4 + rnd() * 2.5; pts.push({ x: sp.x + Math.cos(a) * d, z: sp.z + Math.sin(a) * d, r: a + Math.PI, s: 0.9 + rnd() * 0.4 }); }
    const ok = pts.filter((p) => land(p.x, p.z));
    const shell = new THREE.InstancedMesh(pumpkinGeo(), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.55 }), ok.length);
    const face = new THREE.InstancedMesh(faceGeo(), flickerMat('#ffb347', 2.2), ok.length);
    ok.forEach((p, i) => {
      const y = heightAt(p.x, p.z) - 0.04;
      // face the nearest "viewer direction": toward island centre-ish / spawn, with jitter
      const yaw = Math.atan2(sp.x - p.x, sp.z - p.z) + (rnd() - 0.5) * 1.2;
      this.m.compose(this.v.set(p.x, y, p.z), this.q.setFromEuler(new THREE.Euler(0, yaw, 0)), this.s.setScalar(p.s));
      shell.setMatrixAt(i, this.m); face.setMatrixAt(i, this.m);
      this.lanterns.push(new THREE.Vector3(p.x, y + 0.45 * p.s, p.z));
    });
    shell.castShadow = true; face.castShadow = false;
    this.group.add(shell, face);

    // ---- hanging lanterns on crook poles (a lit path around spawn + the patch) ----
    const posts: THREE.Vector3[] = [];
    for (let i = 0; i < 8; i++) { const a = (i / 8) * 6.28, d = 9; posts.push(new THREE.Vector3(sp.x + Math.cos(a) * d, 0, sp.z + Math.sin(a) * d)); }
    for (let i = 0; i < 6 && pumpkins.length; i++) { const a = (i / 6) * 6.28; posts.push(new THREE.Vector3(this.patch.x + Math.cos(a) * 6, 0, this.patch.z + Math.sin(a) * 6)); }
    const lp = posts.filter((p) => land(p.x, p.z));
    const poleB = new Baker().add(cyl(0.05, 0.06, 2.2, 7), '#3a2e44', [0, 1.1, 0]).add(cyl(0.035, 0.035, 0.6, 6), '#3a2e44', [0.28, 2.15, 0], [0, 0, Math.PI / 2])
      .add(cyl(0.012, 0.012, 0.25, 4), '#2a2238', [0.55, 2.02, 0]).add(cone(0.16, 0.14, 6), '#2a2238', [0.55, 1.88, 0]).add(cyl(0.12, 0.1, 0.05, 6), '#2a2238', [0.55, 1.58, 0]);
    const poles = new THREE.InstancedMesh(poleB.build(), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.7 }), lp.length);
    const glass = new THREE.InstancedMesh(cyl(0.1, 0.1, 0.24, 6).translate(0.55, 1.72, 0), flickerMat('#ffa64a', 2.4), lp.length);
    lp.forEach((p, i) => {
      p.y = heightAt(p.x, p.z) - 0.05;
      this.m.compose(p, this.q.setFromEuler(new THREE.Euler(0, rnd() * 6.28, 0)), this.s.setScalar(1));
      poles.setMatrixAt(i, this.m); glass.setMatrixAt(i, this.m);
      this.lanterns.push(new THREE.Vector3(0.55, 1.72, 0).applyMatrix4(this.m));
    });
    poles.castShadow = true; this.group.add(poles, glass);

    // ---- cobwebs in some trees ----
    const webMat = new THREE.MeshBasicNodeMaterial({ map: webTexture(), transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide });
    const webTrees = trees.filter((_, i) => i % 5 === 0).slice(0, 24);
    const webs = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.4, 1.4).translate(0.7, -0.7, 0), webMat, webTrees.length);
    webTrees.forEach((tr, i) => {
      const yaw = rnd() * 6.28;
      this.m.compose(this.v.set(tr.x + Math.sin(yaw) * 0.25, heightAt(tr.x, tr.z) + 1.7 * tr.sc, tr.z + Math.cos(yaw) * 0.25), this.q.setFromEuler(new THREE.Euler(0, yaw, 0.3)), this.s.setScalar(0.8 + rnd() * 0.6));
      webs.setMatrixAt(i, this.m);
    });
    webs.renderOrder = 2; this.group.add(webs);

    // ---- a tiny cozy graveyard by the patch (rounded stones, flowers, no gloom) ----
    const gyc = pumpkins.length ? this.patch.clone().add(new THREE.Vector3(5, 0, -4)) : sp.clone().add(new THREE.Vector3(10, 0, 6));
    const stoneB = new Baker().add(box(0.6, 0.6, 0.16), '#9a98a8', [0, 0.3, 0]).add(cyl(0.3, 0.3, 0.16, 12), '#9a98a8', [0, 0.6, 0], [Math.PI / 2, 0, 0])
      .add(box(0.3, 0.05, 0.02), '#6e6c80', [0, 0.55, 0.085]).add(box(0.05, 0.22, 0.02), '#6e6c80', [0, 0.5, 0.085])
      .add(sph(0.07, 6, 5), '#ff9ac0', [0.24, 0.05, 0.14]).add(sph(0.06, 6, 5), '#ffe066', [-0.22, 0.04, 0.16]).add(box(0.7, 0.05, 0.5), '#5f8f4a', [0, 0.01, 0.12]);
    const stones: THREE.Matrix4[] = [];
    for (let i = 0; i < 12; i++) {
      const x = gyc.x + (i % 4) * 1.5 - 2.2 + (rnd() - 0.5) * 0.4, z = gyc.z + Math.floor(i / 4) * 1.6 - 1.6 + (rnd() - 0.5) * 0.4;
      if (!land(x, z)) continue;
      stones.push(new THREE.Matrix4().compose(new THREE.Vector3(x, heightAt(x, z) - 0.06, z), this.q.setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.15, (rnd() - 0.5) * 0.4, (rnd() - 0.5) * 0.18)).clone(), this.s.setScalar(0.8 + rnd() * 0.4).clone()));
    }
    const graves = new THREE.InstancedMesh(stoneB.build(), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.85 }), Math.max(1, stones.length));
    stones.forEach((mm, i) => graves.setMatrixAt(i, mm)); graves.count = stones.length; graves.castShadow = true;
    this.group.add(graves);

    // ---- bats: one instanced mesh, wings flap by squashing x (cheap) ----
    if (t.critters.bats) {
      const batB = new Baker().add(sph(0.12, 8, 6), '#2e2440', [0, 0, 0], [0, 0, 0], [1, 0.9, 1.2]).add(sph(0.09, 8, 6), '#2e2440', [0, 0.1, 0.1])
        .add(cone(0.04, 0.09, 4), '#2e2440', [0.05, 0.2, 0.1]).add(cone(0.04, 0.09, 4), '#2e2440', [-0.05, 0.2, 0.1])
        .add(sph(0.02, 5, 4), '#ffd27a', [0.035, 0.12, 0.18]).add(sph(0.02, 5, 4), '#ffd27a', [-0.035, 0.12, 0.18]);
      for (const s of [-1, 1]) for (let k = 0; k < 3; k++) batB.add(sph(0.14 - k * 0.025, 7, 4), '#4a3a66', [s * (0.17 + k * 0.12), 0.02 - k * 0.03, 0], [0, 0, s * (0.15 + k * 0.2)], [1, 0.7, 0.08]);
      const flocks = [sp.clone().add(new THREE.Vector3(6, 0, 8)), this.patch.clone(), gyc.clone(), sp.clone().add(new THREE.Vector3(-14, 0, -6))];
      for (let i = 0; i < 18; i++) { const f = flocks[i % flocks.length]; this.bats.push({ cx: f.x, cz: f.z, y: 4 + rnd() * 3, r: 2.5 + rnd() * 4, sp: (0.6 + rnd() * 0.6) * (rnd() < 0.5 ? -1 : 1), ph: rnd() * 6.28 }); }
      this.batMesh = new THREE.InstancedMesh(batB.build(), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.6 }), this.bats.length);
      this.batMesh.frustumCulled = false; this.group.add(this.batMesh);
    }

    // ---- friendly ghosts ----
    if (t.critters.ghosts) {
      const homes = [sp.clone().add(new THREE.Vector3(3.5, 0, 3)), this.patch.clone().add(new THREE.Vector3(1.5, 0, 1.5)), gyc.clone(), sp.clone().add(new THREE.Vector3(-8, 0, 5))];
      for (let i = 0; i < 4 && trees.length; i++) { const tr = trees[Math.floor(rnd() * trees.length)]; homes.push(new THREE.Vector3(tr.x + 1.5, 0, tr.z + 1)); }
      for (const h of homes) if (land(h.x, h.z)) this.addGhost(h, rnd);
    }

    // ---- candy pickups: wrapped sweets bobbing in the grass ----
    if (t.collectibles.candy) {
      const all = this.g.flora.spots;
      for (let i = 0; i < 36; i++) {
        const s = all[Math.floor(rnd() * all.length)]; const x = s.x + 0.8, z = s.z + 0.5;
        if (land(x, z)) this.candies.push({ x, y: heightAt(x, z) + 0.35, z, alive: true, t: 0 });
      }
      for (let i = 0; i < 5; i++) { const a = i * 1.3 + 0.7, d = 2.5 + i * 0.6; const x = sp.x + Math.cos(a) * d, z = sp.z + Math.sin(a) * d; if (land(x, z)) this.candies.push({ x, y: heightAt(x, z) + 0.35, z, alive: true, t: 0 }); }
      const cb = new Baker().add(sph(0.11, 10, 8), '#ff5fa2', [0, 0, 0], [0, 0, 0], [1.3, 1, 1]).add(cone(0.08, 0.12, 6), '#ffd24d', [0.19, 0, 0], [0, 0, Math.PI / 2]).add(cone(0.08, 0.12, 6), '#ffd24d', [-0.19, 0, 0], [0, 0, -Math.PI / 2])
        .add(torus(0.11), '#ffffff', [0, 0, 0], [0, Math.PI / 2, 0], [1, 1, 0.5]);
      this.candyMesh = new THREE.InstancedMesh(cb.build(), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.3, emissive: new THREE.Color('#ff7ab0'), emissiveIntensity: 0.25 }), this.candies.length);
      this.candyMesh.frustumCulled = false; this.group.add(this.candyMesh);
    }

    // ---- light ground mist: a few huge soft discs near the ground ----
    const mm = new THREE.MeshBasicNodeMaterial({ map: mistTexture(), transparent: true, opacity: 0.16, depthWrite: false, color: '#d8c8ff' });
    for (let i = 0; i < 10; i++) {
      const a = rnd() * 6.28, d = 6 + rnd() * 30; const x = sp.x + Math.cos(a) * d, z = sp.z + Math.sin(a) * d;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(16, 16).rotateX(-Math.PI / 2), mm); m.position.set(x, Math.max(0.2, heightAt(x, z)) + 0.35, z);
      m.renderOrder = 3; m.userData.ph = rnd() * 6.28; this.mist.push(m); this.group.add(m);
    }

    // ---- a few real lights, re-homed to the nearest lanterns ----
    for (let i = 0; i < LIGHTS; i++) { const l = new THREE.PointLight('#ff9a3c', 0, 7, 1.6); l.castShadow = false; this.lights.push(l); this.group.add(l); }
    this.lightT = 0;
  }

  private addGhost(home: THREE.Vector3, rnd: () => number) {
    const g = new THREE.Group();
    const body = new THREE.MeshStandardNodeMaterial({ color: '#f8f4ff', roughness: 0.5, emissive: new THREE.Color('#cdbcff'), emissiveIntensity: 0.35, transparent: true, opacity: 0.93 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), body); head.position.y = 0.55;
    // wavy skirt: a flared open cylinder with a scalloped hem
    const sk = new THREE.CylinderGeometry(0.4, 0.5, 0.6, 18, 3, true); const pa = sk.attributes.position;
    for (let i = 0; i < pa.count; i++) if (pa.getY(i) < -0.29) { const a = Math.atan2(pa.getZ(i), pa.getX(i)); pa.setY(i, pa.getY(i) + Math.sin(a * 6) * 0.07); }
    sk.computeVertexNormals();
    const skirt = new THREE.Mesh(sk, body.clone()); (skirt.material as THREE.MeshStandardNodeMaterial).side = THREE.DoubleSide; skirt.position.y = 0.32;
    const dark = new THREE.MeshBasicNodeMaterial({ color: '#2a2238' });
    const pink = new THREE.MeshBasicNodeMaterial({ color: '#ffa0c0' });
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(sph(0.06, 8, 6), dark); e.scale.set(1, 1.3, 0.5); e.position.set(s * 0.13, 0.7, 0.38); g.add(e);
      const hl = new THREE.Mesh(sph(0.018, 5, 4), new THREE.MeshBasicNodeMaterial({ color: '#ffffff' })); hl.position.set(s * 0.13 + 0.02, 0.73, 0.41); g.add(hl);
      const c = new THREE.Mesh(sph(0.05, 8, 6), pink); c.scale.set(1, 0.6, 0.3); c.position.set(s * 0.24, 0.6, 0.34); g.add(c);
      const arm = new THREE.Mesh(sph(0.1, 8, 6), body); arm.scale.set(0.7, 1.2, 0.7); arm.position.set(s * 0.45, 0.42, 0.05); arm.rotation.z = s * 0.6; arm.name = s < 0 ? 'armL' : 'armR'; g.add(arm);
    }
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.014, 5, 10, Math.PI), dark); mouth.rotation.z = Math.PI; mouth.position.set(0, 0.6, 0.41); g.add(mouth);
    g.add(head, skirt);
    g.traverse((o) => { o.castShadow = false; });
    g.position.copy(home); g.userData.ghost = true;
    this.group.add(g);
    this.ghosts.push({ obj: g, home: home.clone(), ph: rnd() * 6.28, giggleT: 0, treatT: 0, spin: 0 });
  }

  /** contextual action near a ghost: trick-or-treat */
  target(p: THREE.Vector3): ThemeTarget | null {
    for (const gh of this.ghosts) {
      const o = gh.obj.position;
      if (Math.hypot(o.x - p.x, o.z - p.z) < 2.3) {
        return { kind: 'take', icon: '👻', label: gh.treatT > 0 ? 'Say Boo!' : 'Trick or Treat', key: `ghost:${gh.treatT > 0 ? 'boo' : 'treat'}`, pos: o.clone().add(new THREE.Vector3(0, 1.3, 0)), run: () => this.trickOrTreat(gh) };
      }
    }
    return null;
  }

  /** tap reactions: a ghost giggles + twirls (or trick-or-treats if you're beside it); a jack-o'-lantern flares */
  reactions = 0;
  tapAt(cx: number, cy: number, project: (v: THREE.Vector3) => { x: number; y: number }, lim: number): boolean {
    if (!this.group.children.length) return false;
    const p = this.g.player.position, v = new THREE.Vector3();
    let best: Ghost | null = null, bd = lim;
    for (const gh of this.ghosts) {
      if (gh.obj.position.distanceTo(p) > 16) continue;
      const s = project(v.copy(gh.obj.position).add(new THREE.Vector3(0, 0.55, 0))); const d = Math.hypot(s.x - cx, s.y - cy);
      if (d < bd) { bd = d; best = gh; }
    }
    if (best) {
      this.reactions++;
      const o = best.obj.position;
      if (Math.hypot(o.x - p.x, o.z - p.z) < 2.3) { this.trickOrTreat(best); return true; }
      best.spin = 1; best.giggleT = 4; this.g.audio.giggle(1.2 + Math.random() * 0.2);
      this.g.play.emote(o.clone().add(new THREE.Vector3(0, 1.2, 0)), ['👻', '💜', 'Tee hee!', '✨'][Math.floor(Math.random() * 4)]);
      return true;
    }
    let li = -1; bd = lim * 0.8;
    this.lanterns.forEach((l, i) => { if (l.distanceTo(p) > 14) return; const s = project(v.copy(l)); const d = Math.hypot(s.x - cx, s.y - cy); if (d < bd) { bd = d; li = i; } });
    if (li >= 0) {
      this.reactions++;
      const l = this.lanterns[li];
      this.flare = { pos: l.clone(), t: 0.8 }; this.lightT = 0;
      this.g.audio.pop(0.7); this.g.play.emote(l.clone().add(new THREE.Vector3(0, 0.5, 0)), ['🎃', '✨', '🕯️'][li % 3]);
      return true;
    }
    // Easter eggs: tap to find
    let ei = -1; bd = lim;
    this.eggs.forEach((e, i) => { if (e.found || e.pos.distanceTo(p) > 18) return; const s = project(v.copy(e.pos)); const d = Math.hypot(s.x - cx, s.y - cy); if (d < bd) { bd = d; ei = i; } });
    if (ei >= 0) { this.reactions++; this.findEgg(ei); return true; }
    // seasonal props: snowman wiggle, gift bounce, sunflower nod, …
    let ri = -1; bd = lim;
    this.reactables.forEach((r, i) => {
      if (r.pos.distanceTo(p) > 14) return;
      const s = project(v.copy(r.pos)); const d = Math.hypot(s.x - cx, s.y - cy);
      if (d < bd) { bd = d; ri = i; }
    });
    if (ri >= 0) {
      this.reactions++;
      const r = this.reactables[ri];
      const emoji: Record<string, string[]> = {
        snowman: ['⛄', '❄️', '✨'], gift: ['🎁', '🎀', '✨'], sunflower: ['🌻', '☀️', '✨'],
        haybale: ['🌾', '🍂'], cornucopia: ['🦃', '🌽'], blossom: ['🌸', '💕'], xmastree: ['🎄', '✨', '⭐'],
        heart: ['💖', '💕', '💗'], rose: ['🌹', '💕'], skylantern: ['🏮', '🎆', '✨'], chick: ['🐣', '💛', 'Peep!'],
      };
      const em = (emoji[r.kind] ?? ['✨'])[ri % (emoji[r.kind]?.length ?? 1)];
      if (r.kind === 'skylantern' || r.kind === 'heart') this.launch(r.pos.x, r.pos.z, r.kind === 'heart');
      this.g.audio.pop(0.75); this.g.play.emote(r.pos.clone().add(new THREE.Vector3(0, 0.8, 0)), em);
      // find the instanced mesh that owns this instance and start a short wiggle
      for (const c of this.group.children) {
        const im = c as THREE.InstancedMesh;
        if (!im.isInstancedMesh || !im.userData.reactKind || im.userData.reactKind !== r.kind) continue;
        const base = new THREE.Matrix4(); im.getMatrixAt(r.i, base);
        this.wiggle.push({ i: r.i, t: 0.55, mesh: im, base });
        break;
      }
      return true;
    }
    return false;
  }
  private flare: { pos: THREE.Vector3; t: number } | null = null;

  trickOrTreat(gh: Ghost) {
    const play = this.g.play, pos = gh.obj.position.clone().add(new THREE.Vector3(0, 0.9, 0));
    gh.spin = 1; this.g.audio.giggle(1.25);
    if (gh.treatT > 0) { play.toast(['👻 Hee hee! You found me!', '👻 Boo! …did I scare you? Tee hee!', '👻 Happy Halloween!'][Math.floor(Math.random() * 3)]); return; }
    gh.treatT = 45;
    const n = 2 + Math.floor(Math.random() * 3);
    play.addCandy(n, pos);
    // a big candy haul can be swapped for a Halloween wearable
    if (play.candy >= 8 && play.giveThemeWear(pos, theme.collectibles.wear, `👻 "Ooh, so much candy!" The ghost swaps 8 🍬 for a`)) play.addCandy(-8, pos);
    else play.toast(`👻 Tee hee! Treats! <b>+${n} 🍬</b> <small>(${play.candy} candy)</small>`);
  }

  update(dt: number, t: number) {
    updateSeason(theme.season, dt);
    if (!this.group.children.length) return;
    const p = this.g.player.position;
    // ghosts: float, bob, drift around home, turn to look at you, giggle when you come close
    for (const gh of this.ghosts) {
      const o = gh.obj, a = t * 0.35 + gh.ph;
      const tx = gh.home.x + Math.cos(a) * 1.4, tz = gh.home.z + Math.sin(a * 1.3) * 1.1;
      o.position.x += (tx - o.position.x) * Math.min(1, dt * 1.5); o.position.z += (tz - o.position.z) * Math.min(1, dt * 1.5);
      o.position.y = heightAt(o.position.x, o.position.z) + 0.35 + Math.sin(t * 2.2 + gh.ph) * 0.12;
      const d = Math.hypot(p.x - o.position.x, p.z - o.position.z);
      const want = d < 7 ? Math.atan2(p.x - o.position.x, p.z - o.position.z) : a + Math.PI / 2;
      let dy = want - o.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      gh.spin = Math.max(0, gh.spin - dt * 0.9);
      o.rotation.y += dy * Math.min(1, dt * 3) + (gh.spin > 0 ? dt * 14 * gh.spin : 0);
      o.rotation.z = Math.sin(t * 1.7 + gh.ph) * 0.08;
      for (const c of o.children) if (c.name) c.rotation.x = Math.sin(t * 3 + gh.ph + (c.name === 'armL' ? 0 : 1.5)) * 0.4;
      gh.giggleT -= dt; gh.treatT = Math.max(0, gh.treatT - dt);
      if (d < 4 && gh.giggleT <= 0) { gh.giggleT = 9 + Math.random() * 6; this.g.audio.giggle(1.15 + Math.random() * 0.2); }
    }
    // bats
    if (this.batMesh) this.bats.forEach((b, i) => {
      const a = t * b.sp + b.ph;
      const x = b.cx + Math.cos(a) * b.r, z = b.cz + Math.sin(a) * b.r * 0.8, y = Math.max(heightAt(b.cx, b.cz), 0) + b.y + Math.sin(t * 1.6 + b.ph) * 0.5;
      const flap = 0.35 + Math.abs(Math.sin(t * 16 + b.ph)) * 0.75;
      this.m.compose(this.v.set(x, y, z), this.q.setFromEuler(new THREE.Euler(0, -a + (b.sp > 0 ? 0 : Math.PI), Math.sin(a) * 0.2)), this.s.set(flap, 1, 1));
      this.batMesh!.setMatrixAt(i, this.m);
    });
    if (this.batMesh) this.batMesh.instanceMatrix.needsUpdate = true;
    // candy: spin + bob, collected when you walk through; respawns later
    if (this.candyMesh) {
      this.candies.forEach((c, i) => {
        if (!c.alive) { c.t -= dt; if (c.t <= 0) c.alive = true; }
        if (c.alive && Math.hypot(p.x - c.x, p.z - c.z) < 1.1 && Math.abs(p.y - c.y) < 2) { c.alive = false; c.t = 90; this.g.play.addCandy(1, new THREE.Vector3(c.x, c.y, c.z)); }
        this.m.compose(this.v.set(c.x, c.y + Math.sin(t * 2 + i) * 0.08, c.z), this.q.setFromEuler(new THREE.Euler(0.3, t * 1.5 + i, 0)), this.s.setScalar(c.alive ? 1 : 0));
        this.candyMesh!.setMatrixAt(i, this.m);
      });
      this.candyMesh.instanceMatrix.needsUpdate = true;
    }
    for (const m of this.mist) { m.position.x += Math.sin(t * 0.05 + m.userData.ph) * dt * 0.3; }
    // real lights → nearest lanterns, with candle flicker
    this.lightT -= dt;
    if (this.lightT <= 0 && this.lights.length) {
      this.lightT = 0.5;
      const near = this.lanterns.map((l) => [l.distanceToSquared(p), l] as const).sort((a, b) => a[0] - b[0]).slice(0, this.lights.length);
      near.forEach(([, l], i) => this.lights[i].position.copy(l).add(new THREE.Vector3(0, 0.2, 0)));
    }
    if (this.flare && this.lights.length) { this.flare.t -= dt; this.lights[0].position.copy(this.flare.pos).add(new THREE.Vector3(0, 0.3, 0)); if (this.flare.t <= 0) this.flare = null; }
    this.lights.forEach((l, i) => { l.intensity = (i === 0 && this.flare ? 6 * this.flare.t + 2 : 0) + (2.2 + Math.sin(t * 11 + i * 2) * 0.3 + Math.sin(t * 17.3 + i) * 0.2) * (1 - this.g.caveK); });
    // falling / floating dress particles
    if (this.fxMesh && this.fx.length) {
      const sp = this.g.player.position;
      this.petalsHidden = this.fxKind === 0 && this.petalsBlocked(sp.x, sp.z);
      this.fxMesh.visible = !this.petalsHidden;
    }
    if (this.fxMesh && this.fx.length && !this.petalsHidden) {
      const sp = this.g.player.position;
      this.fx.forEach((f, i) => {
        f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt; f.ph += dt;
        if (f.y < Math.max(0.2, heightAt(f.x, f.z)) + 0.15 || Math.hypot(f.x - sp.x, f.z - sp.z) > 42) {
          const a = Math.random() * 6.28, d = 4 + Math.random() * 28;
          f.x = sp.x + Math.cos(a) * d; f.z = sp.z + Math.sin(a) * d;
          f.y = Math.max(0.4, heightAt(f.x, f.z)) + 2 + Math.random() * 6;
        }
        const sc = f.kind === 3 ? 0.35 + Math.abs(Math.sin(t * 4 + f.ph)) * 0.25 : 0.55;
        this.m.compose(this.v.set(f.x, f.y, f.z), this.q.setFromEuler(new THREE.Euler(f.ph * 0.7, f.ph, f.ph * 0.4)), this.s.setScalar(sc));
        this.fxMesh!.setMatrixAt(i, this.m);
      });
      this.fxMesh.instanceMatrix.needsUpdate = true;
    }
    this.updateHoliday(dt, t);
    // tapped-prop wiggle
    for (let i = this.wiggle.length - 1; i >= 0; i--) {
      const w = this.wiggle[i]; w.t -= dt;
      const k = Math.max(0, w.t); const wob = Math.sin((0.55 - k) * 28) * k * 0.35;
      this.m.copy(w.base);
      const e = new THREE.Euler().setFromRotationMatrix(this.m);
      e.z += wob; e.x += wob * 0.4;
      this.q.setFromEuler(e);
      this.v.setFromMatrixPosition(w.base);
      this.s.setFromMatrixScale(w.base);
      if (w.mesh.userData.reactKind === 'gift') this.v.y += Math.abs(Math.sin((0.55 - k) * 18)) * k * 0.4;
      this.m.compose(this.v, this.q, this.s);
      w.mesh.setMatrixAt(w.i, this.m); w.mesh.instanceMatrix.needsUpdate = true;
      if (w.t <= 0) { w.mesh.setMatrixAt(w.i, w.base); w.mesh.instanceMatrix.needsUpdate = true; this.wiggle.splice(i, 1); }
    }
    void this.flick;
  }

  // ---- shared helpers for seasonal dress ----
  private landOk(x: number, z: number) { return heightAt(x, z) > 0.45; }
  private scatterAround(sp: THREE.Vector3, n: number, r0: number, r1: number, rnd: () => number) {
    const out: { x: number; z: number; r: number; s: number }[] = [];
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.28, d = r0 + rnd() * (r1 - r0);
      const x = sp.x + Math.cos(a) * d, z = sp.z + Math.sin(a) * d;
      if (this.landOk(x, z)) out.push({ x, z, r: rnd() * 6.28, s: 0.75 + rnd() * 0.5 });
    }
    return out;
  }
  private placeInstanced(geo: THREE.BufferGeometry, mat: THREE.Material, pts: { x: number; z: number; r: number; s: number }[], yOff = 0, cast = true) {
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, pts.length));
    pts.forEach((p, i) => {
      const y = heightAt(p.x, p.z) + yOff;
      this.m.compose(this.v.set(p.x, y, p.z), this.q.setFromEuler(new THREE.Euler(0, p.r, 0)), this.s.setScalar(p.s));
      mesh.setMatrixAt(i, this.m);
    });
    mesh.count = pts.length; mesh.castShadow = cast; this.group.add(mesh);
    return mesh;
  }
  private addFx(kind: 'petal' | 'leaf' | 'snow' | 'firefly', n: number, cols: string[]) {
    const sp = this.g.player.position;
    const geo = kind === 'firefly' ? sph(0.08, 8, 6) : new THREE.PlaneGeometry(0.35, 0.35);
    const mat = kind === 'firefly'
      ? new THREE.MeshBasicNodeMaterial({ color: cols[0], transparent: true, opacity: 0.9, depthWrite: false })
      : new THREE.MeshBasicNodeMaterial({ color: cols[0], transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, d = 3 + Math.random() * 30;
      const x = sp.x + Math.cos(a) * d, z = sp.z + Math.sin(a) * d;
      const fall = kind === 'firefly' ? 0.15 + Math.random() * 0.25 : kind === 'snow' ? -0.55 - Math.random() * 0.4 : -0.7 - Math.random() * 0.5;
      this.fx.push({
        x, y: Math.max(0.5, heightAt(x, z)) + 1.5 + Math.random() * 5, z,
        vx: (Math.random() - 0.5) * (kind === 'firefly' ? 0.8 : 0.6),
        vy: fall, vz: (Math.random() - 0.5) * (kind === 'firefly' ? 0.8 : 0.6),
        ph: Math.random() * 6.28, kind: kind === 'petal' ? 0 : kind === 'leaf' ? 1 : kind === 'snow' ? 2 : 3,
      });
    }
    this.fxKind = kind === 'petal' ? 0 : kind === 'leaf' ? 1 : kind === 'snow' ? 2 : 3;
    this.fxMesh = new THREE.InstancedMesh(geo, mat, n);
    this.fxMesh.frustumCulled = false; this.fxMesh.renderOrder = 4; this.group.add(this.fxMesh);
    // tint variety via vertex colors isn't free here; swap a second mesh color by cycling material isn't needed
    void cols;
  }
  private markReact(mesh: THREE.InstancedMesh, kind: string, pts: { x: number; z: number; s: number }[], yLift: number) {
    mesh.userData.reactKind = kind;
    pts.forEach((p, i) => this.reactables.push({ kind, pos: new THREE.Vector3(p.x, heightAt(p.x, p.z) + yLift * p.s, p.z), i }));
  }

  private buildSpring(_t: Theme) {
    const rnd = mulberry32(301); const sp = this.g.player.position;
    this.patch.copy(sp);
    const blossom = blossomBushGeo();
    const trees = this.spots(['blossom', 'oak', 'maple', 'birch', 'willow']);
    const pts = this.scatterAround(sp, 18, 3, 22, rnd);
    for (let i = 0; i < 10 && trees.length; i++) {
      const tr = trees[Math.floor(rnd() * trees.length)]; const a = rnd() * 6.28;
      const x = tr.x + Math.cos(a) * 1.4, z = tr.z + Math.sin(a) * 1.4;
      if (this.landOk(x, z)) pts.push({ x, z, r: rnd() * 6.28, s: 0.7 + rnd() * 0.45 });
    }
    const mesh = this.placeInstanced(blossom, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.55 }), pts, -0.02);
    this.markReact(mesh, 'blossom', pts, 0.55);
    this.addFx('petal', 28, ['#ffc0d8', '#fff0f5', '#ffb0c8']);
  }

  private buildSummer(_t: Theme) {
    const rnd = mulberry32(602); const sp = this.g.player.position;
    this.patch.copy(sp).add(new THREE.Vector3(4, 0, 3));
    const pts = this.scatterAround(sp, 16, 4, 20, rnd);
    const mesh = this.placeInstanced(sunflowerGeo(), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.5 }), pts, -0.02);
    this.markReact(mesh, 'sunflower', pts, 1.1);
    // beach umbrellas near spawn
    const umb = this.scatterAround(sp, 5, 6, 14, rnd);
    this.placeInstanced(umbrellaGeo(), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.45 }), umb, -0.02);
    this.addFx('firefly', 22, ['#e8ff8a']);
  }

  private buildAutumn(_t: Theme) {
    const rnd = mulberry32(903); const sp = this.g.player.position;
    this.patch.copy(sp).add(new THREE.Vector3(-3, 0, 5));
    const piles = this.scatterAround(this.patch, 14, 1, 10, rnd);
    this.placeInstanced(leafPileGeo(), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.75 }), piles, -0.04, false);
    const bales = this.scatterAround(this.patch, 8, 2, 12, rnd);
    const hay = this.placeInstanced(haybaleGeo(), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.7 }), bales, -0.02);
    this.markReact(hay, 'haybale', bales, 0.45);
    this.addFx('leaf', 32, ['#e07030', '#d4a020', '#c04020']);
  }

  private buildWinter(_t: Theme) {
    const rnd = mulberry32(1201); const sp = this.g.player.position;
    this.patch.copy(sp).add(new THREE.Vector3(2, 0, -4));
    const patches = this.scatterAround(sp, 14, 2, 20, rnd);
    this.placeInstanced(snowPatchGeo(), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.85 }), patches, -0.03, false);
    const men = this.scatterAround(this.patch, 6, 1, 9, rnd);
    const sm = this.placeInstanced(snowmanGeo(), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.55 }), men, -0.02);
    this.markReact(sm, 'snowman', men, 1.0);
    this.addFx('snow', 36, ['#ffffff']);
  }

  private buildThanksgiving(_t: Theme) {
    const rnd = mulberry32(1124); const sp = this.g.player.position;
    this.patch.copy(sp).add(new THREE.Vector3(5, 0, 2));
    const maize = this.scatterAround(this.patch, 12, 1, 10, rnd);
    this.placeInstanced(maizeGeo(), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.55 }), maize, -0.02);
    const corns = this.scatterAround(this.patch, 4, 1, 6, rnd);
    const c = this.placeInstanced(cornucopiaGeo(), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.55 }), corns, -0.02);
    this.markReact(c, 'cornucopia', corns, 0.5);
    const piles = this.scatterAround(this.patch, 10, 2, 12, rnd);
    this.placeInstanced(leafPileGeo(), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.75 }), piles, -0.04, false);
    this.addFx('leaf', 24, ['#d4882a', '#c06020']);
  }

  private buildChristmas(_t: Theme) {
    const rnd = mulberry32(1225); const sp = this.g.player.position;
    this.patch.copy(sp).add(new THREE.Vector3(0, 0, 6));
    const trees = this.scatterAround(this.patch, 7, 1, 10, rnd);
    const xt = this.placeInstanced(xmastreeGeo(), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.5, emissive: new THREE.Color('#224422'), emissiveIntensity: 0.15 }), trees, -0.02);
    this.markReact(xt, 'xmastree', trees, 1.4);
    // glowing ornaments as separate emissive instances on trees
    const lights: { x: number; z: number; r: number; s: number }[] = [];
    trees.forEach((p) => { for (let k = 0; k < 3; k++) lights.push({ x: p.x + (rnd() - 0.5) * 0.6, z: p.z + (rnd() - 0.5) * 0.6, r: rnd() * 6.28, s: p.s }); });
    const ornGeo = sph(0.07, 8, 6);
    const orn = new THREE.InstancedMesh(ornGeo, flickerMat('#ff6a6a', 1.8), Math.max(1, lights.length));
    lights.forEach((p, i) => {
      const y = heightAt(p.x, p.z) + (0.6 + (i % 3) * 0.45) * p.s;
      this.m.compose(this.v.set(p.x, y, p.z), this.q.identity(), this.s.setScalar(p.s));
      orn.setMatrixAt(i, this.m);
    });
    orn.count = lights.length; this.group.add(orn);
    const gifts = this.scatterAround(this.patch, 10, 1.5, 8, rnd);
    const gm = this.placeInstanced(giftGeo(), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.4 }), gifts, -0.02);
    this.markReact(gm, 'gift', gifts, 0.35);
    const canes = this.scatterAround(this.patch, 8, 2, 9, rnd);
    this.placeInstanced(candyCaneGeo(), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.35 }), canes, -0.02);
    this.addFx('snow', 28, ['#ffffff']);
  }

  // ---------------- holidays: New Year, Valentine's, Easter ----------------
  private buildNewYear(_t: Theme) {
    const rnd = mulberry32(101); const sp = this.g.player.position;
    this.patch.copy(sp).add(new THREE.Vector3(0, 0, 6));
    // ground lanterns you can tap to launch a firework
    const posts = this.scatterAround(this.patch, 8, 1.5, 9, rnd);
    const lm = this.placeInstanced(skyLanternGeo(), flickerMat('#ffc070', 1.7), posts, 0.05, false);
    this.markReact(lm, 'skylantern', posts, 0.5);
    // paper sky lanterns drifting up into the night
    this.skyLMesh = new THREE.InstancedMesh(skyLanternGeo(), flickerMat('#ffb050', 1.9), 26);
    this.skyLMesh.frustumCulled = false; this.group.add(this.skyLMesh);
    for (let i = 0; i < 26; i++) { const a = rnd() * 6.28, d = 6 + rnd() * 30; this.skyL.push({ x: sp.x + Math.cos(a) * d, z: sp.z + Math.sin(a) * d, y: 2 + rnd() * 30, ph: rnd() * 6.28, sp: 0.5 + rnd() * 0.5 }); }
    this.initFireworks();
    this.addFx('snow', 18, ['#ffffff']);
  }
  private buildValentine(_t: Theme) {
    const rnd = mulberry32(214); const sp = this.g.player.position;
    this.patch.copy(sp).add(new THREE.Vector3(3, 0, 5));
    const roses = this.scatterAround(sp, 16, 3, 18, rnd);
    const rm = this.placeInstanced(roseBushGeo(), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.6 }), roses, -0.02);
    this.markReact(rm, 'rose', roses, 0.5);
    // heart balloons bobbing on strings around the patch (tap: a heart burst)
    const bl = this.scatterAround(this.patch, 9, 1, 8, rnd);
    this.balloonMesh = new THREE.InstancedMesh(heartBalloonGeo(), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.05, emissive: new THREE.Color('#ff4a7a'), emissiveIntensity: 0.12 }), Math.max(1, bl.length));
    this.balloonMesh.count = bl.length; this.balloonMesh.castShadow = true; this.group.add(this.balloonMesh);
    this.balloonMesh.userData.reactKind = 'heart';
    bl.forEach((b, i) => { this.balloons.push({ x: b.x, z: b.z, y: heightAt(b.x, b.z), ph: rnd() * 6.28 }); this.reactables.push({ kind: 'heart', pos: new THREE.Vector3(b.x, heightAt(b.x, b.z) + 1.9, b.z), i }); });
    this.initFireworks(true);
    this.addFx('petal', 30, ['#ff8ab0']);
  }
  private buildEaster(_t: Theme) {
    const rnd = mulberry32(404); const sp = this.g.player.position;
    this.patch.copy(sp).add(new THREE.Vector3(-3, 0, 5));
    const bushes = this.scatterAround(sp, 12, 3, 18, rnd);
    const bm = this.placeInstanced(blossomBushGeo(), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.55 }), bushes, -0.02);
    this.markReact(bm, 'blossom', bushes, 0.55);
    const chicks = this.scatterAround(this.patch, 5, 1, 6, rnd);
    const cm = this.placeInstanced(chickGeo(), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.6 }), chicks, -0.01);
    this.markReact(cm, 'chick', chicks, 0.25);
    // hidden painted eggs: 4 palettes, 16 eggs tucked by bushes, flowers and trees
    const pals = [['#ff9ac0', '#fff0a0'], ['#9ad0ff', '#ffffff'], ['#b8f0a0', '#ffd0f0'], ['#d0b0ff', '#fff4c0']];
    const hides = [...this.spots(['oak', 'maple', 'birch', 'blossom', 'willow']).slice(0, 40), ...bushes.map((b) => ({ x: b.x, z: b.z }))];
    const pts: { x: number; z: number; r: number; s: number }[] = [];
    for (let i = 0; i < 40 && pts.length < 16 && hides.length; i++) {
      const h = hides[Math.floor(rnd() * hides.length)]; const a = rnd() * 6.28, x = h.x + Math.cos(a) * 0.9, z = h.z + Math.sin(a) * 0.9;
      if (this.landOk(x, z) && Math.hypot(x - sp.x, z - sp.z) < 30) pts.push({ x, z, r: rnd() * 6.28, s: 0.9 + rnd() * 0.3 });
    }
    pals.forEach((pal, k) => {
      const mine = pts.filter((_, i) => i % 4 === k);
      const mesh = this.placeInstanced(eggGeo(pal[0], pal[1]), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.35 }), mine, 0.0);
      mine.forEach((p, i) => { const base = new THREE.Matrix4(); mesh.getMatrixAt(i, base); this.eggs.push({ mesh, i, pos: new THREE.Vector3(p.x, heightAt(p.x, p.z) + 0.18, p.z), found: false, base, pop: 0 }); });
    });
    this.addFx('petal', 24, ['#fff0f8']);
  }
  private findEgg(i: number) {
    const e = this.eggs[i]; if (e.found) return;
    e.found = true; e.pop = 0.45; this.eggsFound++;
    const n = this.eggs.length, k = this.eggsFound;
    this.g.audio.pick(); this.g.play.emote(e.pos.clone().add(new THREE.Vector3(0, 0.6, 0)), k === n ? '🎉' : '🥚');
    this.g.play.toast(k === n ? `🐣 You found all <b>${n}</b> eggs! Happy Easter!` : `🥚 Egg found! <b>${k} / ${n}</b>`);
    if (k === n) this.g.audio.levelUp();
  }
  private initFireworks(hearts = false) {
    const geo = hearts ? heartGeo(0.26) : sph(0.22, 6, 4);
    this.fwMesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicNodeMaterial({ color: '#ffffff', fog: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), 360);
    this.fwMesh.frustumCulled = false; this.fwMesh.renderOrder = 5; this.fwMesh.count = 0; this.group.add(this.fwMesh);
    this.fwMesh.userData.hearts = hearts;
    // seed colours so instanceColor exists
    const c = new THREE.Color(); for (let i = 0; i < 360; i++) this.fwMesh.setColorAt(i, c.set('#ffffff'));
  }
  /** launch a firework rocket from (x,z); hearts = slower, pink, heart-shaped burst (Valentine's) */
  launch(x: number, z: number, hearts = !!this.fwMesh?.userData.hearts) {
    if (!this.fwMesh) return;
    const y = Math.max(0.3, heightAt(x, z)) + 0.8;
    this.fw.push({ x, y, z, vx: (Math.random() - 0.5) * 1.2, vy: hearts ? 8 : 9.5 + Math.random() * 2.5, vz: (Math.random() - 0.5) * 1.2, life: hearts ? 1.1 : 1.3 + Math.random() * 0.3, max: 0, rocket: true, col: new THREE.Color('#ffe0b0') });
    this.fireworks++;
    const p = this.g.player.position; this.g.audio.whistle(Math.max(-1, Math.min(1, (x - p.x) / 30)));
  }
  private burst(f: { x: number; y: number; z: number }, hearts: boolean) {
    const pals = hearts ? [['#ff6a9a', '#ffc0d8'], ['#ff3a6a', '#fff0f4']] : [['#ffd24a', '#fff4c0'], ['#ff5a7a', '#ffc0e0'], ['#6ad0ff', '#e0f8ff'], ['#9a7aff', '#f0e0ff'], ['#7aff9a', '#e8ffe8']];
    const pal = pals[Math.floor(Math.random() * pals.length)];
    const n = hearts ? 36 : 56; const sp = hearts ? 3.6 : 6.5 + Math.random() * 2.5;
    for (let i = 0; i < n && this.fw.length < 360; i++) {
      let dx: number, dy: number, dz: number;
      if (hearts) { const a = (i / n) * Math.PI * 2; dx = 16 * Math.sin(a) ** 3 / 16; dy = (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) / 16; dz = (Math.random() - 0.5) * 0.15; }
      else { const u = Math.random() * 2 - 1, a = Math.random() * 6.28, r = Math.sqrt(1 - u * u); dx = r * Math.cos(a); dy = u; dz = r * Math.sin(a); }
      const life = 1.4 + Math.random() * 0.6;
      this.fw.push({ x: f.x, y: f.y, z: f.z, vx: dx * sp, vy: dy * sp, vz: dz * sp, life, max: life, rocket: false, col: new THREE.Color(i % 3 ? pal[0] : pal[1]) });
    }
    const p = this.g.player.position, d = Math.hypot(f.x - p.x, f.z - p.z);
    this.g.audio.firework(Math.max(-1, Math.min(1, (f.x - p.x) / 30)), Math.min(1, d / 50));
  }
  private updateHoliday(dt: number, t: number) {
    const p = this.g.player.position;
    // fireworks
    if (this.fwMesh) {
      const hearts = !!this.fwMesh.userData.hearts;
      this.fwNext -= dt;
      if (this.fwNext <= 0 && this.g.caveK < 0.5) {
        this.fwNext = hearts ? 4 + Math.random() * 4 : 1.6 + Math.random() * 2.2;
        const a = Math.random() * 6.28, d = 24 + Math.random() * 18; this.launch(p.x + Math.cos(a) * d, p.z + Math.sin(a) * d, hearts);
      }
      let n = 0; const c = new THREE.Color();
      for (let i = this.fw.length - 1; i >= 0; i--) {
        const f = this.fw[i]; f.life -= dt;
        if (f.rocket) {
          f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt; f.vy -= 4 * dt;
          if (f.life <= 0) { this.fw.splice(i, 1); this.burst(f, hearts); continue; }
        } else {
          f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
          const drag = Math.pow(0.35, dt); f.vx *= drag; f.vy = f.vy * drag - (hearts ? 0.6 : 1.6) * dt; f.vz *= drag;
          if (f.life <= 0) { this.fw.splice(i, 1); continue; }
        }
      }
      for (const f of this.fw) {
        if (n >= 360) break;
        const k = f.rocket ? 1 : Math.max(0, f.life / f.max);
        const tw = f.rocket ? 1 : 0.75 + Math.sin(t * 30 + n) * 0.25;
        this.m.compose(this.v.set(f.x, f.y, f.z), this.q.identity(), this.s.setScalar((f.rocket ? 0.8 : 0.5 + k * 0.9) * tw));
        this.fwMesh.setMatrixAt(n, this.m);
        this.fwMesh.setColorAt(n, c.copy(f.col).multiplyScalar(f.rocket ? 1.4 : 0.4 + k * 1.6));
        n++;
      }
      this.fwMesh.count = n; this.fwMesh.instanceMatrix.needsUpdate = true; if (this.fwMesh.instanceColor) this.fwMesh.instanceColor.needsUpdate = true;
    }
    // drifting sky lanterns
    if (this.skyLMesh) {
      this.skyL.forEach((l, i) => {
        l.y += l.sp * dt; l.x += Math.sin(t * 0.3 + l.ph) * dt * 0.3;
        if (l.y > 40 || Math.hypot(l.x - p.x, l.z - p.z) > 45) { const a = Math.random() * 6.28, d = 6 + Math.random() * 30; l.x = p.x + Math.cos(a) * d; l.z = p.z + Math.sin(a) * d; l.y = Math.max(0, heightAt(l.x, l.z)) + 1; }
        this.m.compose(this.v.set(l.x, l.y, l.z), this.q.setFromEuler(new THREE.Euler(Math.sin(t + l.ph) * 0.08, l.ph, 0)), this.s.setScalar(0.8));
        this.skyLMesh!.setMatrixAt(i, this.m);
      });
      this.skyLMesh.instanceMatrix.needsUpdate = true;
    }
    // heart balloons bob + sway (skipped while one is wiggling)
    if (this.balloonMesh) {
      const busy = new Set(this.wiggle.filter((w) => w.mesh === this.balloonMesh).map((w) => w.i));
      this.balloons.forEach((b, i) => {
        if (busy.has(i)) return;
        this.m.compose(this.v.set(b.x, b.y + Math.sin(t * 1.3 + b.ph) * 0.08, b.z), this.q.setFromEuler(new THREE.Euler(Math.sin(t * 0.9 + b.ph) * 0.06, Math.sin(t * 0.4 + b.ph) * 0.5, Math.sin(t * 1.1 + b.ph) * 0.06)), this.s.setScalar(1));
        this.balloonMesh!.setMatrixAt(i, this.m);
      });
      this.balloonMesh.instanceMatrix.needsUpdate = true;
    }
    // found eggs: hop up + shrink away
    for (const e of this.eggs) {
      if (!e.found || e.pop <= 0) continue;
      e.pop = Math.max(0, e.pop - dt); const k = e.pop / 0.45;
      this.v.setFromMatrixPosition(e.base); this.v.y += (1 - k) * 0.6 * Math.sin((1 - k) * Math.PI) + (1 - k) * 0.2;
      this.m.compose(this.v, this.q.setFromEuler(new THREE.Euler(0, (1 - k) * 8, 0)), this.s.setScalar(k * 1.2));
      e.mesh.setMatrixAt(e.i, this.m); e.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}

/** spring blossom bush */
export function blossomBushGeo() {
  const b = new Baker();
  b.add(cyl(0.06, 0.08, 0.45, 6), '#6a8a40', [0, 0.22, 0]);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    b.add(sph(0.22, 10, 8), i % 2 ? '#ffb0c8' : '#ffe0ec', [Math.cos(a) * 0.18, 0.55 + (i % 3) * 0.08, Math.sin(a) * 0.18]);
  }
  b.add(sph(0.2, 10, 8), '#fff5fa', [0, 0.72, 0]);
  return b.build();
}
export function sunflowerGeo() {
  const b = new Baker();
  b.add(cyl(0.04, 0.05, 1.2, 6), '#4a8a30', [0, 0.6, 0]);
  b.add(sph(0.18, 12, 8), '#5a3a10', [0, 1.25, 0]);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    b.add(sph(0.1, 8, 6), '#f0c020', [Math.cos(a) * 0.28, 1.25, Math.sin(a) * 0.28], [0, 0, 0], [1, 0.35, 0.7]);
  }
  b.add(sph(0.08, 6, 5), '#5fb84a', [0.12, 0.7, 0], [0.4, 0, 0.3], [1.4, 0.5, 1]);
  return b.build();
}
export function umbrellaGeo() {
  const b = new Baker();
  b.add(cyl(0.03, 0.03, 1.6, 6), '#e8e0d0', [0, 0.8, 0]);
  b.add(cone(0.7, 0.4, 10), '#ff8a8a', [0, 1.7, 0]);
  b.add(cone(0.12, 0.1, 6), '#e04050', [0, 1.92, 0]);
  return b.build();
}
export function leafPileGeo() {
  const b = new Baker();
  const cols = ['#e07030', '#d4a020', '#c04820', '#e8b050'];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.add(sph(0.2, 8, 6), cols[i % 4], [Math.cos(a) * 0.25, 0.08 + (i % 3) * 0.04, Math.sin(a) * 0.25], [0.4, a, 0.2], [1.4, 0.35, 1]);
  }
  return b.build();
}
export function haybaleGeo() {
  const b = new Baker();
  b.add(cyl(0.38, 0.38, 0.7, 12), '#d4b060', [0, 0.35, 0], [0, 0, Math.PI / 2]);
  b.add(cyl(0.39, 0.39, 0.08, 12), '#c49840', [0.28, 0.35, 0], [0, 0, Math.PI / 2]);
  b.add(cyl(0.39, 0.39, 0.08, 12), '#c49840', [-0.28, 0.35, 0], [0, 0, Math.PI / 2]);
  return b.build();
}
export function snowPatchGeo() {
  const b = new Baker();
  b.add(sph(0.55, 10, 6), '#f4f8ff', [0, 0.05, 0], [0, 0, 0], [1.6, 0.18, 1.3]);
  b.add(sph(0.3, 8, 5), '#ffffff', [0.35, 0.04, 0.15], [0, 0, 0], [1.2, 0.15, 1]);
  return b.build();
}
export function snowmanGeo() {
  const b = new Baker();
  b.add(sph(0.42, 14, 10), '#f2f6ff', [0, 0.38, 0]);
  b.add(sph(0.3, 12, 9), '#f2f6ff', [0, 0.9, 0]);
  b.add(sph(0.22, 12, 9), '#f2f6ff', [0, 1.28, 0]);
  b.add(cone(0.07, 0.22, 6), '#ff8a2a', [0, 1.28, 0.22], [Math.PI / 2, 0, 0]);
  for (const s of [-1, 1]) b.add(sph(0.035, 6, 5), '#2a2a30', [s * 0.08, 1.32, 0.18]);
  b.add(cyl(0.16, 0.18, 0.1, 8), '#2a2a30', [0, 1.48, 0]);
  b.add(cyl(0.12, 0.14, 0.12, 8), '#2a2a30', [0, 1.58, 0]);
  for (let i = 0; i < 3; i++) b.add(sph(0.04, 6, 5), '#2a2a30', [0, 0.5 + i * 0.18, 0.38]);
  return b.build();
}
export function maizeGeo() {
  const b = new Baker();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    b.add(cyl(0.05, 0.06, 1.1, 6), '#6a9a3a', [Math.cos(a) * 0.12, 0.55, Math.sin(a) * 0.12]);
    b.add(cyl(0.09, 0.07, 0.35, 8), '#f0d050', [Math.cos(a) * 0.12, 1.05, Math.sin(a) * 0.12]);
    b.add(cone(0.08, 0.2, 6), '#5a8a30', [Math.cos(a) * 0.12, 1.3, Math.sin(a) * 0.12]);
  }
  return b.build();
}
export function cornucopiaGeo() {
  const b = new Baker();
  b.add(cyl(0.12, 0.28, 0.7, 10), '#c87830', [0, 0.35, 0], [0, 0, 0.6], [1, 1, 1.2]);
  b.add(sph(0.12, 8, 6), '#e04040', [0.25, 0.55, 0.1]);
  b.add(sph(0.1, 8, 6), '#f0c020', [0.35, 0.5, -0.05]);
  b.add(sph(0.09, 8, 6), '#e07030', [0.15, 0.62, -0.12]);
  b.add(cyl(0.06, 0.05, 0.25, 6), '#f0d050', [0.4, 0.55, 0.08], [0.5, 0.3, 0]);
  return b.build();
}
export function xmastreeGeo() {
  const b = new Baker();
  b.add(cyl(0.08, 0.1, 0.5, 6), '#6a4420', [0, 0.25, 0]);
  b.add(cone(0.7, 0.7, 8), '#2a7a3a', [0, 0.75, 0]);
  b.add(cone(0.55, 0.6, 8), '#2f8a42', [0, 1.2, 0]);
  b.add(cone(0.38, 0.55, 8), '#36a04c', [0, 1.6, 0]);
  b.add(cone(0.1, 0.18, 5), '#ffd24d', [0, 1.95, 0]);
  return b.build();
}
export function giftGeo() {
  const b = new Baker();
  const cols = ['#e04050', '#2a8a50', '#4060c0'];
  b.add(box(0.45, 0.35, 0.45), cols[0], [0, 0.18, 0]);
  b.add(box(0.48, 0.08, 0.12), '#ffd24d', [0, 0.18, 0]);
  b.add(box(0.12, 0.08, 0.48), '#ffd24d', [0, 0.18, 0]);
  b.add(box(0.48, 0.06, 0.48), '#ffd24d', [0, 0.38, 0]);
  b.add(sph(0.08, 6, 5), '#ffd24d', [0, 0.48, 0]);
  return b.build();
}
export function candyCaneGeo() {
  const b = new Baker();
  for (let i = 0; i < 8; i++) {
    const t = i / 7, y = 0.1 + t * 0.85;
    const x = t > 0.7 ? Math.sin((t - 0.7) / 0.3 * Math.PI) * 0.22 : 0;
    b.add(sph(0.07, 8, 6), i % 2 ? '#ffffff' : '#e04050', [x, y, 0]);
  }
  return b.build();
}
export function flowerboxGeo() {
  const b = new Baker();
  b.add(box(0.7, 0.28, 0.4), '#8a5a30', [0, 0.14, 0]);
  b.add(box(0.62, 0.12, 0.32), '#4a3020', [0, 0.3, 0]);
  for (let i = 0; i < 5; i++) {
    b.add(cyl(0.015, 0.015, 0.28, 5), '#4a8a30', [(i - 2) * 0.1, 0.45, 0]);
    b.add(sph(0.08, 8, 6), ['#ff6aa0', '#ffe066', '#ff8a4a', '#c070ff', '#6ad0ff'][i], [(i - 2) * 0.1, 0.6, 0]);
  }
  return b.build();
}
const torus = (r: number) => new THREE.TorusGeometry(r, 0.02, 5, 14);

/** a chunky heart (two spheres + cone), front faces +z */
export function heartGeo(r = 0.2) {
  const b = new Baker();
  for (const sx of [-1, 1]) b.add(sph(r * 0.55, 10, 8), '#ff4a7a', [sx * r * 0.42, r * 0.25, 0], [0, 0, 0], [1, 1, 0.75]);
  b.add(cone(r * 0.82, r * 1.05, 10), '#ff4a7a', [0, -r * 0.45, 0], [Math.PI, 0, 0], [1, 1, 0.65]);
  return b.build();
}
/** heart-shaped balloon on a string, ~2 m tall */
export function heartBalloonGeo() {
  const b = new Baker();
  b.add(cyl(0.008, 0.008, 1.6, 4), '#f8f0f0', [0, 0.8, 0]);
  for (const sx of [-1, 1]) b.add(sph(0.2, 12, 9), '#ff4a7a', [sx * 0.15, 1.98, 0], [0, 0, 0], [1, 1, 0.7]);
  b.add(cone(0.3, 0.36, 12), '#ff5a86', [0, 1.74, 0], [Math.PI, 0, 0], [1, 1, 0.6]);
  b.add(sph(0.05, 6, 5), '#ffd0e0', [-0.15, 2.06, 0.11]);
  return b.build();
}
export function roseBushGeo() {
  const b = new Baker();
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; b.add(sph(0.2, 8, 6), i % 2 ? '#3f8a3a' : '#4a9a42', [Math.cos(a) * 0.17, 0.22 + (i % 2) * 0.06, Math.sin(a) * 0.17]); }
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.3; b.add(sph(0.075, 8, 6), i % 3 ? '#e02a4a' : '#ff7aa0', [Math.cos(a) * 0.22, 0.38 + (i % 2) * 0.06, Math.sin(a) * 0.22]); }
  b.add(sph(0.08, 8, 6), '#ff3a5a', [0, 0.46, 0]);
  return b.build();
}
/** painted egg: base colour + a band */
export function eggGeo(base: string, band: string) {
  const b = new Baker();
  b.add(sph(0.15, 12, 10), base, [0, 0.18, 0], [0, 0, 0], [1, 1.3, 1]);
  b.add(cyl(0.153, 0.153, 0.045, 12), band, [0, 0.19, 0], [0, 0, 0], [1, 1, 1]);
  b.add(sph(0.035, 6, 5), band, [0.1, 0.27, 0.08]);
  return b.build();
}
export function chickGeo() {
  const b = new Baker();
  b.add(sph(0.14, 12, 9), '#ffe060', [0, 0.14, 0]);
  b.add(sph(0.1, 12, 9), '#ffe878', [0, 0.3, 0.03]);
  b.add(cone(0.03, 0.06, 6), '#ff9a2a', [0, 0.3, 0.13], [Math.PI / 2, 0, 0]);
  for (const s of [-1, 1]) { b.add(sph(0.018, 6, 5), '#2a2a30', [s * 0.04, 0.33, 0.1]); b.add(sph(0.06, 8, 6), '#ffd040', [s * 0.13, 0.16, 0], [0, 0, s * 0.5], [0.5, 1, 1]); }
  b.add(sph(0.12, 10, 6), '#fff8f0', [0, 0.04, 0], [0, 0, 0], [1.3, 0.45, 1.3]);
  return b.build();
}
/** paper sky lantern (glows via flicker material) */
export function skyLanternGeo() {
  const b = new Baker(); b.ao = false;
  b.add(cyl(0.2, 0.15, 0.42, 8), '#ffffff', [0, 0.21, 0]);
  b.add(cyl(0.21, 0.21, 0.03, 8), '#ffe0a0', [0, 0.43, 0]);
  return b.build();
}
