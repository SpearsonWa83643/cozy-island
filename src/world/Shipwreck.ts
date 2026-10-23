import * as THREE from 'three/webgpu';
import { heightAt } from './Terrain';
import { atOffshore } from './Shore';
import { mulberry32 } from './noise';
import { Baker } from './Baker';
import type { Physics } from '../core/Physics';

/**
 * Shipwreck Cove (Order 37): an old low-poly sailing ship broken in two on the reef off the tropical
 * south-east beach. Swim through the gap between the bow and stern halves to find a little treasure chest
 * on a sunken deck plank (the Captain Hat inside), with sun shafts slanting down through the water and a
 * school of striped fish circling the wreck. Everything is baked into a few meshes; fish are one
 * instanced draw. Colliders: one box per hull half, so the gap stays open for swimming.
 */
const HALF_L = 3.3, GAP = 2.8, BEAM = 1.6;
const FISH = 16;

export class Shipwreck {
  group = new THREE.Group();
  /** wreck centre (on the water surface), the hull's long axis and its side axis */
  pos = new THREE.Vector3(); axis = new THREE.Vector3(1, 0, 0); side = new THREE.Vector3(0, 0, 1);
  /** chest position (world) */
  chest = new THREE.Vector3();
  opened = false;
  depth = 0;
  private lid: THREE.Mesh; private glow: THREE.Mesh; private glowMat: THREE.MeshBasicNodeMaterial;
  private shaftMat: THREE.MeshBasicNodeMaterial; private shafts = new THREE.Group();
  private fish: THREE.InstancedMesh; private fishT = 0; private lidT = 0;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(); private v = new THREE.Vector3(); private s = new THREE.Vector3(1, 1, 1);

