import * as THREE from 'three/webgpu';
import { float, hash, instanceIndex, sin, time, uniform, vec3 } from 'three/tsl';
import { Baker } from '../world/Baker';
import { heightAt } from '../world/Terrain';
import { mulberry32 } from '../world/noise';
import { theme, type Theme } from './theme';
import { applyGrade } from '../render/Renderer';
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
  /** the pumpkin patch centre (screenshots/tests) */
  patch = new THREE.Vector3();
  private bats: Bat[] = [];
  private batMesh: THREE.InstancedMesh | null = null;
  private candyMesh: THREE.InstancedMesh | null = null;
  private mist: THREE.Mesh[] = [];
  private lights: THREE.PointLight[] = [];
  private lightT = 0;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private v = new THREE.Vector3(); private s = new THREE.Vector3();
  private flick = uniform(1);

  constructor(private g: Game) { this.rebuild(); }

  /** tear down + rebuild for the active theme (called on theme change) */
  rebuild() {
    for (const c of [...this.group.children]) { this.group.remove(c); c.traverse((o) => { if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose(); }); }
    this.ghosts = []; this.candies = []; this.lanterns = []; this.bats = []; this.mist = []; this.lights = []; this.batMesh = this.candyMesh = null;
    applyGrade(theme.grade);
    this.g.audio.setThemeAudio(theme.music, theme.ambience.owls, theme.ambience.wind);
    if (theme.dress === 'halloween') this.buildHalloween(theme);
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
    this.lights.forEach((l, i) => { l.intensity = (2.2 + Math.sin(t * 11 + i * 2) * 0.3 + Math.sin(t * 17.3 + i) * 0.2) * (1 - this.g.caveK); });
    void this.flick;
  }
}
const torus = (r: number) => new THREE.TorusGeometry(r, 0.02, 5, 14);
