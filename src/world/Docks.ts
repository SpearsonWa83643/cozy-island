import * as THREE from 'three/webgpu';
import { heightAt } from './Terrain';
import { WATER_LEVEL, ISLETS } from './config';
import { shoreRadius } from './Shore';
import { Baker } from './Baker';
import { BUILDERS, type MountRig } from '../player/MountArt';
import type { Physics } from '../core/Physics';

/**
 * Docks (Order 51b): a little wooden jetty on the main island beach facing Blossom Isle, plus one at every
 * archipelago islet facing home (beside its landing). The rowboat is tied up at the end of one of them:
 * the main dock at first, then wherever you last moored it. Each jetty is one baked mesh (one draw) with one
 * walkable deck collider; the moored rowboat is a static copy of the mount rig that bobs on the swell.
 */
export const DECK_Y = WATER_LEVEL + 0.62;
const WIDTH = 1.7, HALF_W = WIDTH / 2;

export interface Dock {
  /** 0 = main island, k + 1 = islet k */
  i: number; islet: number; name: string;
  /** landward end on the beach and seaward end; unit direction out to sea; deck length */
  start: THREE.Vector2; end: THREE.Vector2; dir: THREE.Vector2; len: number;
  /** where the rowboat ties up (beside the far end) and its heading (bow out to sea) */
  moor: { x: number; z: number; h: number };
  /** where you stand to board / where you step off (on the deck, near the end) */
  step: { x: number; z: number };
  mesh: THREE.Mesh;
}

export class Docks {
  group = new THREE.Group();
  list: Dock[] = [];
  /** dock the rowboat is tied up at */
  boatAt = 0;
  /** the rowboat is out on the water with you (the mount), so the moored copy hides */
  away = false;
  private boat: MountRig; private boatObj = new THREE.Group();

