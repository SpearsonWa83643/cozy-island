import * as THREE from 'three/webgpu';
import { heightAt, slopeAt } from './Terrain';
import { mulberry32 } from './noise';
import { Baker } from './Baker';
import { theme, themeEvents } from '../theme/theme';
import type { Physics } from '../core/Physics';
import type { Flora } from './Flora';

/**
 * Lighthouse Point (Order 31): a procedural low-poly lighthouse on a rocky headland on the north-east coast
 * (between the alpine peak and Autumn Grove), reached by a winding stepping-stone path, with a lookout bench
 * + telescope facing the sea. The lamp's two beams sweep all the time; they glow strongest in the dusky themes
 * (Halloween, Winter). Tap the tower: foghorn + bright flash. Everything is baked into a handful of meshes.
 */
const TOWER_H = 7.2, R0 = 1.45, R1 = 0.95;
const BEAM_LEN = 22;
const BEAM_K: Record<string, number> = { halloween: 0.42, winter: 0.26, autumn: 0.16, spring: 0.1, summer: 0.08 };

export class Lighthouse {
  group = new THREE.Group();
  /** tower base (world) and the seaward direction */
  pos = new THREE.Vector3(); sea = new THREE.Vector3();
  /** lookout bench spot (where you stand), and the path start inland */
  lookout = new THREE.Vector3(); pathStart = new THREE.Vector3();
  path: THREE.Vector3[] = [];
  /** lamp centre (world) */
  lamp = new THREE.Vector3();
  reactions = 0; flashes = 0;
  private beams = new THREE.Group();
  private beamMat: THREE.MeshBasicNodeMaterial;
  private coreMat: THREE.MeshBasicNodeMaterial;
  private base = 0.1; private flash = 0; private spin = 0;
  /** 0 = day .. 1 = night (set by the day/night clock, Order 49c) */
  night = 0;

