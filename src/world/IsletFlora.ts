import * as THREE from 'three/webgpu';
import { heightAt, slopeAt } from './Terrain';
import { mulberry32 } from './noise';
import { floraMaterial } from './Flora';
import { Baker } from './Baker';
import * as P from './Plants';
import { theme, themeEvents } from '../theme/theme';
import type { IsletDef } from './config';
import type { Physics } from '../core/Physics';

/**
 * Blossom Isle flora (Order 42b): a cherry grove (pink blossoms, recoloured per theme), meadow bushes and
 * wildflowers, rocks and beach shells, plus a clear grassy landing spot facing home with a little pennant.
 * Built lazily once the islet's grid is ready, one species per frame so stream-in never hitches.
 * Instances are culled by bounding sphere and the whole group hides while the islet's tiles are unloaded.
 */
type Make = (r: () => number) => THREE.BufferGeometry;
interface Spec { name: string; make: Make; variants: number; count: number; h: [number, number]; slope?: number; space: number; scale: [number, number]; trunk?: boolean; shadow?: boolean; tilt?: boolean; cherry?: boolean }

/** blossom colours per theme (winter frosts on top via the season shader) */
export const CHERRY: Record<string, string[]> = {
  spring: ['#ffb3c8', '#ff9fbb', '#ffd3df', '#ffc4d4'],
  summer: ['#ffa8c4', '#8fd46a', '#ffc6d6', '#7cc85a'],
  autumn: ['#ff9a8a', '#f2a05a', '#ffb8b0', '#e8743a'],
  winter: ['#f8e4ec', '#ffd6e2', '#ffffff', '#f0dce6'],
  halloween: ['#c98ae0', '#e8a0d0', '#9a6ac8', '#f0b8e0'],
};
const cherryPal = () => CHERRY[theme.id] ?? CHERRY.spring;
const MEADOW = ['#7ccf5a', '#5fb84a', '#8fdc63', '#a3d95f'];

const SPECS: Spec[] = [
  { name: 'cherry', make: (r) => P.roundTree(r, cherryPal(), '#7a5040'), variants: 3, count: 34, h: [1.1, 99], space: 2.1, scale: [0.95, 1.4], trunk: true, cherry: true },
  { name: 'islebush', make: (r) => P.bush(r, MEADOW), variants: 2, count: 36, h: [0.8, 99], space: 0.8, scale: [0.8, 1.4] },
  { name: 'islerose', make: (r) => P.bush(r, MEADOW, '#ff7aa8'), variants: 1, count: 18, h: [0.9, 99], space: 0.8, scale: [0.8, 1.2] },
  { name: 'islelupine', make: (r) => P.tallFlower(r, 'lupine'), variants: 2, count: 60, h: [0.9, 99], space: 0.5, scale: [0.8, 1.2], shadow: false },
  { name: 'islefoxglove', make: (r) => P.tallFlower(r, 'foxglove'), variants: 1, count: 30, h: [0.9, 99], space: 0.5, scale: [0.8, 1.2], shadow: false },
  { name: 'islerock', make: (r) => P.rock(r, '#b8aea6'), variants: 2, count: 14, h: [-0.4, 99], space: 0.9, scale: [0.4, 1.0], slope: 1 },
  { name: 'isleshell', make: P.shell, variants: 2, count: 30, h: [0.05, 0.65], space: 0.4, scale: [0.8, 1.2], shadow: false, tilt: true },
];

export class IsletFlora {
  group = new THREE.Group();
  /** grassy landing spot facing the main island (kept clear of plants) */
  landing = new THREE.Vector3();
  built = false; cherries = 0; placed = 0; recolours = 0;
  private queue = [...SPECS];
  private mat = floraMaterial();
  private rnd: () => number;
  private occ: { x: number; z: number; r: number }[] = [];
  private cherryMeshes: { mesh: THREE.InstancedMesh; seed: number }[] = [];

  constructor(readonly def: IsletDef, private physics: Physics) {
    this.group.name = `islet-flora-${def.id}`;
    this.group.visible = false;
    this.rnd = mulberry32(def.seed * 7 + 1);
    this.findLanding();
    themeEvents.on(() => this.recolour());
  }

  /** walk in from the shore toward the centre on the side facing home until we hit dry, gentle meadow */
  private findLanding() {
    const d = this.def, a = Math.atan2(-d.z, -d.x);
    let best = { x: d.x, z: d.z, h: heightAt(d.x, d.z) };
    for (let r = d.r; r > 4; r -= 1) {
      const x = d.x + Math.cos(a) * r, z = d.z + Math.sin(a) * r, h = heightAt(x, z);
      if (h > 1.2 && slopeAt(x, z) < 0.35) { best = { x, z, h }; break; }
    }
    this.landing.set(best.x, best.h, best.z);
    this.occ.push({ x: best.x, z: best.z, r: 7 });
  }