  constructor(physics: Physics) {
    this.findSite();
    const rnd = mulberry32(3737), P = this.pos, yaw = Math.atan2(-this.axis.z, this.axis.x);
    const floor = -this.depth; // sea floor (local y, relative to the water surface at P)
    const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    const WOOD = ['#7a5232', '#6b4528', '#835a37'], DARK = '#4a2f1c', MOSS = '#5f7a4a';
    const H = Math.max(2.2, this.depth + 0.9); // hull side height: the rails poke out of the water

    // --- the two hull halves (planked sides, keel, deck beams), each tilted a little as it settled ---
    const hull = new Baker();
    const half = (sgn: number) => {
      const cx = sgn * (GAP / 2 + HALF_L), tilt = sgn * 0.16, roll = sgn * 0.08;
      const part = new Baker(); part.ao = true;
      const rows = 5;
      for (const sz of [-1, 1]) for (let r = 0; r < rows; r++) {
        const y = floor + 0.25 + (r + 0.5) * (H / rows), w = BEAM * (0.72 + 0.28 * Math.sin(((r + 0.5) / rows) * Math.PI * 0.6));
        const len = HALF_L * 2 * (0.9 + r * 0.025);
        part.add(new THREE.BoxGeometry(len, H / rows * 0.92, 0.12), r === 0 ? MOSS : WOOD[(r + (sz > 0 ? 1 : 0)) % 3], [0, y, sz * w], [sz * -0.12, 0, 0]);
        // broken plank ends at the gap
        if (rnd() < 0.7) part.add(new THREE.BoxGeometry(0.5 + rnd() * 0.6, H / rows * 0.8, 0.1), WOOD[r % 3], [-sgn * (HALF_L + 0.15), y, sz * w], [0, rnd() * 0.4 - 0.2, sgn * (0.2 + rnd() * 0.4)]);
      }
      part.add(new THREE.BoxGeometry(HALF_L * 2, 0.3, BEAM * 1.3), MOSS, [0, floor + 0.15, 0]); // keel / bilge
      for (let k = 0; k < 4; k++) part.add(new THREE.BoxGeometry(0.16, 0.16, BEAM * 2.05), DARK, [-HALF_L + 0.6 + k * 1.6, floor + H - 0.1, 0]); // deck beams
      // the far end: a pointed bow or a square stern with a little cabin
      if (sgn > 0) {
        part.add(new THREE.ConeGeometry(BEAM * 1.05, 2.0, 4, 1), WOOD[0], [HALF_L + 0.9, floor + H * 0.6, 0], [0, Math.PI / 4, -Math.PI / 2], [1, 1, 0.75]);
        part.add(new THREE.CylinderGeometry(0.06, 0.08, 2.6, 5), DARK, [HALF_L + 1.6, floor + H + 0.6, 0], [0, 0, -1.0]); // bowsprit
        // main mast, leaning, with a torn sail and a pennant
        part.add(new THREE.CylinderGeometry(0.11, 0.15, 6.2, 6), DARK, [0.4, floor + H + 2.6, 0], [0.18, 0, -0.32]);
        part.add(new THREE.BoxGeometry(0.1, 0.1, 2.6), DARK, [1.2, floor + H + 4.2, 0.6], [0.18, 0, -0.32]);
        const sail = new THREE.PlaneGeometry(2.3, 2.2, 3, 3); const sp = sail.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < sp.count; i++) { sp.setZ(i, Math.sin(sp.getX(i) * 1.4 + sp.getY(i)) * 0.18); if (sp.getY(i) < -0.9 && i % 2) sp.setY(i, sp.getY(i) + 0.45); }
        part.add(sail, '#e9dcc0', [0.95, floor + H + 3.1, 0.55], [0.18, Math.PI / 2, -0.32]);
        part.add(new THREE.ConeGeometry(0.2, 0.7, 3), '#d8433a', [2.35, floor + H + 5.4, 0.35], [0, 0, -Math.PI / 2 - 0.32], [1, 1, 0.2]);
      } else {
        part.add(new THREE.BoxGeometry(0.25, H + 0.4, BEAM * 2.1), WOOD[1], [-HALF_L - 0.05, floor + H / 2 + 0.2, 0]); // transom
        part.add(new THREE.BoxGeometry(2.0, 1.1, BEAM * 1.7), WOOD[2], [-HALF_L + 1.3, floor + H + 0.5, 0]); // cabin
        part.add(new THREE.BoxGeometry(2.3, 0.14, BEAM * 1.95), DARK, [-HALF_L + 1.3, floor + H + 1.1, 0]);
        for (const sz of [-1, 1]) part.add(new THREE.CylinderGeometry(0.18, 0.18, 0.06, 8), '#9fd0e0', [-HALF_L + 1.3, floor + H + 0.55, sz * BEAM * 0.86], [Math.PI / 2, 0, 0]); // portholes
        part.add(new THREE.TorusGeometry(0.42, 0.06, 4, 10), '#b98a46', [-HALF_L + 2.6, floor + H + 0.75, 0], [0, Math.PI / 2, 0]); // ship's wheel
        part.add(new THREE.CylinderGeometry(0.08, 0.1, 2.2, 6), DARK, [-HALF_L + 0.2, floor + H + 0.9, 0], [0, 0, 0.5]); // snapped mizzen
      }
      const g = part.build();
      g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(cx, 0, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(roll, 0, tilt)), new THREE.Vector3(1, 1, 1)));
      hull.add(g, '#ffffff');
      // collider: one box per half, centred at the waterline
      const wx = P.x + this.axis.x * cx, wz = P.z + this.axis.z * cx;
      physics.addBox(wx, floor * 0.5 + 0.6, wz, HALF_L + 0.2, Math.max(1.2, -floor * 0.5 + 1.2), BEAM + 0.15, yaw);
    };
    half(1); half(-1);
    // scattered barrels + crates on the sea floor; a sunken plank shelf in the gap holds the chest
    for (let i = 0; i < 7; i++) {
      const x = (rnd() - 0.5) * 12, z = (rnd() < 0.5 ? -1 : 1) * (BEAM + 1 + rnd() * 2.4);
      if (rnd() < 0.5) hull.add(new THREE.CylinderGeometry(0.3, 0.3, 0.7, 8), WOOD[i % 3], [x, floor + 0.3, z], [Math.PI / 2, rnd() * 3, 0]);
      else hull.add(new THREE.BoxGeometry(0.6, 0.6, 0.6), '#9a7446', [x, floor + 0.3, z], [0, rnd() * 3, 0.2]);
    }
    const shelfY = Math.max(floor + 0.3, -0.75);
    hull.add(new THREE.BoxGeometry(GAP * 0.9, 0.12, BEAM * 1.4), WOOD[2], [0, shelfY - 0.06, 0], [0.04, 0.2, 0.03]);
    hull.add(new THREE.CylinderGeometry(0.14, 0.14, shelfY - floor + 0.1, 6), DARK, [0, (shelfY + floor) / 2, 0]);
    const hullMesh = new THREE.Mesh(hull.build(), mat);
    hullMesh.castShadow = true; hullMesh.receiveShadow = true;

    // --- the chest (base + hinged lid) ---
    const cb = new Baker(); cb.add(new THREE.BoxGeometry(0.7, 0.4, 0.46), '#8a5a2b', [0, 0.2, 0]).add(new THREE.BoxGeometry(0.74, 0.06, 0.5), '#d9a93a', [0, 0.36, 0]).add(new THREE.BoxGeometry(0.1, 0.16, 0.04), '#e8c35a', [0, 0.3, 0.24]);
    const lb = new Baker(); lb.add(new THREE.CylinderGeometry(0.23, 0.23, 0.7, 8, 1, false, 0, Math.PI), '#9a6634', [0, 0, -0.23], [0, 0, Math.PI / 2]).add(new THREE.BoxGeometry(0.06, 0.24, 0.48), '#d9a93a', [0.2, 0.08, -0.23]).add(new THREE.BoxGeometry(0.06, 0.24, 0.48), '#d9a93a', [-0.2, 0.08, -0.23]);
    const base = new THREE.Mesh(cb.build(), mat); this.lid = new THREE.Mesh(lb.build(), mat);
    const chestG = new THREE.Group(); chestG.add(base, this.lid); this.lid.position.set(0, 0.4, 0.23);
    chestG.position.set(0, shelfY, 0); chestG.rotation.y = 0.35;
    this.glowMat = new THREE.MeshBasicNodeMaterial({ color: '#ffe08a', transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.glow = new THREE.Mesh(new THREE.SphereGeometry(0.75, 10, 8), this.glowMat); this.glow.position.set(0, shelfY + 0.35, 0);

    // --- sun shafts slanting down through the water ---
    this.shaftMat = new THREE.MeshBasicNodeMaterial({ color: '#dff7ff', transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    for (let i = 0; i < 5; i++) {
      const len = this.depth + 1.2, sh = new THREE.Mesh(new THREE.ConeGeometry(0.55 + rnd() * 0.4, len, 6, 1, true).translate(0, -len / 2, 0), this.shaftMat);
      sh.position.set((i - 2) * 2.4 + rnd(), 0.1, (rnd() - 0.5) * 3); sh.rotation.set(0.25, 0, 0.3 + rnd() * 0.1); sh.renderOrder = 4; sh.frustumCulled = false;
      this.shafts.add(sh);
    }

    // --- a school of striped reef fish circling the wreck ---
    const fb = new Baker(); fb.ao = false;
    fb.add(new THREE.SphereGeometry(0.12, 6, 4), '#ffb238', [0, 0, 0], [0, 0, 0], [1.6, 1, 0.55]).add(new THREE.ConeGeometry(0.09, 0.14, 4), '#ff7a1a', [-0.24, 0, 0], [0, 0, Math.PI / 2], [1, 1, 0.4]).add(new THREE.BoxGeometry(0.03, 0.18, 0.13), '#ffffff', [0.03, 0, 0]);
    this.fish = new THREE.InstancedMesh(fb.build(), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.6 }), FISH);
    this.fish.frustumCulled = false;

    const local = new THREE.Group();
    local.add(hullMesh, chestG, this.glow, this.shafts, this.fish);
    local.position.set(P.x, 0, P.z); local.rotation.y = yaw;
    this.group.add(local);
    this.group.name = 'shipwreck';
    local.updateMatrixWorld(true);
    this.chest.set(0, shelfY + 0.3, 0).applyMatrix4(local.matrixWorld);
    this.updateFish(0);
  }

  /** a spot off the tropical south-east beach, ~7 m out where the water is 1.4–2.6 m deep with room for the hull */
  private findSite() {
    let best: { a: number; s: number } | null = null;
    for (let k = 0; k <= 40; k++) {
      const a = 0.35 + (k / 40) * 1.1, c = atOffshore(a, 7.5), d = -heightAt(c.x, c.z);
      if (d < 1.2) continue;
      const tx = -Math.sin(a), tz = Math.cos(a);
      let minD = 9; for (const u of [-6, -3, 3, 6]) minD = Math.min(minD, -heightAt(c.x + tx * u, c.z + tz * u));
      if (minD < 0.6) continue;
      const s = Math.abs(d - 2) + Math.abs(a - 0.9) * 0.8 + Math.max(0, 1 - minD);
      if (!best || s < best.s) best = { a, s };
    }
    const a = best?.a ?? 0.9, c = atOffshore(a, 7.5);
    this.pos.set(c.x, 0, c.z);
    this.depth = Math.min(2.8, Math.max(1.3, -heightAt(c.x, c.z)));
    this.axis.set(-Math.sin(a), 0, Math.cos(a)).normalize(); // along the shore
    this.side.set(Math.cos(a), 0, Math.sin(a));
  }

  /** true right beside a hull half (so the shoreline anti-stuck hop doesn't push swimmers through the planks) */
  nearHull(x: number, z: number) {
    const dx = x - this.pos.x, dz = z - this.pos.z, u = Math.abs(dx * this.axis.x + dz * this.axis.z), v = Math.abs(dx * this.side.x + dz * this.side.z);
    return v < BEAM + 1.3 && u > GAP / 2 - 0.7 && u < GAP / 2 + HALF_L * 2 + 2.5;
  }
  get tourSpot() { return { x: this.pos.x + this.side.x * 2, z: this.pos.z + this.side.z * 2 }; }
  /** horizontal distance from (x, z) to the chest */
  chestDist(x: number, z: number) { return Math.hypot(x - this.chest.x, z - this.chest.z); }
  open() { if (this.opened) return false; this.opened = true; return true; }
  /** restore from the save (already looted: lid open, no glow) */
  setOpened(v: boolean) { this.opened = v; this.lidT = v ? 1 : 0; this.lid.rotation.x = -this.lidT * 1.9; this.glow.visible = !v; }

  private updateFish(t: number) {
    for (let i = 0; i < FISH; i++) {
      const ring = i % 2, ph = (i / FISH) * Math.PI * 2 + ring * 0.4, sp = 0.32 + ring * 0.08;
      const ang = ph + t * sp * (ring ? -1 : 1), rx = 5.2 + ring * 1.4 + Math.sin(i * 3.1) * 0.5, rz = 2.6 + ring * 0.9;
      const x = Math.cos(ang) * rx, z = Math.sin(ang) * rz, y = -0.55 - ring * 0.45 - Math.min(this.depth - 1.2, 0.6) * 0.5 + Math.sin(t * 1.3 + i) * 0.1;
      const dx = -Math.sin(ang) * rx * (ring ? -1 : 1), dz = Math.cos(ang) * rz * (ring ? -1 : 1);
      this.e.set(0, Math.atan2(-dz, dx), Math.sin(t * 9 + i) * 0.12);
      this.m.compose(this.v.set(x, y, z), this.q.setFromEuler(this.e), this.s.setScalar(0.85 + (i % 3) * 0.15));
      this.fish.setMatrixAt(i, this.m);
    }
    this.fish.instanceMatrix.needsUpdate = true;
  }

  update(dt: number, t: number, player: THREE.Vector3) {
    if (this.opened && this.lidT < 1) { this.lidT = Math.min(1, this.lidT + dt * 2.2); const k = 1 - Math.pow(1 - this.lidT, 3); this.lid.rotation.x = -k * 1.9; this.glowMat.opacity = 0.35 * (1 - this.lidT); if (this.lidT >= 1) this.glow.visible = false; }
    const near = Math.hypot(player.x - this.pos.x, player.z - this.pos.z) < 70;
    this.group.visible = near;
    if (!near) return;
    this.fishT += dt; this.updateFish(this.fishT);
    this.shaftMat.opacity = 0.1 + Math.sin(t * 0.7) * 0.03;
    if (!this.opened) { this.glowMat.opacity = 0.28 + Math.sin(t * 2.4) * 0.1; this.glow.scale.setScalar(1 + Math.sin(t * 2.4) * 0.08); }
  }

  get debug() { return { x: +this.pos.x.toFixed(1), z: +this.pos.z.toFixed(1), depth: +this.depth.toFixed(2), chest: { x: +this.chest.x.toFixed(2), y: +this.chest.y.toFixed(2), z: +this.chest.z.toFixed(2) }, opened: this.opened, axis: [+this.axis.x.toFixed(2), +this.axis.z.toFixed(2)] }; }
}
