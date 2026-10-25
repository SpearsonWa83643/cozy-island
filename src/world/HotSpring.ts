import * as THREE from 'three/webgpu';
import { heightAt, slopeAt } from './Terrain';
import { mulberry32 } from './noise';
import { Baker } from './Baker';
import { theme, themeEvents } from '../theme/theme';
import type { IsletDef } from './config';

/**
 * Blossom Isle hot spring (Order 46a): a round, steaming pool ringed with mossy stones on flat meadow on the
 * islet's western half (clear of the cherry grove and the landing pennant). Walk in and you sink down to soak.
 * Baked into one rock mesh + one water disc + one instanced steam mesh (3 draw calls, no shadows on the steam).
 */
export const SPRING_R = 2.7;
/** every hot spring's centre (world xz), filled at construction (treasure dig spots keep clear of them) */
export const springSites: { x: number; z: number; r: number }[] = [];
const PUFFS = 18;
const WATER: Record<string, string> = { spring: '#7fe0d6', summer: '#6fd8e0', autumn: '#8fd8c8', winter: '#a8e8f0', halloween: '#9fd0e8' };

export class HotSpring {
  group = new THREE.Group();
  /** pool centre on the ground (world) and the water surface height */
  pos = new THREE.Vector3(); water = 0;
  found = false;
  private steam!: THREE.InstancedMesh;
  private waterMat!: THREE.MeshStandardNodeMaterial;
  private seeds: number[] = [];
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private s = new THREE.Vector3(); private p = new THREE.Vector3();
  private t = 0;

  constructor(readonly def: IsletDef, avoid: { x: number; z: number; r: number }[]) {
    this.group.name = `hot-spring-${def.id}`;
    this.found = this.findSite(avoid);
    if (this.found) springSites.push({ x: this.pos.x, z: this.pos.z, r: SPRING_R });
  }

