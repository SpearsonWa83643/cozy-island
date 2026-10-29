import * as THREE from 'three/webgpu';
import { heightAt, slopeAt } from './Terrain';
import { mulberry32 } from './noise';
import { floraMaterial } from './Flora';
import { Baker } from './Baker';
import * as P from './Plants';
import { theme, themeEvents } from '../theme/theme';
import type { IsletDef } from './config';
import type { Physics } from '../core/Physics';
import { HotSpring, SPRING_R } from './HotSpring';
import { IsletLandmark } from './Landmark';

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
const WOOD = ['#4f9a3c', '#3f8a35', '#62ab45', '#7bbf4e'];

const SPECS: Spec[] = [
  { name: 'cherry', make: (r) => P.roundTree(r, cherryPal(), '#7a5040'), variants: 3, count: 34, h: [1.1, 99], space: 2.1, scale: [0.95, 1.4], trunk: true, cherry: true },
  { name: 'islebush', make: (r) => P.bush(r, MEADOW), variants: 2, count: 36, h: [0.8, 99], space: 0.8, scale: [0.8, 1.4] },
  { name: 'islerose', make: (r) => P.bush(r, MEADOW, '#ff7aa8'), variants: 1, count: 18, h: [0.9, 99], space: 0.8, scale: [0.8, 1.2] },
  { name: 'islelupine', make: (r) => P.tallFlower(r, 'lupine'), variants: 2, count: 60, h: [0.9, 99], space: 0.5, scale: [0.8, 1.2], shadow: false },
  { name: 'islefoxglove', make: (r) => P.tallFlower(r, 'foxglove'), variants: 1, count: 30, h: [0.9, 99], space: 0.5, scale: [0.8, 1.2], shadow: false },
  { name: 'islerock', make: (r) => P.rock(r, '#b8aea6'), variants: 2, count: 14, h: [-0.4, 99], space: 0.9, scale: [0.4, 1.0], slope: 1 },
  { name: 'isleshell', make: P.shell, variants: 2, count: 30, h: [0.05, 0.65], space: 0.4, scale: [0.8, 1.2], shadow: false, tilt: true },
];

/** flora list for a generated islet: the cherry grove is swapped for the kind's trees, plus an understory accent */
function kindSpecs(kind: string): Spec[] {
  const base = SPECS.filter((sp) => !sp.cherry);
  if (kind === 'pine') return [
    { name: 'islepine', make: (r) => P.pine(r), variants: 3, count: 40, h: [1.1, 99], space: 2.0, scale: [0.9, 1.35], trunk: true },
    { name: 'islebirch', make: P.birch, variants: 2, count: 10, h: [1.1, 99], space: 2.0, scale: [0.9, 1.2], trunk: true },
    { name: 'islefern', make: P.fern, variants: 2, count: 34, h: [0.9, 99], space: 0.7, scale: [0.8, 1.3], shadow: false },
    { name: 'islemushroom', make: (r) => P.mushrooms(r, true), variants: 1, count: 14, h: [1.0, 99], space: 0.6, scale: [0.8, 1.2], shadow: false },
    ...base.filter((sp) => sp.name !== 'islerose'),
  ];
  if (kind === 'palm') return [
    { name: 'islepalm', make: P.palm, variants: 3, count: 26, h: [0.6, 99], space: 2.2, scale: [0.9, 1.3], trunk: true },
    { name: 'isletropic', make: P.tropicalPlant, variants: 2, count: 34, h: [0.8, 99], space: 0.9, scale: [0.8, 1.3] },
    ...base.filter((sp) => sp.name !== 'islefoxglove'),
    { name: 'isleshell2', make: P.shell, variants: 1, count: 24, h: [0.05, 0.65], space: 0.4, scale: [0.9, 1.3], shadow: false, tilt: true },
  ];
  return [{ name: 'isleoak', make: (r) => P.roundTree(r, WOOD), variants: 3, count: 34, h: [1.1, 99], space: 2.1, scale: [0.95, 1.4], trunk: true }, ...base];
}

/** Order 48e: beyond this many metres past the islet's shore the flora swaps to the impostor (back under FAR - HYST) */
export const IMPOSTOR_FAR = 110, IMPOSTOR_HYST = 15;

