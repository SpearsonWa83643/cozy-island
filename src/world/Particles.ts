import * as THREE from 'three/webgpu';
import { float, length, smoothstep, uv } from 'three/tsl';
import { Biome, BIOME_COUNT } from './Biomes';
import { biomeWeights, heightAt } from './Terrain';
import { mulberry32 } from './noise';

interface FieldCfg {
  name: string; count: number; low: number; geo: THREE.BufferGeometry; mat: THREE.Material;
  weight: (w: Float32Array, x: number, y: number, z: number) => number;
  fall: number; drift: number; minY: number; maxY: number; spin: number; size: number; glow?: boolean; colors?: string[];
  /** whole field hidden (no update, no draw) while this returns 0 */
  gate?: () => number;
}

/** Ambient biome particles (falling leaves, snow, fireflies, pollen/dust) in a box that follows the player. */
class Field {
  mesh: THREE.InstancedMesh;
  private p: Float32Array; private ph: Float32Array; private active: number;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(); private s = new THREE.Vector3(); private v = new THREE.Vector3();
  constructor(public cfg: FieldCfg, private rnd: () => number) {
    this.mesh = new THREE.InstancedMesh(cfg.geo, cfg.mat, cfg.count);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.p = new Float32Array(cfg.count * 3); this.ph = new Float32Array(cfg.count);
    for (let i = 0; i < cfg.count; i++) {
      this.p[i * 3] = (rnd() - 0.5) * 2; this.p[i * 3 + 1] = rnd(); this.p[i * 3 + 2] = (rnd() - 0.5) * 2;
      this.ph[i] = rnd() * 100;
      if (cfg.colors) this.mesh.setColorAt(i, new THREE.Color(cfg.colors[i % cfg.colors.length]));
    }
    this.active = cfg.count;
  }
  setQuality(high: boolean) { this.active = Math.floor(this.cfg.count * (high ? 1 : this.cfg.low)); this.mesh.count = this.active; }
  update(dt: number, t: number, cx: number, cz: number, w: Float32Array) {
    if (this.cfg.gate) { const on = this.cfg.gate() > 0.002; this.mesh.visible = on; if (!on) return; }
    const H = 18, Y = this.cfg.maxY - this.cfg.minY;
    for (let i = 0; i < this.active; i++) {
      const k = i * 3, ph = this.ph[i];
      // local coords in [-1,1] box (xz) and [0,1] (y)
      let lx = this.p[k], ly = this.p[k + 1], lz = this.p[k + 2];
      ly -= (this.cfg.fall * dt) / Y;
      lx += (Math.sin(t * 0.7 + ph) * this.cfg.drift + 0.15 * this.cfg.drift) * dt / H;
      lz += Math.cos(t * 0.5 + ph * 1.3) * this.cfg.drift * dt / H;
      if (this.cfg.fall === 0) ly = 0.5 + Math.sin(t * 0.4 + ph) * 0.45;
      if (ly < 0) { ly += 1; lx = (this.rnd() - 0.5) * 2; lz = (this.rnd() - 0.5) * 2; }
      if (lx > 1) lx -= 2; if (lx < -1) lx += 2; if (lz > 1) lz -= 2; if (lz < -1) lz += 2;
      this.p[k] = lx; this.p[k + 1] = ly; this.p[k + 2] = lz;
      // world position: the box is anchored to a world grid so particles don't slide with the player
      const wx = cx + ((lx * H - cx) % (2 * H) + 3 * H) % (2 * H) - H;
      const wz = cz + ((lz * H - cz) % (2 * H) + 3 * H) % (2 * H) - H;
      const ground = Math.max(heightAt(wx, wz), 0);
      const wy = ground + this.cfg.minY + ly * Y;
      biomeWeights(wx, wz, w);
      let sc = this.cfg.weight(w, wx, wy, wz);
      if (this.cfg.glow) sc *= 0.6 + 0.4 * Math.max(0, Math.sin(t * 2.3 + ph * 7));
      // fade out near box edges to hide wrapping
      const ox = (wx - cx) / H, oz = (wz - cz) / H;
      sc *= Math.min(1, (1 - Math.abs(ox)) * 5) * Math.min(1, (1 - Math.abs(oz)) * 5);
      this.v.set(wx, wy, wz);
      const sp = this.cfg.spin;
      if (sp === 0) this.q.setFromEuler(this.e.set(0, ph, 0));
      else this.q.setFromEuler(this.e.set(t * sp + ph, t * sp * 0.7 + ph * 2, t * sp * 0.4));
      this.s.setScalar(Math.max(0.0001, sc * this.cfg.size));
      this.mesh.setMatrixAt(i, this.m.compose(this.v, this.q, this.s));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Particles {
  group = new THREE.Group();
  fields: Field[] = [];
  /** Order 50 weather inputs (0..1), set by the game each frame; `shelter` = in a cave */
  weather = { rain: 0, snow: 0, shelter: 0 };
  rainMat: THREE.MeshBasicNodeMaterial;
  private w = new Float32Array(BIOME_COUNT);
  constructor() {
    const rnd = mulberry32(777);
    const leafGeo = new THREE.PlaneGeometry(1, 0.7);
    const leafMat = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 0.8 });
    const snowMat = new THREE.MeshBasicNodeMaterial({ color: '#ffffff' });
    const glowMat = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(3.2, 2.6, 0.9) });
    const moteMat = new THREE.MeshBasicNodeMaterial({ transparent: true, opacity: 0.7, depthWrite: false });
    const mistGeo = new THREE.PlaneGeometry(1, 1); mistGeo.rotateX(-Math.PI / 2);
    const mistMat = new THREE.MeshBasicNodeMaterial({ color: '#eef4f0', transparent: true, depthWrite: false, fog: true });
    mistMat.opacityNode = smoothstep(float(0.5), float(0.05), length(uv().sub(0.5))).mul(0.16);
    const W = this.weather;
    const rainK = () => W.rain * (1 - W.shelter), snowK = () => W.snow * (1 - W.shelter);
    this.rainMat = new THREE.MeshBasicNodeMaterial({ color: '#cbd6e6', transparent: true, opacity: 0.5, depthWrite: false, fog: true });
    const flakeMat = new THREE.MeshBasicNodeMaterial({ color: '#f6f9ff', fog: true });
    const cfgs: FieldCfg[] = [
      // weather (Order 50): long thin rain streaks; soft drifting snowfall
      { name: 'rain', count: 1400, low: 0.45, geo: new THREE.BoxGeometry(0.014, 0.62, 0.014), mat: this.rainMat, gate: rainK,
        weight: () => rainK(), fall: 13, drift: 0.25, minY: 0, maxY: 15, spin: 0, size: 1 },
      { name: 'snowfall', count: 700, low: 0.5, geo: new THREE.IcosahedronGeometry(1, 0), mat: flakeMat, gate: snowK,
        weight: () => snowK(), fall: 1.3, drift: 1.0, minY: 0, maxY: 13, spin: 1, size: 0.05 },
      { name: 'mist', count: 70, low: 0.4, geo: mistGeo, mat: mistMat, weight: (w) => Math.max(0, w[Biome.Marsh] - 0.25) * 1.4,
        fall: 0, drift: 0.35, minY: 0.15, maxY: 1.4, spin: 0, size: 7 },
      { name: 'leaves', count: 220, low: 0.35, geo: leafGeo, mat: leafMat, weight: (w) => Math.max(0, w[Biome.Autumn] - 0.2) * 1.25,
        fall: 0.7, drift: 1.4, minY: 0, maxY: 9, spin: 2.2, size: 0.16, colors: ['#e8562e', '#f2a12e', '#d9432a', '#f5c242'] },
      { name: 'snow', count: 600, low: 0.3, geo: new THREE.IcosahedronGeometry(1, 0), mat: snowMat,
        weight: (w, _x, y) => Math.max(0, w[Biome.Alpine] - 0.25) * 1.4 * Math.min(1, Math.max(0, (y - 1.5) / 3)), fall: 1.1, drift: 0.8, minY: 0, maxY: 12, spin: 1, size: 0.045 },
      { name: 'fireflies', count: 90, low: 0.4, geo: new THREE.IcosahedronGeometry(1, 1), mat: glowMat,
        weight: (w) => Math.max(0, w[Biome.Marsh] - 0.2) * 1.3 + Math.max(0, w[Biome.Autumn] - 0.4) * 0.4, fall: 0, drift: 0.9, minY: 0.3, maxY: 2.6, spin: 0, size: 0.05, glow: true },
      { name: 'motes', count: 160, low: 0.35, geo: new THREE.IcosahedronGeometry(1, 0), mat: moteMat,
        weight: (w) => w[Biome.Desert] * 1.0 + w[Biome.Meadow] * 0.5 + w[Biome.Tropical] * 0.35, fall: 0.05, drift: 1.6, minY: 0.2, maxY: 6, spin: 0.5, size: 0.02,
        colors: ['#fff6d8', '#f2d9a8', '#ffffff'] },
    ];
    for (const c of cfgs) { const f = new Field(c, rnd); this.fields.push(f); this.group.add(f.mesh); }
  }
  setQuality(high: boolean) { for (const f of this.fields) f.setQuality(high); }
  update(dt: number, t: number, center: THREE.Vector3) { for (const f of this.fields) f.update(dt, t, center.x, center.z, this.w); }
}
