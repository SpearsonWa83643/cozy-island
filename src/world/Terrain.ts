import * as THREE from 'three/webgpu';
import { Noise2D } from './noise';

export const WORLD_SIZE = 110; // terrain mesh extent (meters)
export const ISLAND_RADIUS = 30;
export const WATER_LEVEL = 0;

const noise = new Noise2D(7);
const noiseB = new Noise2D(23);

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Analytic island height function (shared by mesh, physics, decor, water). */
export function heightAt(x: number, z: number): number {
  const ang = Math.atan2(z, x);
  const wobble = 1 + 0.16 * noise.noise(Math.cos(ang) * 1.3 + 3, Math.sin(ang) * 1.3 + 3)
    + 0.07 * noise.noise(Math.cos(ang) * 3 + 9, Math.sin(ang) * 3 + 9);
  const r = Math.hypot(x, z) / (ISLAND_RADIUS * wobble);
  const land = smooth(1.05, 0.62, r); // 1 inland, 0 at sea
  const hills = (noise.fbm(x * 0.045 + 10, z * 0.045 - 4, 4) * 0.5 + 0.5);
  const bumps = noiseB.fbm(x * 0.12, z * 0.12, 3) * 0.25;
  // gentle plateau + a soft hill cluster to the north-east
  const hillMask = smooth(0.85, 0.2, r);
  const bigHill = 3.2 * Math.exp(-((x - 9) ** 2 + (z + 8) ** 2) / 90);
  let h = land * 1.1 + hillMask * (hills * 2.6 + bumps + bigHill);
  h -= (1 - land) * 3.5; // seabed
  return h;
}

/** Terrain normal-ish slope (0 flat .. 1 steep). */
export function slopeAt(x: number, z: number): number {
  const e = 0.4;
  const dx = heightAt(x + e, z) - heightAt(x - e, z);
  const dz = heightAt(x, z + e) - heightAt(x, z - e);
  return Math.min(1, Math.hypot(dx, dz) / (2 * e));
}

const SAND = new THREE.Color('#f3d9a4');
const WET_SAND = new THREE.Color('#d9b77f');
const GRASS_LIGHT = new THREE.Color('#9ed36a');
const GRASS = new THREE.Color('#6dbb4f');
const GRASS_DARK = new THREE.Color('#4f9a43');
const ROCK = new THREE.Color('#a49a8c');
const SEABED = new THREE.Color('#c9b48a');

export function terrainColor(x: number, z: number, h: number, out: THREE.Color) {
  const slope = slopeAt(x, z);
  const v = noiseB.fbm(x * 0.08 + 50, z * 0.08, 3) * 0.5 + 0.5;
  if (h < -0.2) out.copy(SEABED).lerp(WET_SAND, smooth(-2, -0.2, h));
  else if (h < 0.55) out.copy(WET_SAND).lerp(SAND, smooth(-0.2, 0.35, h));
  else {
    out.copy(GRASS_DARK).lerp(GRASS, v).lerp(GRASS_LIGHT, smooth(0.55, 1, v) * 0.7);
    out.lerp(SAND, smooth(1.0, 0.55, h)); // soft beach blend
    out.lerp(GRASS_LIGHT, smooth(2.5, 5, h) * 0.4);
  }
  if (h > 0.6) out.lerp(ROCK, smooth(0.55, 0.9, slope) * 0.85);
  return out;
}

export class Terrain {
  mesh: THREE.Mesh;
  heightTexture: THREE.DataTexture;
  vertices: Float32Array;
  indices: Uint32Array;

  constructor() {
    const seg = 180;
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = heightAt(x, z);
      pos.setY(i, h);
      terrainColor(x, z, h, c);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.name = 'terrain';

    this.vertices = new Float32Array(pos.array as Float32Array);
    this.indices = new Uint32Array(geo.index!.array);

    // Height texture used by the water shader for depth tint + shoreline foam.
    const N = 256;
    const data = new Uint8Array(N * N * 4);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1) - 0.5) * WORLD_SIZE;
        const z = (j / (N - 1) - 0.5) * WORLD_SIZE;
        const h = heightAt(x, z);
        const v = Math.min(255, Math.max(0, Math.round(((h + 4) / 10) * 255)));
        data.set([v, v, v, 255], (j * N + i) * 4);
      }
    }
    this.heightTexture = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    this.heightTexture.magFilter = THREE.LinearFilter;
    this.heightTexture.minFilter = THREE.LinearFilter;
    this.heightTexture.wrapS = this.heightTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.heightTexture.needsUpdate = true;
  }
}