export class IsletFlora {
  group = new THREE.Group();
  /** grassy landing spot facing the main island (kept clear of plants) */
  landing = new THREE.Vector3();
  built = false; cherries = 0; placed = 0; recolours = 0;
  private queue: Spec[];
  private mat = floraMaterial();
  private rnd: () => number;
  private occ: { x: number; z: number; r: number }[] = [];
  /** Blossom Isle's signature landmark (Order 46a) */
  spring: HotSpring | null = null;
  /** generated islets' landmark (Order 48d) */
  landmark: IsletLandmark | null = null;
  /** Order 48e: tree canopies (world xz, ground y, scale, kind) for the distant-forest impostor */
  trees: { x: number; y: number; z: number; s: number; k: string; c: number }[] = [];
  /** Order 48e: one cheap merged canopy mesh shown instead of the full flora when the camera is far */
  impostor: THREE.Mesh | null = null;
  /** 'near' = full flora, 'far' = impostor only */
  lodMode: 'near' | 'far' = 'near'; lodSwaps = 0;
  private detail: THREE.Object3D[] = [];
  private cherryMeshes: { mesh: THREE.InstancedMesh; seed: number }[] = [];
  /** cherry trunk positions (petals fall from these) */
  cherryPts: { x: number; y: number; z: number }[] = [];
  /** stone lantern path from the landing to the hot spring (Order 46b) */
  path: { x: number; z: number }[] = []; lanterns: { x: number; z: number }[] = [];
  private petals: THREE.InstancedMesh | null = null; private petalMat: THREE.MeshBasicNodeMaterial | null = null;
  private petalSeeds: number[] = []; private pt = 0; petalTicks = 0;
  private pm = new THREE.Matrix4(); private pq = new THREE.Quaternion(); private pe = new THREE.Euler(); private ps = new THREE.Vector3(); private pp = new THREE.Vector3();