  constructor(physics: Physics, flora: Flora) {
    this.findSite(flora);
    const rnd = mulberry32(3131), P = this.pos, S = this.sea;
    const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });

    // --- headland rocks (solid) ---
    const rocks = new Baker();
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + rnd() * 0.3, d = 2.2 + rnd() * 1.6;
      const x = Math.cos(a) * d, z = Math.sin(a) * d, r = 0.55 + rnd() * 0.6;
      const y = heightAt(P.x + x, P.z + z) - P.y - r * 0.35;
      rocks.add(new THREE.DodecahedronGeometry(r, 0), rnd() < 0.5 ? '#a49c92' : '#8c857c', [x, y, z], [rnd() * 3, rnd() * 3, rnd() * 3], [1, 0.7 + rnd() * 0.3, 1]);
      if (r > 0.75) physics.addBall(P.x + x, P.y + y, P.z + z, r * 0.6);
    }
    // stone plinth the tower sits on
    rocks.add(new THREE.CylinderGeometry(R0 + 0.55, R0 + 0.8, 1.2, 9), '#b8b0a4', [0, -0.25, 0]);
    const rockMesh = new THREE.Mesh(rocks.build(), mat); rockMesh.position.copy(P); rockMesh.castShadow = rockMesh.receiveShadow = true;

    // --- tower: red/white bands, gallery, lantern room, cap ---
    const t = new Baker(); t.ao = false;
    const bands = 6;
    for (let i = 0; i < bands; i++) {
      const y0 = 0.35 + (i / bands) * TOWER_H, y1 = 0.35 + ((i + 1) / bands) * TOWER_H;
      const r0 = R0 + (R1 - R0) * (i / bands), r1 = R0 + (R1 - R0) * ((i + 1) / bands);
      t.add(new THREE.CylinderGeometry(r1, r0, y1 - y0, 12, 1), i % 2 ? '#f6f1e6' : '#d8433a', [0, (y0 + y1) / 2, 0]);
    }
    const top = 0.35 + TOWER_H;
    t.add(new THREE.CylinderGeometry(R1 + 0.45, R1 + 0.3, 0.22, 12), '#3c4048', [0, top + 0.1, 0]);          // gallery deck
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; t.add(new THREE.CylinderGeometry(0.035, 0.035, 0.55, 4), '#3c4048', [Math.cos(a) * (R1 + 0.4), top + 0.45, Math.sin(a) * (R1 + 0.4)]); }
    t.add(new THREE.TorusGeometry(R1 + 0.4, 0.04, 4, 16), '#3c4048', [0, top + 0.72, 0], [Math.PI / 2, 0, 0]);  // railing
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; t.add(new THREE.BoxGeometry(0.08, 1.05, 0.08), '#2f333a', [Math.cos(a) * 0.62, top + 0.75, Math.sin(a) * 0.62]); }
    t.add(new THREE.ConeGeometry(0.95, 0.85, 12), '#c23a32', [0, top + 1.7, 0]);                               // cap
    t.add(new THREE.SphereGeometry(0.13, 8, 6), '#e8c35a', [0, top + 2.18, 0]);
    // door + two windows facing inland
    const inl = S.clone().negate();
    const face = (h: number, r: number, w: number, hh: number, col: string) => t.add(new THREE.BoxGeometry(w, hh, 0.12), col, [inl.x * r, h, inl.z * r], [0, Math.atan2(inl.x, inl.z), 0]);
    face(1.05, R0 - 0.02, 0.8, 1.4, '#5a3a24');
    face(3.6, R0 - 0.2, 0.42, 0.6, '#3a5a7a'); face(5.9, R0 - 0.38, 0.38, 0.55, '#3a5a7a');
    const tower = new THREE.Mesh(t.build(), mat); tower.position.copy(P); tower.castShadow = tower.receiveShadow = true;
    physics.addCylinder(P.x, P.y + 0.35 + TOWER_H / 2, P.z, TOWER_H / 2 + 0.3, R0 + 0.05);

    // --- lamp: glass room glow + sweeping beams ---
    this.lamp.set(P.x, P.y + top + 0.78, P.z);
    this.coreMat = new THREE.MeshBasicNodeMaterial({ color: '#fff3b0', transparent: true, opacity: 0.92 });
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, 0.95, 10), this.coreMat); core.position.copy(this.lamp);
    this.beamMat = new THREE.MeshBasicNodeMaterial({ color: '#fff1b8', transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    const beamGeo = new THREE.ConeGeometry(2.4, BEAM_LEN, 14, 1, true).translate(0, -BEAM_LEN / 2, 0).rotateZ(Math.PI / 2); // apex at origin, opens toward +x
    for (const s of [0, Math.PI]) { const b = new THREE.Mesh(beamGeo, this.beamMat); b.rotation.y = s; b.renderOrder = 5; b.frustumCulled = false; this.beams.add(b); }
    this.beams.position.copy(this.lamp);

    // --- winding path of stepping stones from inland up to the door ---
    const pathB = new Baker();
    const n = this.path.length;
    for (let i = 0; i < n; i++) {
      const p = this.path[i];
      const r = 0.42 + rnd() * 0.18;
      pathB.add(new THREE.CylinderGeometry(r, r * 1.08, 0.14, 7), rnd() < 0.5 ? '#cfc6b6' : '#bdb3a2', [p.x - P.x, heightAt(p.x, p.z) - P.y + 0.03, p.z - P.z], [(rnd() - 0.5) * 0.08, rnd() * 3, (rnd() - 0.5) * 0.08]);
    }
    // lookout: a bench and a little brass telescope facing the sea
    const L = this.lookout, yaw = Math.atan2(S.x, S.z);
    const lb = (g: THREE.BufferGeometry, c: string, off: [number, number, number], rot: [number, number, number] = [0, 0, 0]) => {
      const o = new THREE.Vector3(...off).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      pathB.add(g, c, [L.x + o.x - P.x, heightAt(L.x, L.z) - P.y + o.y, L.z + o.z - P.z], [rot[0], rot[1] + yaw, rot[2]]);
    };
    lb(new THREE.BoxGeometry(1.6, 0.1, 0.45), '#a8743f', [0, 0.48, -0.5]);
    lb(new THREE.BoxGeometry(1.6, 0.4, 0.08), '#a8743f', [0, 0.78, -0.74]);
    for (const sx of [-0.68, 0.68]) lb(new THREE.BoxGeometry(0.1, 0.48, 0.42), '#6e4a2a', [sx, 0.24, -0.5]);
    lb(new THREE.CylinderGeometry(0.03, 0.05, 1.1, 5), '#4a3a2a', [0.9, 0.55, 0.3]);
    lb(new THREE.CylinderGeometry(0.07, 0.1, 0.75, 8), '#d4a84a', [0.9, 1.15, 0.45], [Math.PI / 2 - 0.25, 0, 0]);
    const pathMesh = new THREE.Mesh(pathB.build(), mat); pathMesh.position.copy(P); pathMesh.receiveShadow = true; pathMesh.castShadow = true;
    physics.addBox(L.x - S.x * 0.5, heightAt(L.x, L.z) + 0.3, L.z - S.z * 0.5, 0.8, 0.3, 0.25, yaw);

    this.group.name = 'lighthouse';
    this.group.add(rockMesh, tower, pathMesh, core, this.beams);
    // clear any trees / plants that landed on the headland
    flora.clearArea(P.x, P.z, 4.2);
    flora.clearArea(L.x, L.z, 1.6);
    for (const p of this.path) flora.clearArea(p.x, p.z, 0.9, true);
    this.applyTheme();
    themeEvents.on(() => this.applyTheme());
  }

  private applyTheme() { this.base = BEAM_K[theme.id] ?? 0.1; }

  /** pick the best headland on the NE coast: high-ish, gentle, near the shore, few plants in the way */
  private findSite(flora: Flora) {
    let best: { x: number; z: number; ax: number; az: number; s: number } | null = null;
    for (let k = 0; k <= 40; k++) {
      const a = -1.45 + (k / 40) * 1.2, ax = Math.cos(a), az = Math.sin(a);
      // march out to the last land point above 2 m (the cliff edge), then step back inland
      let edge = -1;
      for (let d = 25; d < 75; d += 0.5) if (heightAt(ax * d, az * d) > 2.0) edge = d;
      if (edge < 0) continue;
      for (const back of [3.5, 5, 6.5]) {
        const d = edge - back, x = ax * d, z = az * d, h = heightAt(x, z);
        if (h < 2 || h > 9) continue;
        let sl = 0; for (let i = 0; i < 8; i++) { const b = (i / 8) * Math.PI * 2; sl = Math.max(sl, slopeAt(x + Math.cos(b) * 1.6, z + Math.sin(b) * 1.6)); }
        if (sl > 0.7) continue;
        let plants = 0; for (const s of flora.spots) if (Math.hypot(s.x - x, s.z - z) < 4.5) plants++;
        const s = sl * 6 + plants * 0.8 + Math.abs(h - 4) * 0.5 + Math.abs(a + 0.85) * 1.5;
        if (!best || s < best.s) best = { x, z, ax, az, s };
      }
    }
    const b = best ?? { x: 20, z: -40, ax: 0.45, az: -0.9, s: 0 };
    this.pos.set(b.x, heightAt(b.x, b.z), b.z);
    this.sea.set(b.ax, 0, b.az).normalize();
    // lookout: beside the tower on the sea side, slightly to the right
    const R = new THREE.Vector3(this.sea.z, 0, -this.sea.x);
    this.lookout.copy(this.pos).addScaledVector(this.sea, 1.2).addScaledVector(R, 3.4); this.lookout.y = heightAt(this.lookout.x, this.lookout.z);
    // path: ~16 m inland, winding (sine offset) up to the door
    this.pathStart.copy(this.pos).addScaledVector(this.sea, -17); this.pathStart.y = heightAt(this.pathStart.x, this.pathStart.z);
    const steps = 20;
    for (let i = 0; i < steps; i++) {
      const u = i / (steps - 1), d = 17 * (1 - u) + 2.3 * u;
      const wig = Math.sin(u * Math.PI * 2.2) * 2.2 * (1 - u * 0.8);
      const p = this.pos.clone().addScaledVector(this.sea, -d).addScaledVector(R, wig); p.y = heightAt(p.x, p.z);
      this.path.push(p);
    }
  }

  /** landmark spot for the scenic tour / map */
  get tourSpot() { return { x: this.pos.x + this.sea.x * 3, z: this.pos.z + this.sea.z * 3 }; }

  /** tap reaction: foghorn + bright flash. Returns true if the tap hit the tower. */
  tapAt(cx: number, cy: number, project: (v: THREE.Vector3) => { x: number; y: number }, lim: number, player: THREE.Vector3): boolean {
    if (Math.hypot(player.x - this.pos.x, player.z - this.pos.z) > 45) return false;
    const a = project(new THREE.Vector3(this.pos.x, this.pos.y + 0.5, this.pos.z));
    const b = project(this.lamp.clone().add(new THREE.Vector3(0, 1.3, 0)));
    const ex = b.x - a.x, ey = b.y - a.y, len2 = ex * ex + ey * ey || 1;
    const u = Math.max(0, Math.min(1, ((cx - a.x) * ex + (cy - a.y) * ey) / len2));
    const d = Math.hypot(a.x + ex * u - cx, a.y + ey * u - cy);
    const halfW = Math.max(lim * 0.6, Math.sqrt(len2) * (R0 / (TOWER_H + 2)) * 1.4);
    if (d > halfW) return false;
    this.reactions++;
    if (this.flash < 0.4) this.flashes++;
    this.flash = 1;
    return true;
  }

  update(dt: number) {
    this.flash = Math.max(0, this.flash - dt * 0.55);
    this.spin += dt * (0.55 + this.flash * 2.2);
    this.beams.rotation.y = this.spin;
    const f = this.flash * this.flash;
    // Order 49c: the beams sweep only at night (strength still per theme); by day only a tap's flash shows them
    const nk = this.night, sweep = (0.2 + this.base * 0.6) * nk;
    this.beamMat.opacity = Math.min(0.85, sweep + f * 0.6 + Math.sin(this.spin * 7) * 0.008 * nk);
    this.beams.visible = nk > 0.01 || f > 0.003;
    this.coreMat.color.setRGB(1, 0.95 + f * 0.05, 0.69 + f * 0.31);
    this.beams.scale.setScalar(1 + f * 0.25);
  }

  /** test/debug */
  get debug() { return { x: +this.pos.x.toFixed(1), y: +this.pos.y.toFixed(2), z: +this.pos.z.toFixed(1), sea: [+this.sea.x.toFixed(2), +this.sea.z.toFixed(2)], beam: +this.beamMat.opacity.toFixed(3), base: this.base, night: +this.night.toFixed(2), sweeping: this.beams.visible, reactions: this.reactions, flashes: this.flashes, path: this.path.length, lookout: { x: +this.lookout.x.toFixed(1), z: +this.lookout.z.toFixed(1) } }; }
}
