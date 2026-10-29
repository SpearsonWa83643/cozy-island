import * as THREE from 'three/webgpu';
import { heightAt, slopeAt } from './Terrain';
import { mulberry32 } from './noise';
import { Baker } from './Baker';
import type { IsletDef, IsletKind } from './config';
import type { Physics } from '../core/Physics';

/**
 * Order 48d: one landmark per generated islet, picked by its kind, sited on the highest gentle ground near the
 * central knoll so it reads from the main island's shore and from the air. Procedural low-poly (one baked mesh =
 * one draw call), solid (simple colliders), built as the first step of the islet's lazy flora build.
 *  - wood (Heron Isle):     Heron Stones, a ring of mossy standing stones around a flat altar stone
 *  - pine (Juniper Isle):   Juniper Lookout, a timber watchtower with a railed deck and a shingle roof
 *  - palm (Driftwood Isle): Driftwood Arch, a bleached driftwood gateway with shell charms over a fire ring
 */
export const LANDMARK_NAMES: Record<IsletKind, string> = { wood: 'Heron Stones', pine: 'Juniper Lookout', palm: 'Driftwood Arch' };
/** footprint kept clear of flora (m) */
const CLEAR_R = 6.5;

export class IsletLandmark {
  readonly name: string;
  readonly kind: IsletKind;
  /** ground position of the landmark's centre */
  pos = new THREE.Vector3();
  found = false;
  mesh: THREE.Mesh | null = null;
  /** height of the landmark's top above its base (m), for tests / the map */
  top = 0;
  /** collider footprints (world x/z, radius), for tests */
  solids: { x: number; z: number; r: number }[] = [];

  constructor(readonly def: IsletDef, occ: { x: number; z: number; r: number }[], landing: THREE.Vector3) {
    this.kind = def.kind ?? 'wood';
    this.name = LANDMARK_NAMES[this.kind];
    // candidates on a 3 m lattice around the knoll; best = highest, gentle, well away from the landing spot
    const kx = def.x - def.r * 0.12, kz = def.z + def.r * 0.08;
    let best = -Infinity;
    for (let dz = -18; dz <= 18; dz += 3) for (let dx = -18; dx <= 18; dx += 3) {
      const x = kx + dx, z = kz + dz, h = heightAt(x, z);
      if (h < 1.5 || Math.hypot(x - landing.x, z - landing.z) < 14) continue;
      const s = slopeAt(x, z);
      if (s > 0.28) continue;
      const score = h - s * 6 - Math.hypot(dx, dz) * 0.03;
      if (score > best) { best = score; this.pos.set(x, h, z); this.found = true; }
    }
    if (this.found) occ.push({ x: this.pos.x, z: this.pos.z, r: CLEAR_R });
  }