  /** call once per frame after the islet is ready; builds one species per call */
  step() {
    if (this.built) return;
    const spec = this.queue.shift();
    if (!spec) { this.buildPennant(); this.built = true; return; }
    this.buildSpec(spec);
  }

  private free(x: number, z: number, r: number) {
    for (const o of this.occ) if (Math.hypot(o.x - x, o.z - z) < o.r + r) return false;
    return true;
  }

  private buildSpec(spec: Spec) {
    const d = this.def, rnd = this.rnd;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s3 = new THREE.Vector3(), p3 = new THREE.Vector3(), tint = new THREE.Color();
    const per = Math.ceil(spec.count / spec.variants);
    for (let v = 0; v < spec.variants; v++) {
      const seed = Math.floor(rnd() * 1e9);
      const im = new THREE.InstancedMesh(spec.make(mulberry32(seed)), this.mat, per);
      let n = 0, tries = 0;
      while (n < per && tries < per * 200) {
        tries++;
        const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * d.r;
        const x = d.x + Math.cos(a) * rr, z = d.z + Math.sin(a) * rr, h = heightAt(x, z);
        if (h < spec.h[0] || h > spec.h[1]) continue;
        if (slopeAt(x, z) > (spec.slope ?? 0.6)) continue;
        // cherries cluster into a grove on the island's eastern half (the landing side stays open meadow)
        if (spec.cherry && ((x - d.x) * 0.7 - (z - d.z) * 0.7 < -18 + rnd() * 30)) continue;
        const sc = spec.scale[0] + rnd() * (spec.scale[1] - spec.scale[0]), r = spec.space * sc;
        if (!this.free(x, z, r)) continue;
        this.occ.push({ x, z, r });
        p3.set(x, h - 0.05, z);
        e.set(spec.tilt ? (rnd() - 0.5) * 0.4 : 0, rnd() * 6.28, spec.tilt ? (rnd() - 0.5) * 0.4 : 0);
        im.setMatrixAt(n, m4.compose(p3, q.setFromEuler(e), s3.setScalar(sc)));
        const br = 0.9 + rnd() * 0.2; im.setColorAt(n, tint.setRGB(br, br, br));
        if (spec.trunk) this.physics.addCylinder(x, h + 1, z, 1, 0.28 * sc);
        n++;
      }
      im.count = n; im.name = spec.name;
      im.castShadow = spec.shadow !== false; im.receiveShadow = true;
      im.computeBoundingSphere();
      this.group.add(im);
      this.placed += n;
      if (spec.cherry) { this.cherries += n; this.cherryMeshes.push({ mesh: im, seed }); }
    }
  }

  /** a little pink pennant on a post + a ring of flat stones marks the landing spot */
  private buildPennant() {
    const b = new Baker(), L = this.landing, rnd = mulberry32(this.def.seed + 5);
    b.add(new THREE.CylinderGeometry(0.06, 0.08, 2.6, 6), '#8a6040', [0, 1.3, 0]);
    const flag = new THREE.BufferGeometry();
    flag.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 2.55, 0, 0.9, 2.3, 0, 0, 2.0, 0, 0, 2.55, 0, 0, 2.0, 0, 0.9, 2.3, 0]), 3));
    flag.computeVertexNormals();
    b.add(flag, '#ff8fb4', [0, 0, 0]);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2, x = Math.cos(a) * 3.2, z = Math.sin(a) * 3.2;
      b.add(new THREE.CylinderGeometry(0.42, 0.48, 0.14, 7), rnd() < 0.5 ? '#cfc6ba' : '#bdb3a6', [x, heightAt(L.x + x, L.z + z) - L.y + 0.03, z], [0, rnd() * 3, 0]);
    }
    const mesh = new THREE.Mesh(b.build(), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.85, flatShading: true, side: THREE.DoubleSide }));
    mesh.name = 'landing-pennant'; mesh.position.copy(L); mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh);
    this.physics.addCylinder(L.x, L.y + 1.3, L.z, 1.3, 0.1);
  }

  /** theme switch: rebake the cherry canopies with the new blossom palette (same seed = same shapes) */
  recolour() {
    for (const c of this.cherryMeshes) {
      const old = c.mesh.geometry;
      c.mesh.geometry = P.roundTree(mulberry32(c.seed), cherryPal(), '#7a5040');
      old.dispose();
      c.mesh.computeBoundingSphere();
    }
    if (this.cherryMeshes.length) this.recolours++;
  }

  get stats() { return { built: this.built, placed: this.placed, cherries: this.cherries, visible: this.group.visible, recolours: this.recolours, landing: { x: +this.landing.x.toFixed(1), y: +this.landing.y.toFixed(2), z: +this.landing.z.toFixed(1) } }; }
}
