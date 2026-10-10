import * as THREE from 'three/webgpu';
import { float, mix, positionLocal, sin, time, uv, vec3 } from 'three/tsl';
import { mulberry32 } from './noise';
import { heightAt, slopeAt, terrainColor, ISLAND_RADIUS } from './Terrain';
import { makeBush, makePine, makeRock, makeRoundTree, mat } from './Models';
import type { Physics } from '../core/Physics';

const SPAWN = new THREE.Vector2(0, 6);

export class Decor {
  group = new THREE.Group();
  grass!: THREE.InstancedMesh;
  grassMax = 0;
  clouds: THREE.Group[] = [];

  constructor(physics: Physics) {
    const rnd = mulberry32(42);
    const occupied: THREE.Vector3[] = [];
    const free = (x: number, z: number, r: number) =>
      occupied.every((o) => Math.hypot(o.x - x, o.z - z) > o.y + r) && Math.hypot(x - SPAWN.x, z - SPAWN.y) > 4;

    const tryPlace = (n: number, minH: number, maxH: number, maxSlope: number, r: number,
      make: () => THREE.Object3D, collide: 'trunk' | 'ball' | 'none', scaleR: [number, number]) => {
      let placed = 0, attempts = 0;
      while (placed < n && attempts < n * 40) {
        attempts++;
        const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * ISLAND_RADIUS * 1.05;
        const x = Math.cos(a) * d, z = Math.sin(a) * d;
        const h = heightAt(x, z);
        if (h < minH || h > maxH || slopeAt(x, z) > maxSlope || !free(x, z, r)) continue;
        const o = make();
        const s = scaleR[0] + rnd() * (scaleR[1] - scaleR[0]);
        o.scale.multiplyScalar(s);
        o.position.set(x, h - 0.05, z);
        o.rotation.y = rnd() * Math.PI * 2;
        this.group.add(o);
        occupied.push(new THREE.Vector3(x, r * s, z));
        if (collide === 'trunk') physics.addCylinder(x, h + 1, z, 1, 0.3 * s);
        if (collide === 'ball') physics.addBall(x, h, z, 0.75 * s * o.scale.y / s);
        placed++;
      }
    };

    tryPlace(26, 0.9, 99, 0.6, 1.6, () => makeRoundTree(rnd, rnd() < 0.2), 'trunk', [0.8, 1.25]);
    tryPlace(14, 1.6, 99, 0.7, 1.4, () => makePine(rnd), 'trunk', [0.8, 1.3]);
    tryPlace(30, 0.7, 99, 0.6, 0.8, () => makeBush(rnd), 'none', [0.8, 1.4]);
    tryPlace(18, -0.6, 99, 1, 0.9, () => {
      const r = makeRock(rnd);
      r.scale.set(0.5 + rnd() * 0.7, 0.35 + rnd() * 0.45, 0.5 + rnd() * 0.7);
      return r;
    }, 'ball', [1, 1]);

    this.buildFlowers(rnd, free);
    this.buildGrass(rnd, free);
    this.buildClouds(rnd);
  }