  build(physics: Physics): THREE.Mesh | null {
    if (!this.found || this.mesh) return this.mesh;
    const P = this.pos, rnd = mulberry32(this.def.seed + 4848), b = new Baker();
    const phys = { addCylinder: (x: number, y: number, z: number, hh: number, r: number) => { this.solids.push({ x, z, r }); physics.addCylinder(x, y, z, hh, r); } };
    // face the main island so the landmark's best side looks home
    const yaw = Math.atan2(-P.x, -P.z);
    const g = (x: number, z: number) => heightAt(P.x + x, P.z + z) - P.y; // local ground height
    if (this.kind === 'wood') {
      const n = 7, R = 3.6, gate = 0.36; // stones 0 and 1 flank the side facing home and carry a lintel
      const angs = [yaw - gate, yaw + gate, ...Array.from({ length: n - 2 }, (_, i) => yaw + gate + ((i + 1) / (n - 1)) * (Math.PI * 2 - 2 * gate) + (rnd() - 0.5) * 0.15)];
      let lintelY = Infinity;
      angs.forEach((a, i) => {
        const x = Math.sin(a) * R, z = Math.cos(a) * R, gy = g(x, z), hgt = i < 2 ? 3.0 : 2.3 + rnd() * 1.4;
        b.add(new THREE.BoxGeometry(0.85, hgt, 0.6, 1, 2, 1), rnd() < 0.5 ? '#9c978d' : '#8b867c', [x, gy + hgt / 2 - 0.25, z], [i < 2 ? 0 : (rnd() - 0.5) * 0.12, a, i < 2 ? 0 : (rnd() - 0.5) * 0.12]);
        if (i >= 2) b.add(new THREE.BoxGeometry(0.9, 0.28, 0.66), '#6f9a4a', [x, gy + hgt - 0.2, z], [0, a, 0]); // moss cap
        else lintelY = Math.min(lintelY, gy + hgt - 0.25);
        phys.addCylinder(P.x + x, P.y + gy + hgt / 2, P.z + z, hgt / 2, 0.45);
        this.top = Math.max(this.top, gy + hgt);
      });
      const lx = Math.sin(yaw) * R * Math.cos(gate), lz = Math.cos(yaw) * R * Math.cos(gate);
      b.add(new THREE.BoxGeometry(2 * R * Math.sin(gate) + 1.1, 0.45, 0.7), '#a39e94', [lx, lintelY + 0.2, lz], [0, yaw, 0]);
      b.add(new THREE.BoxGeometry(1.6, 0.18, 0.6), '#6f9a4a', [lx, lintelY + 0.5, lz], [0, yaw, 0]);
      b.add(new THREE.CylinderGeometry(1.1, 1.25, 0.55, 8), '#b4aea2', [0, g(0, 0) + 0.15, 0]); // altar
      b.add(new THREE.CylinderGeometry(0.18, 0.22, 0.25, 6), '#e8d9a8', [0, g(0, 0) + 0.55, 0]); // offering bowl
      phys.addCylinder(P.x, P.y + 0.3, P.z, 0.3, 1.15);
    } else if (this.kind === 'pine') {
      const H = 6.2, w = 1.5;
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const x = sx * w, z = sz * w, base = g(x, z);
        b.add(new THREE.CylinderGeometry(0.14, 0.18, H - base + 0.3, 6), '#7a5438', [x * 0.92, (H + base) / 2 - 0.15, z * 0.92], [sz * 0.05, 0, -sx * 0.05]);
        phys.addCylinder(P.x + x, P.y + H / 2, P.z + z, H / 2, 0.2);
      }
      for (const y of [1.6, 3.6]) for (let k = 0; k < 4; k++) { // girts
        const a = (k * Math.PI) / 2;
        b.add(new THREE.BoxGeometry(0.1, 0.1, 2 * w * 1.25), '#8a6242', [Math.cos(a) * w * 0.92, y, Math.sin(a) * w * 0.92], [0, -a, 0]);
      }
      b.add(new THREE.BoxGeometry(2 * w + 1.0, 0.22, 2 * w + 1.0), '#9a7048', [0, H, 0]); // deck
      for (let k = 0; k < 4; k++) { // railing
        const a = (k * Math.PI) / 2, r = w + 0.45;
        b.add(new THREE.BoxGeometry(2 * r, 0.09, 0.09), '#7a5438', [Math.cos(a) * r, H + 0.95, Math.sin(a) * r], [0, -a - Math.PI / 2, 0]);
        b.add(new THREE.BoxGeometry(0.1, 1.0, 0.1), '#7a5438', [Math.cos(a + Math.PI / 4) * r * 1.41, H + 0.5, Math.sin(a + Math.PI / 4) * r * 1.41]);
      }
      for (let k = 0; k < 4; k++) { const a = (k * Math.PI) / 2 + Math.PI / 4; b.add(new THREE.CylinderGeometry(0.07, 0.07, 1.9, 5), '#6a4a30', [Math.cos(a) * w * 1.15, H + 1.05, Math.sin(a) * w * 1.15]); }
      b.add(new THREE.ConeGeometry(2 * w + 0.4, 1.5, 4), '#5c6e4a', [0, H + 2.7, 0], [0, Math.PI / 4, 0]); // shingle roof
      b.add(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 4), '#6a4a30', [0, H + 3.9, 0]);
      b.add(new THREE.BoxGeometry(0.02, 0.38, 0.62), '#e0a33a', [0, H + 4.2, 0.32]); // pennant
      // ladder on the side facing home
      const lx = Math.sin(yaw) * (w + 0.25), lz = Math.cos(yaw) * (w + 0.25);
      for (let y = 0.4; y < H; y += 0.5) b.add(new THREE.BoxGeometry(0.9, 0.07, 0.07), '#8a6242', [lx, y, lz], [0, yaw, 0]);
      this.top = H + 4.4;
    } else {
      // two leaning driftwood posts + a crooked beam, shell charms hanging, a stone fire ring in front
      const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      for (const s of [-1, 1]) {
        const x = side.x * 1.9 * s, z = side.z * 1.9 * s;
        b.add(new THREE.CylinderGeometry(0.2, 0.3, 4.0, 6), '#d8cbb4', [x * 0.94, g(x, z) + 1.9, z * 0.94], [side.z * 0.1 * s, 0, -side.x * 0.1 * s]);
        phys.addCylinder(P.x + x, P.y + 2, P.z + z, 2, 0.3);
      }
      b.add(new THREE.CylinderGeometry(0.2, 0.24, 5.0, 6), '#cfc1a8', [0, 4.0, 0], [0, yaw, Math.PI / 2 + 0.06]);
      b.add(new THREE.CylinderGeometry(0.12, 0.16, 3.0, 5), '#e2d6c0', [0, 4.45, 0], [0, yaw, Math.PI / 2 - 0.1]);
      for (let i = 0; i < 5; i++) {
        const t = -1.4 + i * 0.7, x = side.x * t, z = side.z * t, len = 0.5 + rnd() * 0.5;
        b.add(new THREE.CylinderGeometry(0.012, 0.012, len, 3), '#6a5a48', [x, 3.85 - len / 2, z]);
        b.add(new THREE.SphereGeometry(0.13, 6, 4), ['#f7e3d4', '#f2b8a8', '#e8f0f4'][i % 3], [x, 3.8 - len, z], [0, 0, 0], [1, 0.6, 1]);
      }
      const fx = Math.sin(yaw) * 2.6, fz = Math.cos(yaw) * 2.6;
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2, x = fx + Math.cos(a) * 0.7, z = fz + Math.sin(a) * 0.7; b.add(new THREE.DodecahedronGeometry(0.22, 0), '#8f8a82', [x, g(x, z) + 0.08, z]); }
      for (let i = 0; i < 3; i++) b.add(new THREE.CylinderGeometry(0.06, 0.06, 0.9, 4), '#6a4a30', [fx, g(fx, fz) + 0.2, fz], [Math.PI / 2 - 0.3, (i * Math.PI) / 1.5, 0]);
      this.top = 4.7;
    }
    const mesh = new THREE.Mesh(b.build(), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }));
    mesh.name = `landmark-${this.def.id}`; mesh.position.copy(P); mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.landmark = this.name;
    this.mesh = mesh;
    return mesh;
  }
}