  constructor(readonly def: IsletDef, private physics: Physics) {
    this.group.name = `islet-flora-${def.id}`;
    this.group.visible = false;
    this.rnd = mulberry32(def.seed * 7 + 1);
    // Order 48a: generated islets get a green wood instead of Blossom Isle's cherry grove (no petals / sakura)
    // Order 48b: each generated islet has a palette by kind (wood / pine forest / palm beach)
    this.queue = def.id === 'blossom' ? [...SPECS] : kindSpecs(def.kind ?? 'wood');
    this.findLanding();
    if (def.id === 'blossom') {
      this.spring = new HotSpring(def, this.occ);
      if (this.spring.found) { this.occ.push({ x: this.spring.pos.x, z: this.spring.pos.z, r: SPRING_R + 2.2 }); this.group.add(this.spring.group); this.planPath(); }
    } else this.landmark = new IsletLandmark(def, this.occ, this.landing);
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
    if (this.spring?.found && !this.spring.group.children.length) { this.spring.build(); return; }
    if (this.landmark?.found && !this.landmark.mesh) { const m = this.landmark.build(this.physics); if (m) this.group.add(m); return; }
    const spec = this.queue.shift();
    if (!spec) { this.buildPennant(); this.buildPath(); this.buildPetals(); this.buildImpostor(); this.built = true; return; }
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
        if (spec.cherry) this.cherryPts.push({ x, y: h + 2.2 * sc, z });
        if (spec.trunk) this.trees.push({ x, y: h - 0.05, z, s: sc, k: spec.cherry ? 'cherry' : spec.name, c: Math.floor(rnd() * 4) });
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

  /**
   * Order 48e: distant-forest impostor. Every tree becomes one low-poly canopy blob (pine: a single cone, palm: a
   * flat crown on a thin stem, round trees: one icosahedron on a stub), all baked into ONE mesh with the same
   * flora material (season tint, grain) but no sway or shadows. Past IMPOSTOR_FAR the full instanced flora
   * (trees, bushes, flowers, shells, petals) is hidden and only this mesh draws: 1 draw call instead of ~20.
   * The landmark and landing pennant stay (they are single cheap meshes and read from afar).
   */
  private buildImpostor() {
    if (!this.trees.length) return;
    const b = new Baker(); b.ao = false;
    const pal = (k: string): string[] => k === 'cherry' ? cherryPal() : k === 'islepine' ? ['#3f9a5a', '#4aa864', '#378a52', '#3f9a5a'] : k === 'islepalm' ? ['#4fbf4a', '#62cc52', '#3fae46', '#56c24e'] : WOOD;
    const cone = new THREE.ConeGeometry(1, 1, 6), ico = new THREE.IcosahedronGeometry(1, 0), stem = new THREE.CylinderGeometry(0.14, 0.2, 1, 4, 1, true);
    for (const t of this.trees) {
      const x = t.x - this.def.x, z = t.z - this.def.z, y = t.y, s = t.s, col = pal(t.k)[t.c % 4];
      if (t.k === 'islepine') { b.add(stem, '#8a5c3e', [x, y + 0.5 * s, z], [0, 0, 0], [s, s, s]); b.add(cone, col, [x, y + 2.35 * s, z], [0, t.c, 0], [1.3 * s, 3.3 * s, 1.3 * s]); }
      else if (t.k === 'islepalm') { b.add(stem, '#9c7348', [x, y + 2.1 * s, z], [0, 0, 0], [s, 4.2 * s, s]); b.add(ico, col, [x, y + 4.3 * s, z], [0, t.c, 0], [1.9 * s, 0.45 * s, 1.9 * s]); }
      else { b.add(stem, '#7a5040', [x, y + 0.8 * s, z], [0, 0, 0], [s, 1.6 * s, s]); b.add(ico, col, [x, y + 2.75 * s, z], [0, t.c, 0], [1.45 * s, 1.25 * s, 1.45 * s]); }
    }
    const mesh = new THREE.Mesh(b.build(), this.mat);
    mesh.name = `islet-impostor-${this.def.id}`; mesh.position.set(this.def.x, 0, this.def.z);
    mesh.castShadow = false; mesh.receiveShadow = true; mesh.visible = this.lodMode === 'far';
    this.impostor?.geometry.dispose(); if (this.impostor) this.group.remove(this.impostor);
    this.impostor = mesh; this.group.add(mesh);
    this.detail = this.group.children.filter((o) => o !== mesh && o !== this.landmark?.mesh && o.name !== 'landing-pennant');
  }

  /** Order 48e: pick near (full flora) or far (impostor) by camera distance to the islet centre, with hysteresis */
  lod(cx: number, cz: number) {
    if (!this.built || !this.impostor) return;
    const d = Math.hypot(cx - this.def.x, cz - this.def.z) - this.def.r;
    const want = this.lodMode === 'near' ? (d > IMPOSTOR_FAR ? 'far' : 'near') : (d < IMPOSTOR_FAR - IMPOSTOR_HYST ? 'near' : 'far');
    if (want === this.lodMode) return;
    this.lodMode = want; this.lodSwaps++;
    const far = want === 'far';
    for (const o of this.detail) o.visible = !far;
    this.impostor.visible = far;
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

  /** stepping stones every ~1.7 m from the landing to the spring's rim, lanterns every ~7 m on alternating sides */
  private planPath() {
    const L = this.landing, S = this.spring!.pos;
    const dx = S.x - L.x, dz = S.z - L.z, len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len;
    const start = 4, end = len - SPRING_R - 1.2;
    const ts: number[] = []; for (let t = start; t < end - 0.8; t += 1.7) ts.push(t); ts.push(end);
    for (const t of ts) {
      const w = Math.sin(t * 0.09) * 2.2; // a gentle wiggle so it reads as a garden path
      const x = L.x + ux * t - uz * w, z = L.z + uz * t + ux * w;
      this.path.push({ x, z }); this.occ.push({ x, z, r: 1.3 });
    }
    for (let i = 2; i < this.path.length - 1; i += 4) {
      const a = this.path[i], side = (i / 4) % 2 < 1 ? 1 : -1, x = a.x - uz * 1.5 * side, z = a.z + ux * 1.5 * side;
      this.lanterns.push({ x, z }); this.occ.push({ x, z, r: 0.8 });
    }
  }

  private buildPath() {
    if (!this.path.length) return;
    const rnd = mulberry32(this.def.seed + 461), b = new Baker(), glow = new Baker(), O = this.path[0], oy = heightAt(O.x, O.z);
    for (const s of this.path) {
      const y = heightAt(s.x, s.z) - oy, g = new THREE.CylinderGeometry(0.42 + rnd() * 0.12, 0.5, 0.12, 7);
      b.add(g, rnd() < 0.5 ? '#c8c0b4' : '#b4ac9f', [s.x - O.x, y + 0.02, s.z - O.z], [0, rnd() * 3, 0], [1.1 + rnd() * 0.25, 1, 0.85]);
    }
    for (const l of this.lanterns) {
      const x = l.x - O.x, z = l.z - O.z, y = heightAt(l.x, l.z) - oy;
      b.add(new THREE.CylinderGeometry(0.24, 0.3, 0.18, 6), '#b8b0a4', [x, y + 0.09, z]);
      b.add(new THREE.CylinderGeometry(0.08, 0.1, 0.6, 6), '#b8b0a4', [x, y + 0.48, z]);
      b.add(new THREE.ConeGeometry(0.4, 0.3, 4), '#9a9288', [x, y + 1.24, z], [0, Math.PI / 4, 0]);
      glow.add(new THREE.BoxGeometry(0.38, 0.3, 0.38), '#ffe2a0', [x, y + 0.93, z]);
    }
    const mesh = new THREE.Mesh(b.build(), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }));
    mesh.name = 'lantern-path'; mesh.position.set(O.x, oy, O.z); mesh.castShadow = mesh.receiveShadow = true;
    const gm = new THREE.MeshBasicNodeMaterial({ vertexColors: true }); gm.toneMapped = false;
    const lights = new THREE.Mesh(glow.build(), gm); lights.name = 'lantern-lights'; lights.position.copy(mesh.position);
    this.group.add(mesh, lights);
  }