  private buildFlowers(rnd: () => number, free: (x: number, z: number, r: number) => boolean) {
    const N = 900;
    const stemGeo = new THREE.CylinderGeometry(0.012, 0.015, 0.28, 4); stemGeo.translate(0, 0.14, 0);
    const headGeo = new THREE.IcosahedronGeometry(0.075, 0); headGeo.translate(0, 0.3, 0);
    const stems = new THREE.InstancedMesh(stemGeo, mat('#4f9a43'), N);
    const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardNodeMaterial({ roughness: 0.6, flatShading: true }), N);
    const cols = ['#ff7eb6', '#ffd84d', '#ffffff', '#b98cff', '#ff9a5c', '#7fc8ff'].map((c) => new THREE.Color(c));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    let i = 0, tries = 0;
    // flowers grow in patches
    const patches = Array.from({ length: 28 }, () => {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * ISLAND_RADIUS * 0.85;
      return { x: Math.cos(a) * d, z: Math.sin(a) * d, c: cols[Math.floor(rnd() * cols.length)] };
    });
    while (i < N && tries < N * 10) {
      tries++;
      const pt = patches[Math.floor(rnd() * patches.length)];
      const x = pt.x + (rnd() - 0.5) * 5, z = pt.z + (rnd() - 0.5) * 5;
      const h = heightAt(x, z);
      if (h < 0.85 || slopeAt(x, z) > 0.6 || !free(x, z, 0.1)) continue;
      const sc = 0.8 + rnd() * 0.6;
      p.set(x, h - 0.02, z); s.setScalar(sc); q.setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.3, rnd() * 6, (rnd() - 0.5) * 0.3));
      m.compose(p, q, s);
      stems.setMatrixAt(i, m); heads.setMatrixAt(i, m);
      heads.setColorAt(i, rnd() < 0.8 ? pt.c : cols[Math.floor(rnd() * cols.length)]);
      i++;
    }
    stems.count = heads.count = i;
    heads.castShadow = true;
    stems.receiveShadow = heads.receiveShadow = true;
    this.group.add(stems, heads);
  }

  private buildGrass(rnd: () => number, free: (x: number, z: number, r: number) => boolean) {
    // Tuft of 3 crossed blades, normals pointing up for soft, uniform stylized lighting.
    const pos: number[] = [], uvs: number[] = [], nrm: number[] = [];
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI + rnd() * 0.4;
      const ca = Math.cos(a), sa = Math.sin(a);
      const w = 0.06, h = 0.38 + rnd() * 0.2, lean = (rnd() - 0.5) * 0.2;
      const off = (rnd() - 0.5) * 0.15;
      pos.push(-w * ca + off, 0, -w * sa, w * ca + off, 0, w * sa, lean * sa + off, h, lean * ca);
      uvs.push(0, 0, 1, 0, 0.5, 1);
      nrm.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));

    const material = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 0.9 });
    const tip = uv().y;
    material.colorNode = mix(vec3(0.62), vec3(1.22), tip);
    const pl = positionLocal;
    const sway = sin(time.mul(1.8).add(pl.x.mul(0.35)).add(pl.z.mul(0.25))).mul(0.08)
      .add(sin(time.mul(3.1).add(pl.x.mul(1.3))).mul(0.025));
    material.positionNode = pl.add(vec3(sway, float(0), sway.mul(0.6)).mul(tip.mul(tip)));

    const N = 14000;
    const grass = new THREE.InstancedMesh(geo, material, N);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const c = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    let i = 0, tries = 0;
    while (i < N && tries < N * 6) {
      tries++;
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * ISLAND_RADIUS * 1.05;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const h = heightAt(x, z);
      if (h < 0.75 || slopeAt(x, z) > 0.75 || !free(x, z, 0.05)) continue;
      const sc = 0.7 + rnd() * 0.8;
      p.set(x, h - 0.03, z); q.setFromAxisAngle(up, rnd() * 6.28); s.set(sc, sc * (0.8 + rnd() * 0.5), sc);
      m.compose(p, q, s);
      grass.setMatrixAt(i, m);
      terrainColor(x, z, h, c);
      grass.setColorAt(i, c);
      i++;
    }
    grass.count = i;
    this.grassMax = i;
    grass.receiveShadow = true;
    grass.castShadow = false;
    // Shuffle not needed: rnd order already spatially random, so lowering .count thins uniformly.
    this.grass = grass;
    this.group.add(grass);
  }

  private buildClouds(rnd: () => number) {
    const cm = new THREE.MeshStandardNodeMaterial({ color: '#ffffff', roughness: 1, flatShading: true });
    cm.emissive = new THREE.Color('#fff4ea'); cm.emissiveIntensity = 0.45;
    const geo = new THREE.IcosahedronGeometry(1, 1);
    for (let k = 0; k < 9; k++) {
      const g = new THREE.Group();
      const n = 4 + Math.floor(rnd() * 4);
      for (let i = 0; i < n; i++) {
        const b = new THREE.Mesh(geo, cm);
        const s = 2 + rnd() * 2.5;
        b.scale.set(s * 1.3, s * 0.8, s);
        b.position.set((i - n / 2) * 2.6 + rnd(), rnd() * 1.5, (rnd() - 0.5) * 3);
        g.add(b);
      }
      const a = rnd() * Math.PI * 2, d = 55 + rnd() * 70;
      g.position.set(Math.cos(a) * d, 26 + rnd() * 14, Math.sin(a) * d);
      g.userData.speed = 0.4 + rnd() * 0.5;
      g.lookAt(0, g.position.y, 0);
      this.clouds.push(g);
      this.group.add(g);
    }
  }

  setDensity(f: number) { this.grass.count = Math.floor(this.grassMax * f); }

  update(dt: number) {
    for (const c of this.clouds) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 150) c.position.x = -150;
    }
  }
}