  constructor(physics: Physics, avoid: { x: number; z: number }[] = []) {
    const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.92, flatShading: true });
    const home = ISLETS[0];
    const sites: { cx: number; cz: number; a: number; islet: number; name: string; shore: (a: number) => number }[] = [
      { cx: 0, cz: 0, a: Math.atan2(home.z, home.x), islet: -1, name: 'Home Dock', shore: (a) => shoreRadius(a) },
      ...ISLETS.map((d, k) => ({ cx: d.x, cz: d.z, a: Math.atan2(-d.z, -d.x), islet: k, name: d.name, shore: () => 0 })),
    ];
    sites.forEach((s, i) => {
      const site = this.findSite(s.cx, s.cz, s.a, avoid);
      const dir = new THREE.Vector2(Math.cos(site.a), Math.sin(site.a));
      const start = new THREE.Vector2(s.cx, s.cz).addScaledVector(dir, site.r0), end = new THREE.Vector2(s.cx, s.cz).addScaledVector(dir, site.r1);
      const len = site.r1 - site.r0, yaw = Math.atan2(dir.x, dir.y); // local +z = out to sea
      const geo = this.bake(len, i);
      const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.position.set(start.x, 0, start.y); mesh.rotation.y = yaw; mesh.name = `dock-${i}`;
      this.group.add(mesh);
      // walkable deck: one thin box along the planks
      const mid = start.clone().addScaledVector(dir, len / 2);
      physics.addBox(mid.x, DECK_Y - 0.1, mid.y, HALF_W, 0.1, len / 2, yaw);
      const side = new THREE.Vector2(dir.y, -dir.x); // right of the deck looking out to sea
      const mp = end.clone().addScaledVector(dir, -1.3).addScaledVector(side, HALF_W + 0.85);
      const st = end.clone().addScaledVector(dir, -1.1).addScaledVector(side, HALF_W * 0.35);
      this.list.push({ i, islet: s.islet, name: s.name, start, end, dir, len, moor: { x: mp.x, z: mp.y, h: yaw }, step: { x: st.x, z: st.y }, mesh });
    });
    this.boat = BUILDERS.rowboat();
    this.boatObj.add(this.boat.body); this.boatObj.name = 'moored-rowboat';
    this.group.add(this.boatObj);
    this.place();
  }

  /**
   * Shortest jetty near the wanted bearing: from dry sand (ground >= 0.35 m) out to water deep enough to
   * moor a boat (>= 1.5 m), 6-18 m long, away from the given landmarks.
   */
  private findSite(cx: number, cz: number, a0: number, avoid: { x: number; z: number }[]) {
    let best = { a: a0, r0: 0, r1: 0, score: Infinity };
    for (const da of [0, 0.1, -0.1, 0.2, -0.2, 0.3, -0.3, 0.42, -0.42, 0.55, -0.55, 0.7, -0.7]) {
      const a = a0 + da, ca = Math.cos(a), sa = Math.sin(a);
      // march outward from the centre to the waterline
      let r = 4; while (r < 400 && heightAt(cx + ca * r, cz + sa * r) >= WATER_LEVEL) r += 0.25;
      if (r >= 400) continue;
      const shore = r;
      let r0 = shore; while (r0 > shore - 8 && heightAt(cx + ca * r0, cz + sa * r0) < 0.35) r0 -= 0.25;
      r0 -= 0.6;
      let r1 = shore; while (r1 < shore + 18 && WATER_LEVEL - heightAt(cx + ca * r1, cz + sa * r1) < 1.5) r1 += 0.25;
      r1 = Math.max(r1 + 1.5, r0 + 6);
      if (r1 - r0 > 18) continue;
      const ex = cx + ca * r1, ez = cz + sa * r1;
      if (avoid.some((p) => Math.hypot(p.x - ex, p.z - ez) < 16)) continue;
      const score = (r1 - r0) + Math.abs(da) * 6;
      if (score < best.score) best = { a, r0, r1, score };
    }
    if (!isFinite(best.score)) { // fallback: straight out on the bearing
      const ca = Math.cos(a0), sa = Math.sin(a0); let r = 4; while (r < 400 && heightAt(cx + ca * r, cz + sa * r) >= WATER_LEVEL) r += 0.25;
      best = { a: a0, r0: r - 3, r1: r + 9, score: 0 };
    }
    return best;
  }

  /** planks, stringers, posts with bollard caps, a lantern post and a coil of rope; local +z = out to sea */
  private bake(len: number, seed: number) {
    const b = new Baker(); b.ao = true;
    const PLANK = ['#b3875a', '#a67b4f', '#bf946a', '#9c7148'], DARK = '#6e4a2c', POST = '#7d5636';
    const n = Math.max(1, Math.round(len / 0.34));
    for (let j = 0; j < n; j++) {
      const z = (j + 0.5) * (len / n), wob = ((j * 7 + seed) % 5) * 0.012;
      b.add(new THREE.BoxGeometry(WIDTH + wob * 2, 0.07, len / n - 0.04), PLANK[(j + seed) % 4], [wob, DECK_Y - 0.035, z]);
    }
    for (const sx of [-1, 1]) b.add(new THREE.BoxGeometry(0.12, 0.16, len), DARK, [sx * (HALF_W - 0.2), DECK_Y - 0.15, len / 2]);
    // posts every ~2.2 m down both sides, deep into the sea floor; the last pair rise as bollards
    const posts = Math.max(2, Math.round(len / 2.2) + 1);
    for (let j = 0; j < posts; j++) {
      const z = Math.min(len - 0.12, 0.4 + j * ((len - 0.52) / (posts - 1))), last = j === posts - 1;
      for (const sx of [-1, 1]) {
        const top = DECK_Y + (last ? 0.42 : 0.08), bot = -3.2, h = top - bot;
        b.add(new THREE.CylinderGeometry(0.1, 0.12, h, 7), POST, [sx * (HALF_W + 0.02), bot + h / 2, z]);
        if (last) b.add(new THREE.CylinderGeometry(0.13, 0.11, 0.06, 7), DARK, [sx * (HALF_W + 0.02), top + 0.03, z]);
      }
    }
    // a lantern post at the far end (left side) and a coil of rope by the boat's bollard
    const lz = len - 0.35;
    b.add(new THREE.BoxGeometry(0.1, 1.5, 0.1), POST, [-HALF_W + 0.18, DECK_Y + 0.75, lz]);
    b.add(new THREE.BoxGeometry(0.42, 0.06, 0.08), POST, [-HALF_W + 0.36, DECK_Y + 1.45, lz]);
    b.add(new THREE.BoxGeometry(0.2, 0.26, 0.2), '#3b2a1c', [-HALF_W + 0.5, DECK_Y + 1.26, lz]);
    b.add(new THREE.BoxGeometry(0.15, 0.18, 0.15), '#ffd27a', [-HALF_W + 0.5, DECK_Y + 1.26, lz]);
    b.add(new THREE.TorusGeometry(0.16, 0.05, 5, 12), '#d9c08a', [HALF_W - 0.35, DECK_Y + 0.05, len - 0.6], [Math.PI / 2, 0, 0]);
    // a rope from the bollard down toward the boat
    b.add(new THREE.CylinderGeometry(0.018, 0.018, 1.3, 4), '#d9c08a', [HALF_W + 0.45, DECK_Y + 0.15, len - 0.9], [0.6, 0, Math.PI / 2 - 0.35]);
    return b.build();
  }

  /** the dock (if any) whose mooring is within r of (x, z) */
  nearMoor(x: number, z: number, r = 6) {
    let best: Dock | null = null, bd = r;
    for (const d of this.list) { const e = Math.hypot(d.moor.x - x, d.moor.z - z); if (e < bd) { bd = e; best = d; } }
    return best;
  }
  /** the dock you stand on near its far end, with the rowboat tied there */
  boatHere(x: number, z: number, r = 3.2) {
    if (this.away) return null;
    const d = this.list[this.boatAt];
    return d && Math.hypot(d.moor.x - x, d.moor.z - z) < r ? d : null;
  }
  /** (x, z) is right by a dock deck or its posts (anti-stuck hop must not push through) */
  onDeck(x: number, z: number) {
    for (const d of this.list) {
      const rx = x - d.start.x, rz = z - d.start.y, u = rx * d.dir.x + rz * d.dir.y, v = rx * d.dir.y - rz * d.dir.x;
      if (u > -1 && u < d.len + 1 && Math.abs(v) < HALF_W + 1.2) return true;
    }
    return false;
  }
  private place() {
    const d = this.list[this.boatAt] ?? this.list[0];
    this.boatObj.position.set(d.moor.x, WATER_LEVEL + 0.24, d.moor.z); this.boatObj.rotation.y = d.moor.h;
  }
  /** tie the rowboat up at dock i */
  moorAt(i: number) { this.boatAt = Math.max(0, Math.min(this.list.length - 1, i | 0)); this.away = false; this.place(); }

  update(_dt: number, t: number, cam: THREE.Vector3) {
    for (const d of this.list) d.mesh.visible = Math.hypot(d.end.x - cam.x, d.end.y - cam.z) < 240;
    const d = this.list[this.boatAt];
    const vis = !this.away && Math.hypot(d.moor.x - cam.x, d.moor.z - cam.z) < 200;
    this.boatObj.visible = vis;
    if (!vis) return;
    this.boatObj.position.y = WATER_LEVEL + 0.24 + Math.sin(t * 1.3) * 0.05;
    this.boat.animate?.(t, 0, 'wait', 0, t * 0.5);
  }

  get debug() {
    return { boatAt: this.boatAt, away: this.away, docks: this.list.map((d) => ({ i: d.i, name: d.name, len: +d.len.toFixed(1), moor: { x: +d.moor.x.toFixed(1), z: +d.moor.z.toFixed(1), h: +d.moor.h.toFixed(2) }, step: { x: +d.step.x.toFixed(1), z: +d.step.z.toFixed(1) } })) };
  }
}