  /** forage spots under the cherry canopies (Order 46c): one per ~2 trees, on dry gentle ground */
  forageSpots(max = 18) {
    const rnd = mulberry32(this.def.seed + 463), out: { x: number; y: number; z: number }[] = [];
    for (const t of this.cherryPts) {
      if (out.length >= max || rnd() < 0.45) continue;
      const a = rnd() * 6.28, r = 0.8 + rnd() * 0.9, x = t.x + Math.cos(a) * r, z = t.z + Math.sin(a) * r, h = heightAt(x, z);
      if (h < 0.6 || slopeAt(x, z) > 0.6) continue;
      out.push({ x, y: h, z });
    }
    return out;
  }

  /** a few dozen petals drift down from the cherry canopies and swirl in the breeze (one instanced draw) */
  private buildPetals() {
    if (!this.cherryPts.length) return;
    const N = 90, g = new THREE.PlaneGeometry(0.16, 0.1);
    this.petalMat = new THREE.MeshBasicNodeMaterial({ color: cherryPal()[0], side: THREE.DoubleSide });
    this.petals = new THREE.InstancedMesh(g, this.petalMat, N); this.petals.name = 'cherry-petals';
    this.petals.castShadow = this.petals.receiveShadow = false; this.petals.frustumCulled = false;
    const rnd = mulberry32(this.def.seed + 462);
    for (let i = 0; i < N; i++) this.petalSeeds.push(rnd());
    this.group.add(this.petals);
    this.tick(0);
  }

  /** animate petals (cheap: 90 matrices); skipped while the islet is hidden */
  tick(dt: number) {
    if (!this.petals || !this.group.visible && dt > 0) return;
    this.pt += dt; this.petalTicks++;
    const T = this.cherryPts, n = this.petalSeeds.length;
    for (let i = 0; i < n; i++) {
      const sd = this.petalSeeds[i], tr = T[Math.floor(sd * 9973) % T.length], ph = (this.pt * (0.07 + sd * 0.05) + sd * 5.1) % 1;
      const a = sd * 31 + this.pt * (0.6 + sd), drift = ph * 3.2, sw = 0.5 + sd * 0.7;
      this.pp.set(tr.x + Math.cos(a) * sw + drift * 0.8, Math.max(heightAt(tr.x, tr.z) + 0.05, tr.y + 0.6 - ph * (tr.y - heightAt(tr.x, tr.z) + 0.6)), tr.z + Math.sin(a) * sw + drift * 0.5);
      this.pe.set(this.pt * (1.3 + sd * 2) + sd * 9, sd * 6.28, this.pt * (0.9 + sd) + sd * 4);
      const sc = ph > 0.93 ? (1 - ph) / 0.07 : 1;
      this.petals.setMatrixAt(i, this.pm.compose(this.pp, this.pq.setFromEuler(this.pe), this.ps.setScalar(sc)));
    }
    this.petals.instanceMatrix.needsUpdate = true;
  }

  /** theme switch: rebake the cherry canopies with the new blossom palette (same seed = same shapes) */
  recolour() {
    if (this.impostor && this.cherryMeshes.length) this.buildImpostor();
    for (const c of this.cherryMeshes) {
      const old = c.mesh.geometry;
      c.mesh.geometry = P.roundTree(mulberry32(c.seed), cherryPal(), '#7a5040');
      old.dispose();
      c.mesh.computeBoundingSphere();
    }
    this.petalMat?.color.set(cherryPal()[0]);
    if (this.cherryMeshes.length) this.recolours++;
  }

  get stats() { return { built: this.built, placed: this.placed, cherries: this.cherries, petals: this.petals?.count ?? 0, petalTicks: this.petalTicks, path: this.path.length, lanterns: this.lanterns.length, visible: this.group.visible, lod: this.lodMode, lodSwaps: this.lodSwaps, impostorTris: this.impostor ? this.impostor.geometry.attributes.position.count / 3 : 0, trees: this.trees.length, recolours: this.recolours, spring: this.spring?.found ? { x: +this.spring.pos.x.toFixed(1), z: +this.spring.pos.z.toFixed(1), y: +this.spring.pos.y.toFixed(2), water: +this.spring.water.toFixed(2), built: this.spring.group.children.length > 0 } : null, landing: { x: +this.landing.x.toFixed(1), y: +this.landing.y.toFixed(2), z: +this.landing.z.toFixed(1) } }; }
}