  /** flat dry meadow, away from the landing; the grove side (dx*0.7 - dz*0.7 > -18) is avoided */
  private findSite(avoid: { x: number; z: number; r: number }[]) {
    const d = this.def, rnd = mulberry32(d.seed * 3 + 11);
    // Blossom Isle is a gentle cone (~0.2 slope mid-way), so the flat ground is the low meadow ring;
    // try strict first, then relax step by step: [minH, maxSlope, maxSpan, rrMin, rrMax, groveCut]
    const passes: [number, number, number, number, number, number][] = [
      [1.6, 0.16, 0.32, 0.12, 0.62, -22],
      [1.15, 0.14, 0.45, 0.45, 0.8, -14],
      [1.0, 0.2, 0.6, 0.3, 0.82, -6],
    ];
    for (const [minH, maxS, maxSpan, r0, r1, cut] of passes) {
      for (let tries = 0; tries < 2500; tries++) {
        const a = rnd() * Math.PI * 2, rr = (r0 + rnd() * (r1 - r0)) * d.r;
        const x = d.x + Math.cos(a) * rr, z = d.z + Math.sin(a) * rr;
        if ((x - d.x) * 0.7 - (z - d.z) * 0.7 > cut) continue;
        if (avoid.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + SPRING_R + 6)) continue;
        const h = heightAt(x, z);
        if (h < minH || slopeAt(x, z) > maxS) continue;
        let lo = h, hi = h;
        for (let i = 0; i < 12; i++) { const b = (i / 12) * Math.PI * 2; for (const k of [0.5, 1, 1.25]) { const hh = heightAt(x + Math.cos(b) * SPRING_R * k, z + Math.sin(b) * SPRING_R * k); lo = Math.min(lo, hh); hi = Math.max(hi, hh); } }
        if (hi - lo > maxSpan || lo < 0.7) continue;
        this.pos.set(x, h, z); this.water = hi + 0.12;
        return true;
      }
    }
    return false;
  }

  /** bake the pool (called once the islet grid is ready, so heights are final) */
  build() {
    if (!this.found) return;
    const P = this.pos, rnd = mulberry32(this.def.seed + 46);
    // re-measure on the final grid
    let hi = heightAt(P.x, P.z);
    for (let i = 0; i < 16; i++) { const b = (i / 16) * Math.PI * 2; hi = Math.max(hi, heightAt(P.x + Math.cos(b) * SPRING_R, P.z + Math.sin(b) * SPRING_R)); }
    P.y = heightAt(P.x, P.z); this.water = hi + 0.12;
    const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    const b = new Baker();
    const N = 15;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + rnd() * 0.15, d = SPRING_R + 0.15 + rnd() * 0.2;
      const x = Math.cos(a) * d, z = Math.sin(a) * d, r = 0.42 + rnd() * 0.22;
      const y = heightAt(P.x + x, P.z + z) - P.y + r * 0.15;
      b.add(new THREE.DodecahedronGeometry(r, 0), rnd() < 0.35 ? '#8fa070' : rnd() < 0.5 ? '#a8a094' : '#958d82', [x, y, z], [rnd() * 3, rnd() * 3, rnd() * 3], [1.15, 0.6 + rnd() * 0.25, 1]);
    }
    // a few pebbles on the pool floor and a little stone lantern beside it
    for (let i = 0; i < 7; i++) { const a = rnd() * 6.28, d = rnd() * SPRING_R * 0.8; b.add(new THREE.DodecahedronGeometry(0.16 + rnd() * 0.1, 0), '#7d8c88', [Math.cos(a) * d, heightAt(P.x + Math.cos(a) * d, P.z + Math.sin(a) * d) - P.y, Math.sin(a) * d]); }
    const la = Math.atan2(-this.def.z, -this.def.x) + 0.9, lx = Math.cos(la) * (SPRING_R + 1.4), lz = Math.sin(la) * (SPRING_R + 1.4), ly = heightAt(P.x + lx, P.z + lz) - P.y;
    b.add(new THREE.CylinderGeometry(0.28, 0.34, 0.2, 6), '#b8b0a4', [lx, ly + 0.1, lz]);
    b.add(new THREE.CylinderGeometry(0.1, 0.12, 0.7, 6), '#b8b0a4', [lx, ly + 0.55, lz]);
    b.add(new THREE.BoxGeometry(0.46, 0.34, 0.46), '#ffe7a8', [lx, ly + 1.07, lz]);
    b.add(new THREE.ConeGeometry(0.46, 0.34, 4), '#9a9288', [lx, ly + 1.41, lz], [0, Math.PI / 4, 0]);
    const rocks = new THREE.Mesh(b.build(), mat); rocks.name = 'hot-spring-rocks'; rocks.position.copy(P); rocks.castShadow = rocks.receiveShadow = true;
    // water: a slightly domed disc, glowing a little so it reads as warm
    this.waterMat = new THREE.MeshStandardNodeMaterial({ color: WATER[theme.id] ?? WATER.spring, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.82, emissive: new THREE.Color('#2a6a64'), emissiveIntensity: 0.35 });
    const wg = new THREE.CircleGeometry(SPRING_R + 0.2, 28); wg.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(wg, this.waterMat); water.name = 'hot-spring-water'; water.position.set(P.x, this.water, P.z); water.receiveShadow = true; water.renderOrder = 2;
    // steam puffs
    const sg = new THREE.IcosahedronGeometry(0.42, 1);
    const smat = new THREE.MeshBasicNodeMaterial({ color: '#ffffff', transparent: true, opacity: 0.28, depthWrite: false });
    smat.toneMapped = false;
    this.steam = new THREE.InstancedMesh(sg, smat, PUFFS); this.steam.name = 'hot-spring-steam';
    this.steam.castShadow = false; this.steam.receiveShadow = false; this.steam.frustumCulled = false; this.steam.renderOrder = 4;
    for (let i = 0; i < PUFFS; i++) this.seeds.push(rnd());
    this.group.add(rocks, water, this.steam);
    this.tick(0);
    themeEvents.on(() => this.waterMat.color.set(WATER[theme.id] ?? WATER.spring));
  }

  /** steam drifts up and fades (shrinks) away; winter steams the most */
  tick(dt: number) {
    if (!this.steam) return;
    this.t += dt;
    const P = this.pos, tall = theme.id === 'winter' ? 3.6 : 2.6;
    for (let i = 0; i < PUFFS; i++) {
      const sd = this.seeds[i], ph = (this.t * (0.16 + sd * 0.08) + sd * 7.3) % 1;
      const a = sd * 40 + ph * 1.5, rr = (0.3 + ((sd * 13.7) % 1) * 0.65) * SPRING_R;
      this.p.set(P.x + Math.cos(a) * rr + ph * 0.6, this.water + 0.1 + ph * tall, P.z + Math.sin(a) * rr + ph * 0.3);
      const sc = Math.sin(ph * Math.PI) * (0.7 + sd * 0.8);
      this.steam.setMatrixAt(i, this.m.compose(this.p, this.q, this.s.set(sc * 1.3, sc, sc * 1.3)));
    }
    this.steam.instanceMatrix.needsUpdate = true;
  }

  /** is this point soaking in the pool? */
  inside(x: number, y: number, z: number) { return this.found && !!this.steam && Math.hypot(x - this.pos.x, z - this.pos.z) < SPRING_R - 0.25 && y < this.water + 1.4 && y > this.pos.y - 1; }
}
