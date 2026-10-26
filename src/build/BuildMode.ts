import * as THREE from 'three/webgpu';
import type RAPIER from '@dimforge/rapier3d';
import type { Physics } from '../core/Physics';
import type { Input } from '../core/Input';
import type { System } from '../core/System';
import { heightAt, type Terrain } from '../world/Terrain';
import { makeBlock, makeFence, makeFlowerPot, makeLamp, makeRoundTree, mat } from '../world/Models';
import { mulberry32 } from '../world/noise';
import { pumpkinGeo, faceGeo, flowerboxGeo, sunflowerGeo, haybaleGeo, snowmanGeo, cornucopiaGeo, xmastreeGeo, giftGeo, skyLanternGeo, heartBalloonGeo, chickGeo } from '../theme/Dress';
import { theme, THEMES } from '../theme/theme';
const SEASONAL = new Set(Object.values(THEMES).flatMap((t) => t.build));

export interface Buildable {
  id: string;
  label: string;
  icon: string;
  make: () => THREE.Object3D;
  /** collider half extents + center height (local, before rotation) */
  box: [number, number, number, number];
  stackable: boolean; // others can be placed on top
  height: number;
  /** walkable pieces: several colliders [offX, centerY, offZ, hx, hy, hz] (local, before rotation) */
  boxes?: [number, number, number, number, number, number][];
  /** bridge: spans water, ends rest on land at +/- span along its length */
  span?: number;
  /** cottage kit: 'edge' pieces sit on a cell edge (auto-facing), 'corner' pieces centre on a cell corner (2x2 roof) */
  snap?: 'edge' | 'corner';
}

const treeRnd = mulberry32(99);
export const BUILDABLES: Buildable[] = [
  { id: 'block', label: 'Wood Block', icon: '🟫', make: makeBlock, box: [0.5, 0.5, 0.5, 0.5], stackable: true, height: 1 },
  { id: 'fence', label: 'Fence', icon: '🚧', make: makeFence, box: [0.5, 0.45, 0.08, 0.45], stackable: false, height: 1 },
  { id: 'lamp', label: 'Lamp', icon: '💡', make: makeLamp, box: [0.15, 1.1, 0.15, 1.1], stackable: false, height: 2.3 },
  { id: 'tree', label: 'Tree', icon: '🌳', make: () => makeRoundTree(treeRnd), box: [0.25, 1.2, 0.25, 1.2], stackable: false, height: 3 },
  { id: 'flowers', label: 'Flower Pot', icon: '🌷', make: makeFlowerPot, box: [0.3, 0.25, 0.3, 0.25], stackable: false, height: 0.6 },
  // seasonal pieces (theme.build lists them; appended so saved indices stay stable)
  { id: 'jackolantern', label: "Jack-o'-Lantern", icon: '🎃', make: makeJack, box: [0.38, 0.35, 0.38, 0.35], stackable: false, height: 0.75 },
  { id: 'spookylamp', label: 'Spooky Lamp', icon: '🏮', make: makeSpookyLamp, box: [0.15, 1.1, 0.15, 1.1], stackable: false, height: 2.3 },
  { id: 'flowerbox', label: 'Flower Box', icon: '🌸', make: makeFlowerBox, box: [0.35, 0.3, 0.22, 0.3], stackable: false, height: 0.7 },
  { id: 'sunflower', label: 'Sunflower', icon: '🌻', make: makeSunflower, box: [0.2, 0.7, 0.2, 0.7], stackable: false, height: 1.4 },
  { id: 'haybale', label: 'Hay Bale', icon: '🌾', make: makeHaybale, box: [0.4, 0.35, 0.35, 0.35], stackable: false, height: 0.75 },
  { id: 'snowman', label: 'Snowman', icon: '⛄', make: makeSnowman, box: [0.35, 0.75, 0.35, 0.75], stackable: false, height: 1.6 },
  { id: 'cornucopia', label: 'Cornucopia', icon: '🌽', make: makeCornucopia, box: [0.3, 0.3, 0.3, 0.3], stackable: false, height: 0.7 },
  { id: 'xmastree', label: 'Holiday Tree', icon: '🎄', make: makeXmasTree, box: [0.4, 1.0, 0.4, 1.0], stackable: false, height: 2.1 },
  { id: 'gift', label: 'Gift Box', icon: '🎁', make: makeGift, box: [0.25, 0.22, 0.25, 0.22], stackable: false, height: 0.5 },
  { id: 'skylantern', label: 'Lantern', icon: '🏮', make: () => wrap(skyLanternGeo()), box: [0.2, 0.22, 0.2, 0.22], stackable: false, height: 0.5 },
  { id: 'heartballoon', label: 'Heart Balloon', icon: '💖', make: () => wrap(heartBalloonGeo()), box: [0.1, 1.0, 0.1, 1.0], stackable: false, height: 2.2 },
  { id: 'chick', label: 'Chick', icon: '🐣', make: () => wrap(chickGeo()), box: [0.15, 0.2, 0.15, 0.2], stackable: false, height: 0.4 },
  // Order 40: walkable pieces (appended so saved indices stay stable)
  { id: 'path', label: 'Stone Path', icon: '🪨', make: makePathTile, box: [0.5, 0.04, 0.5, 0.04], stackable: false, height: 0.08 },
  { id: 'stairs', label: 'Stairs', icon: '🪜', make: makeStairs, box: [0.5, 0.5, 0.5, 0.5], stackable: false, height: 1,
    boxes: [0, 1, 2].map((i) => [0, (i + 1) / 6, -0.5 + (i + 0.5) / 3, 0.5, (i + 1) / 6, 1 / 6] as [number, number, number, number, number, number]) },
  { id: 'bridge', label: 'Bridge', icon: '🌉', make: makeBridge, box: [0.6, 0.1, 1.5, 0.2], stackable: false, height: 0.4, span: 1.3,
    boxes: [[0, 0.1, -1.1, 0.6, 0.08, 0.4], [0, 0.24, -0.45, 0.6, 0.08, 0.3], [0, 0.32, 0.2, 0.6, 0.08, 0.4], [0, 0.24, 0.8, 0.6, 0.08, 0.3], [0, 0.1, 1.3, 0.6, 0.08, 0.2]] },
  // Order 44: cottage kit (appended so saved indices stay stable). Walls run along local x on a cell edge.
  { id: 'wall', label: 'Wall', icon: '🧱', make: () => makeWall(false), box: [0.55, 1.15, 0.07, 0.85], stackable: false, height: 2, snap: 'edge' },
  { id: 'window', label: 'Window', icon: '🪟', make: () => makeWall(true), box: [0.55, 1.15, 0.07, 0.85], stackable: false, height: 2, snap: 'edge' },
  // door: two jambs + lintel stay solid; the leaf collider (last) switches off while the door is open
  { id: 'door', label: 'Door', icon: '🚪', make: makeDoor, box: [0.55, 1.15, 0.07, 0.85], stackable: false, height: 2, snap: 'edge',
    boxes: [[-0.5, 0.85, 0, 0.07, 1.15, 0.07], [0.5, 0.85, 0, 0.07, 1.15, 0.07], [0, 1.9, 0, 0.55, 0.1, 0.07], [0, 0.85, 0, 0.43, 0.95, 0.05]] },
  { id: 'roof', label: 'Roof', icon: '🛖', make: makeRoof, box: [1.25, 0.08, 1.25, 2.1], stackable: false, height: 1, snap: 'corner' },
  // Order 47: placing one unlocks the hot-air balloon mount (it floats over from its pad)
  { id: 'balloonpad', label: 'Balloon Pad', icon: '🎈', make: makeBalloonPad, box: [0.95, 0.08, 0.95, 0.08], stackable: false, height: 0.16 },
];
/** round plank deck with a coral ring, a mooring post and a little striped windsock */
function makeBalloonPad() {
  const g = new THREE.Group();
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.0, 0.16, 20), mat('#b98a58', { rough: 0.85 })); deck.position.y = 0.08; g.add(deck);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.05, 6, 28), mat('#ff7a6b', { rough: 0.6 })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.17; g.add(ring);
  const dot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.02, 14), mat('#ffe3a8', { rough: 0.6 })); dot.position.y = 0.17; g.add(dot);
  for (let i = 0; i < 6; i++) { const pl = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.012, 0.03), mat('#8a6238', { rough: 0.9 })); pl.position.set(0, 0.165, -0.8 + i * 0.32); pl.scale.x = Math.sqrt(Math.max(0.05, 1 - ((-0.8 + i * 0.32) / 0.95) ** 2)); g.add(pl); }
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.3, 8), timber()); post.position.set(0.8, 0.8, 0.1); g.add(post);
  const sock = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.45, 10, 1, true), mat('#ff7a6b', { rough: 0.7 })); sock.rotation.z = Math.PI / 2; sock.position.set(1.02, 1.36, 0.1); g.add(sock);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.1, 10, 1, true), mat('#ffffff', { rough: 0.7 })); band.rotation.z = Math.PI / 2; band.position.set(1.0, 1.36, 0.1); g.add(band);
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
const WALL_H = 2.0, DOOR_W = 0.86, DOOR_H = 1.8;
const plaster = () => mat('#f3e6cf', { rough: 0.9 }), timber = () => mat('#9a6a3e', { rough: 0.8 });
type Mat = THREE.Material;
function boxIn(parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, m: Mat, z = 0) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = b.receiveShadow = true; parent.add(b); return b;
}
/** 1.1 m wall panel (overlaps its neighbours at corners), sunk 0.3 m so it meets sloped ground */
function makeWall(win: boolean) {
  const g = new THREE.Group();
  const P = plaster(), T = timber();
  if (!win) boxIn(g, 1.1, WALL_H + 0.3, 0.12, 0, (WALL_H - 0.3) / 2, P);
  else {
    // panel with a 0.5 x 0.5 window hole at 0.95..1.45 m
    boxIn(g, 1.1, 1.25, 0.12, 0, (0.95 - 0.3) / 2, P);
    boxIn(g, 1.1, WALL_H - 1.45, 0.12, 0, (WALL_H + 1.45) / 2, P);
    boxIn(g, 0.3, 0.5, 0.12, -0.4, 1.2, P); boxIn(g, 0.3, 0.5, 0.12, 0.4, 1.2, P);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.03), mat('#bfe6ff', { rough: 0.2, emissive: '#ffd98a', ei: 0.25 })); glass.position.y = 1.2; g.add(glass);
    boxIn(g, 0.04, 0.5, 0.15, 0, 1.2, T); boxIn(g, 0.5, 0.04, 0.15, 0, 1.2, T);
    boxIn(g, 0.62, 0.06, 0.2, 0, 0.92, T); // sill
  }
  boxIn(g, 1.12, 0.1, 0.14, 0, WALL_H - 0.05, T); // top beam
  boxIn(g, 1.12, 0.12, 0.14, 0, 0, T); // ground beam
  return g;
}
function makeDoor() {
  const g = new THREE.Group();
  const P = plaster(), T = timber();
  const jw = (1.1 - DOOR_W) / 2;
  boxIn(g, jw, WALL_H + 0.3, 0.12, -0.55 + jw / 2, (WALL_H - 0.3) / 2, P); boxIn(g, jw, WALL_H + 0.3, 0.12, 0.55 - jw / 2, (WALL_H - 0.3) / 2, P);
  boxIn(g, DOOR_W, WALL_H - DOOR_H, 0.12, 0, (WALL_H + DOOR_H) / 2, P);
  boxIn(g, 1.12, 0.1, 0.14, 0, WALL_H - 0.05, T);
  boxIn(g, 0.06, DOOR_H, 0.16, -DOOR_W / 2, DOOR_H / 2, T); boxIn(g, 0.06, DOOR_H, 0.16, DOOR_W / 2, DOOR_H / 2, T); boxIn(g, DOOR_W, 0.06, 0.16, 0, DOOR_H, T);
  // the leaf swings on a hinge at the left jamb
  const hinge = new THREE.Group(); hinge.position.set(-DOOR_W / 2 + 0.03, 0, 0); hinge.name = 'hinge'; g.add(hinge);
  const leaf = new THREE.Group(); leaf.position.x = (DOOR_W - 0.06) / 2; hinge.add(leaf);
  const wood = mat('#c47a45', { rough: 0.75 });
  boxIn(leaf, DOOR_W - 0.08, DOOR_H - 0.04, 0.06, 0, (DOOR_H - 0.04) / 2, wood);
  for (const y of [0.45, 1.35]) boxIn(leaf, DOOR_W - 0.14, 0.06, 0.08, 0, y, T);
  for (const z of [0.06, -0.06]) { const knob = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), mat('#e8c25a', { rough: 0.3 })); knob.position.set((DOOR_W - 0.08) / 2 - 0.1, 0.95, z); leaf.add(knob); }
  return g;
}
/** 2x2 gable roof, ridge along local x, base at wall-top height */
function makeRoof() {
  const g = new THREE.Group();
  const tile = mat('#c8553d', { rough: 0.8 }), tile2 = mat('#a8432f', { rough: 0.8 }), P = plaster();
  const half = 1.3, rise = 0.95, run = 1.3;
  const len = Math.hypot(run, rise), ang = Math.atan2(rise, run);
  for (const s of [-1, 1]) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(2 * half, 0.08, len + 0.08), s > 0 ? tile : tile2);
    slab.position.set(0, WALL_H + rise / 2, s * run / 2); slab.rotation.x = s * ang; slab.castShadow = slab.receiveShadow = true; g.add(slab);
    for (let k = 1; k < 4; k++) { // tile rows
      const f = k / 4, row = new THREE.Mesh(new THREE.BoxGeometry(2 * half + 0.02, 0.05, 0.06), tile2);
      row.position.set(0, WALL_H + rise * (1 - f) + 0.06, s * run * f); g.add(row);
    }
  }
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(2 * half + 0.1, 0.12, 0.16), tile2); ridge.position.y = WALL_H + rise + 0.03; g.add(ridge);
  // gable ends fill the triangle above the end walls
  const r = rise / run;
  const tri = new THREE.Shape(); tri.moveTo(-1.05, 0); tri.lineTo(1.05, 0); tri.lineTo(0, 1.05 * r); tri.closePath();
  const gable = new THREE.ExtrudeGeometry(tri, { depth: 0.1, bevelEnabled: false });
  for (const x of [-1.05, 0.95]) { const m = new THREE.Mesh(gable, P); m.rotation.y = Math.PI / 2; m.position.set(x, WALL_H, 0); m.castShadow = true; g.add(m); }
  const ch = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.7, 0.28), mat('#9c8f84')); ch.position.set(0.6, WALL_H + rise * 0.55 + 0.2, 0.55); ch.castShadow = true; g.add(ch);
  return g;
}
/** bridge deck height along its length (local z in [-1.5, 1.5]) */
export const bridgeArc = (z: number) => 0.4 * Math.cos((z / 1.5) * (Math.PI / 2)) ** 0.8;
function makePathTile() {
  const g = new THREE.Group();
  const bed = new THREE.Mesh(new THREE.BoxGeometry(1, 0.05, 1), mat('#b9a27e')); bed.position.y = 0.025; bed.receiveShadow = true; g.add(bed);
  const stone = mat('#a9adb3', { rough: 0.9 }), stone2 = mat('#c3c6ca', { rough: 0.9 });
  const pos: [number, number, number][] = [[-0.24, -0.24, 0.2], [0.23, -0.22, 0.21], [-0.22, 0.24, 0.21], [0.25, 0.25, 0.19], [0, 0, 0.12]];
  pos.forEach(([x, z, r], i) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.05, 0.05, 7), i % 2 ? stone : stone2);
    m.position.set(x, 0.06, z); m.rotation.y = i * 0.7; m.castShadow = false; m.receiveShadow = true; g.add(m);
  });
  return g;
}
function makeStairs() {
  const g = new THREE.Group();
  const wood = mat('#d9a36a', { rough: 0.8 }), edge = mat('#b47f4c');
  for (let i = 0; i < 3; i++) {
    const h = (i + 1) / 3;
    const s = new THREE.Mesh(new THREE.BoxGeometry(1, h, 1 / 3), wood); s.position.set(0, h / 2, -0.5 + (i + 0.5) / 3);
    const t = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.04, 1 / 3 + 0.02), edge); t.position.set(0, h - 0.01, s.position.z);
    s.castShadow = s.receiveShadow = true; t.receiveShadow = true; g.add(s, t);
  }
  return g;
}
function makeBridge() {
  const g = new THREE.Group();
  const plank = mat('#c8955c', { rough: 0.8 }), dark = mat('#8a5a32'), rope = mat('#e8d6a8');
  const n = 13;
  for (let i = 0; i < n; i++) {
    const z = -1.5 + (i + 0.5) * (3 / n);
    const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 3 / n - 0.03), i % 2 ? plank : dark);
    p.position.set(0, bridgeArc(z) + 0.02, z); p.rotation.x = -Math.atan2(bridgeArc(z + 0.05) - bridgeArc(z - 0.05), 0.1);
    p.castShadow = p.receiveShadow = true; g.add(p);
  }
  for (const x of [-0.58, 0.58]) for (let i = 0; i <= 4; i++) {
    const z = -1.4 + i * 0.7;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.08), dark); post.position.set(x, bridgeArc(z) + 0.27, z); post.castShadow = true; g.add(post);
    if (i < 4) {
      const z2 = z + 0.7, y1 = bridgeArc(z) + 0.5, y2 = bridgeArc(z2) + 0.5;
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, Math.hypot(0.7, y2 - y1)), rope);
      r.position.set(x, (y1 + y2) / 2, (z + z2) / 2); r.rotation.x = -Math.atan2(y2 - y1, 0.7); g.add(r);
    }
  }
  return g;
}
function makeJack() {
  const g = new THREE.Group();
  const sh = new THREE.Mesh(pumpkinGeo(0.45), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.55 })); sh.castShadow = true;
  const f = new THREE.Mesh(faceGeo(0.45), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color('#ffb347').multiplyScalar(2.2) }));
  g.add(sh, f); return g;
}
function makeSpookyLamp() {
  const g = makeLamp();
  g.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.MeshStandardNodeMaterial | undefined; if (!m || !('emissive' in m)) return;
    const c = m.clone(); if (c.emissiveIntensity > 1) { c.color.set('#ffb070'); c.emissive.set('#ff7a1a'); } else c.color.set('#3a2a50'); (o as THREE.Mesh).material = c; });
  return g;
}
const std = () => new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.55 });
function wrap(geo: THREE.BufferGeometry) { const g = new THREE.Group(); const m = new THREE.Mesh(geo, std()); m.castShadow = true; g.add(m); return g; }
function makeFlowerBox() { return wrap(flowerboxGeo()); }
function makeSunflower() { return wrap(sunflowerGeo()); }
function makeHaybale() { return wrap(haybaleGeo()); }
function makeSnowman() { return wrap(snowmanGeo()); }
function makeCornucopia() { return wrap(cornucopiaGeo()); }
function makeXmasTree() { return wrap(xmastreeGeo()); }
function makeGift() { return wrap(giftGeo()); }

interface Placed { obj: THREE.Object3D; colliders: RAPIER.Collider[]; def: Buildable; }

export class BuildMode implements System {
  active = false;
  /** touch: taps remove instead of place */
  removeMode = false;
  selected = 0;
  rotation = 0;
  group = new THREE.Group();
  private ghost: THREE.Object3D | null = null;
  /** yaw chosen by edge/corner snapping (cottage kit) */
  private targetRot = 0;
  private ghostValid = false;
  private ghostMatState = true;
  private cell = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicNodeMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false }),
  );
  private ghostMatOk = new THREE.MeshStandardNodeMaterial({ color: '#9effa8', transparent: true, opacity: 0.55, emissive: '#3aff6a', emissiveIntensity: 0.35, depthWrite: false });
  private ghostMatBad = new THREE.MeshStandardNodeMaterial({ color: '#ff8a8a', transparent: true, opacity: 0.55, emissive: '#ff3a3a', emissiveIntensity: 0.35, depthWrite: false });
  private placed: Placed[] = [];
  /** pieces placed this session, newest last (Undo pops these) */
  private history: Placed[] = [];
  private ghostYaw = 0;
  private raycaster = new THREE.Raycaster();
  private target = new THREE.Vector3();
  private hoverPlaced: Placed | null = null;
  onChange: () => void = () => {};
  onPlace: (type: number) => void = () => {};
  onRemove: () => void = () => {};

  constructor(private scene: THREE.Scene, private camera: THREE.Camera, private terrain: Terrain,
    private physics: Physics, private input: Input, private playerPos: () => THREE.Vector3) {
    scene.add(this.group);
    this.cell.visible = false;
    this.cell.renderOrder = 5;
    scene.add(this.cell);
    input.onClick.push((e, drag) => {
      if (!this.active || drag) return;
      if (e.button === 0) {
        // taps carry no hover history: aim at the tap point first
        this.input.setMouse(e.clientX, e.clientY);
        if (this.removeMode) {
          // far pieces: walk over first (tap-to-walk), then remove on arrival
          this.computeTarget();
          const hp = this.hoverPlaced;
          if (hp && hp.obj.position.distanceTo(this.playerPos()) > 4.5 && this.onFarRemove(hp.obj.position.clone(), () => this.removePiece(hp))) return;
          this.removeHovered();
        }
        else { this.refreshTarget(); this.place(); }
      } else if (e.button === 2) this.removeHovered();
    });
  }

  /** Order 44: tap a door (outside Build Mode) to swing it open or shut; open doors let you walk through */
  toggleDoor(p: Placed, open = !p.obj.userData.open) {
    if (p.def.id !== 'door' || !this.placed.includes(p)) return false;
    p.obj.userData.open = open;
    p.colliders[p.colliders.length - 1]?.setEnabled(!open);
    this.onChange();
    return true;
  }
  /** door pieces whose leaf is swinging toward its open/shut angle */
  private swingDoors(dt: number) {
    for (const p of this.placed) {
      if (p.def.id !== 'door') continue;
      const h = p.obj.getObjectByName('hinge'); if (!h) continue;
      const want = p.obj.userData.open ? -Math.PI * 0.55 : 0;
      if (Math.abs(h.rotation.y - want) > 1e-3) h.rotation.y += (want - h.rotation.y) * Math.min(1, dt * 9);
    }
  }

  get count() { return this.placed.length; }
  /** placed pieces (tap reactions, tests) */
  get pieces() { return this.placed; }

  /** true if a placed piece occupies the cell at (x, z) (used by wandering animals) */
  occupiedAt(x: number, z: number) {
    for (const p of this.placed) if (Math.abs(p.obj.position.x - x) < 0.65 && Math.abs(p.obj.position.z - z) < 0.65) return true;
    return false;
  }

  /** seasonal pieces only while their theme is active */
  available(i: number) { const d = BUILDABLES[i]; return !!d && (!SEASONAL.has(d.id) || theme.build.includes(d.id)); }
  setRemoveMode(on: boolean) {
    this.removeMode = on;
    if (this.ghost) this.ghost.visible = !on;
    this.onChange();
  }

  private refreshTarget() {
    const ok = this.computeTarget();
    this.ghostValid = ok && this.isValid();
  }

  toggle(on = !this.active) {
    this.active = on;
    if (!on) this.removeMode = false;
    this.cell.visible = on;
    if (!on && this.ghost) { this.scene.remove(this.ghost); this.ghost = null; }
    if (on) this.rebuildGhost();
    this.onChange();
  }

  select(i: number) {
    const n = BUILDABLES.length, dir = i < this.selected ? -1 : 1;
    let k = ((i % n) + n) % n;
    for (let g = 0; g < n && !this.available(k); g++) k = (((k + dir) % n) + n) % n;
    this.selected = k;
    if (this.active) this.rebuildGhost();
    this.onChange();
  }

  private rebuildGhost() {
    if (this.ghost) this.scene.remove(this.ghost);
    const g = BUILDABLES[this.selected].make();
    g.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; m.renderOrder = 6; } });
    this.ghost = g;
    this.scene.add(g);
    this.ghostValid = true;
    this.ghostYaw = this.rotation;
    this.ghostMatState = true;
    this.applyGhostMat(true);
  }

  private applyGhostMat(ok: boolean) {
    if (!this.ghost) return;
    const m = ok ? this.ghostMatOk : this.ghostMatBad;
    this.ghost.traverse((c) => { const mesh = c as THREE.Mesh; if (mesh.isMesh) mesh.material = m; });
  }

  /** Compute the snapped placement target under the mouse. */
  private computeTarget(): boolean {
    this.raycaster.setFromCamera(new THREE.Vector2(this.input.mouse.ndcX, this.input.mouse.ndcY), this.camera);
    const objHits = this.raycaster.intersectObjects(this.group.children, true);
    const ground = this.terrain.raycast(this.raycaster.ray.origin, this.raycaster.ray.direction);
    const gd = ground ? ground.distanceTo(this.raycaster.ray.origin) : Infinity;
    this.hoverPlaced = null;
    let hit: { object: THREE.Object3D; point: THREE.Vector3; face?: THREE.Face | null };
    if (objHits.length && objHits[0].distance < gd) hit = objHits[0];
    else if (ground) hit = { object: this.terrain.mesh, point: ground, face: null };
    else return false;
    const placed = this.findPlaced(hit.object);
    this.hoverPlaced = placed;
    const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
    if (placed && placed.def.stackable && n.y > 0.7) {
      // stack on top of a block
      this.target.set(placed.obj.position.x, placed.obj.position.y + placed.def.height, placed.obj.position.z);
      return true;
    }
    let p = hit.point.clone();
    if (placed && placed.def.stackable) p.add(n.clone().multiplyScalar(0.5)); // side of block -> neighbour cell
    const def = BUILDABLES[this.selected];
    // wall pieces look through other cottage pieces to the ground behind them, so tapping next to a wall picks the edge under the finger
    if (def.snap === 'edge' && placed?.def.snap && ground) p = ground.clone();
    if (def.snap) { this.snapTarget(def, p); return true; }
    this.targetRot = this.rotation;
    const x = Math.round(p.x), z = Math.round(p.z);
    // sit on lowest-cost ground: average of cell corners so blocks don't float
    const h = def.span ? this.spanBase(x, z, def.span, this.rotation)
      : Math.min(heightAt(x - 0.4, z - 0.4), heightAt(x + 0.4, z - 0.4), heightAt(x - 0.4, z + 0.4), heightAt(x + 0.4, z + 0.4), heightAt(x, z));
    this.target.set(x, h, z);
    return true;
  }

  /** cottage kit snapping: walls/doors/windows to the nearest cell edge (facing along it), roofs to the nearest cell corner */
  private snapTarget(def: Buildable, p: THREE.Vector3) {
    if (def.snap === 'edge') {
      const cx = Math.round(p.x), cz = Math.round(p.z), fx = p.x - cx, fz = p.z - cz;
      // a quarter turn (Rotate) flips which side a door swings toward
      const flip = Math.round(this.rotation / (Math.PI / 2)) % 2 === 1 ? Math.PI : 0;
      let x = cx, z = cz;
      if (Math.abs(fx) > Math.abs(fz)) { x = cx + Math.sign(fx || 1) * 0.5; this.targetRot = Math.PI / 2 + flip; }
      else { z = cz + Math.sign(fz || 1) * 0.5; this.targetRot = flip; }
      this.target.set(x, this.edgeBase(x, z, this.targetRot), z);
    } else {
      const x = Math.floor(p.x) + 0.5, z = Math.floor(p.z) + 0.5;
      this.targetRot = Math.round(this.rotation / (Math.PI / 2)) % 2 === 1 ? Math.PI / 2 : 0;
      this.target.set(x, this.roofBase(x, z), z);
    }
  }
  /** an edge piece sits on the lowest ground along its edge (its panel is sunk to cover slopes) */
  private edgeBase(x: number, z: number, rot: number) {
    const dx = Math.cos(rot) * 0.5, dz = -Math.sin(rot) * 0.5;
    return Math.max(0.05, Math.min(heightAt(x - dx, z - dz), heightAt(x, z), heightAt(x + dx, z + dz)));
  }
  /** a roof rests on the highest wall base of its 2x2 footprint (walls stand WALL_H tall) */
  private roofBase(x: number, z: number) {
    let h = -Infinity;
    for (const [ox, oz] of [[-1, -0.5], [1, -0.5], [-1, 0.5], [1, 0.5], [-0.5, -1], [-0.5, 1], [0.5, -1], [0.5, 1]]) h = Math.max(h, this.edgeBase(x + ox, z + oz, ox === -1 || ox === 1 ? Math.PI / 2 : 0));
    // snap onto real walls if some are already standing round this footprint
    for (const q of this.placed) if (q.def.snap === 'edge' && Math.abs(q.obj.position.x - x) <= 1.01 && Math.abs(q.obj.position.z - z) <= 1.01) h = Math.max(h, q.obj.position.y);
    return h;
  }

  private findPlaced(o: THREE.Object3D | null): Placed | null {
    while (o) {
      const p = this.placed.find((pl) => pl.obj === o);
      if (p) return p;
      o = o.parent;
    }
    return null;
  }

  /** ends of a spanning piece (bridge) along its rotated length */
  private spanEnds(x: number, z: number, span: number, rot: number) {
    const dx = Math.sin(rot) * span, dz = Math.cos(rot) * span;
    return [heightAt(x - dx, z - dz), heightAt(x + dx, z + dz)];
  }
  /** a bridge rests on its higher end, never below the water line */
  private spanBase(x: number, z: number, span: number, rot: number) { return Math.max(0.05, ...this.spanEnds(x, z, span, rot)); }

  private isValid(): boolean {
    const t = this.target;
    const def = BUILDABLES[this.selected];
    if (def.span) {
      // both ends on land (it spans the stream/pond between them), and not a steep drop
      const [a, b] = this.spanEnds(t.x, t.z, def.span, this.rotation);
      // banks may be the wet pond rim (just under the water line): the deck still sits above the water
      if (a < -0.1 || b < -0.1 || Math.abs(a - b) > 0.35) return false;
    } else if (def.snap) {
      if (heightAt(t.x, t.z) < 0.1) return false;
    } else if (heightAt(t.x, t.z) < 0.15) return false; // no building in the sea
    if (t.y > 12) return false;
    const pp = this.playerPos();
    if (def.snap !== 'corner' && Math.hypot(pp.x - t.x, pp.z - t.z) < (def.snap ? 0.45 : 0.7) && Math.abs(pp.y - t.y) < 1.5) return false;
    // occupied cell at same level?
    return !this.placed.some((p) => Math.abs(p.obj.position.x - t.x) < 0.01 && Math.abs(p.obj.position.z - t.z) < 0.01
      && Math.abs(p.obj.position.y - t.y) < 0.5);
  }

  place(): boolean {
    if (!this.active || !this.ghostValid) return false;
    const def = BUILDABLES[this.selected];
    const ok = this.placeAt(this.target.x, this.target.z, this.selected, def.snap ? this.targetRot : this.rotation, this.target.y);
    if (ok) { this.history.push(this.placed[this.placed.length - 1]); if (this.history.length > 50) this.history.shift(); this.onPlace(this.selected); this.onChange(); }
    return ok;
  }

  placeAt(x: number, z: number, type: number, rot = 0, y?: number): boolean {
    const def = BUILDABLES[type];
    const obj = def.make();
    const yy = y ?? (def.snap === 'edge' ? this.edgeBase(x, z, rot) : def.snap === 'corner' ? this.roofBase(x, z) : def.span ? this.spanBase(x, z, def.span, rot)
      : Math.min(heightAt(x - 0.4, z - 0.4), heightAt(x + 0.4, z + 0.4), heightAt(x + 0.4, z - 0.4), heightAt(x - 0.4, z + 0.4)));
    obj.position.set(x, yy, z);
    obj.rotation.y = rot;
    // pop-in animation
    obj.scale.setScalar(0.01);
    obj.userData.pop = 0;
    this.group.add(obj);
    const [hx, hy, hz, cy] = def.box;
    const colliders = def.boxes
      ? def.boxes.map(([ox, by, oz, bx, bh, bz]) => this.physics.addBox(x + ox * Math.cos(rot) + oz * Math.sin(rot), yy + by, z - ox * Math.sin(rot) + oz * Math.cos(rot), bx, bh, bz, rot))
      : [this.physics.addBox(x, yy + cy, z, hx, hy, hz, rot)];
    this.placed.push({ obj, colliders, def });
    this.onChange();
    return true;
  }

  /** placed pieces as plain data (for saving) */
  serialize() {
    return this.placed.map((p) => ({ x: +p.obj.position.x.toFixed(3), y: +p.obj.position.y.toFixed(3), z: +p.obj.position.z.toFixed(3), t: BUILDABLES.indexOf(p.def), r: +p.obj.rotation.y.toFixed(4) }));
  }

  /** turn the next piece a quarter turn (touch Rotate button / R key) */
  rotate() { this.rotation = (this.rotation + Math.PI / 2) % (Math.PI * 2); this.onChange(); }

  /** current yaw of the ghost preview (it eases toward `rotation`) */
  get previewYaw() { return this.ghostYaw; }

  /** true if there is a placed-this-session piece to take back */
  get canUndo() { return this.history.some((p) => this.placed.includes(p)); }

  /** Undo: take back the most recent piece still standing (touch Undo button / Ctrl+Z). */
  undo(): boolean {
    while (this.history.length) {
      const p = this.history.pop()!;
      if (!this.placed.includes(p)) continue;
      this.group.remove(p.obj);
      for (const c of p.colliders) this.physics.remove(c);
      this.placed = this.placed.filter((x) => x !== p);
      if (this.hoverPlaced === p) this.hoverPlaced = null;
      this.onRemove();
      this.onChange();
      return true;
    }
    return false;
  }

  /** hook: return true to take over a far remove (walk there first) */
  onFarRemove: (pos: THREE.Vector3, done: () => void) => boolean = () => false;
  removePiece(p: Placed) { if (!this.placed.includes(p)) return; this.hoverPlaced = p; this.removeHovered(true); }
  removeHovered(keep = false) {
    if (!this.active) return;
    if (!keep) this.computeTarget();
    const p = this.hoverPlaced;
    if (!p) return;
    this.group.remove(p.obj);
    for (const c of p.colliders) this.physics.remove(c);
    this.placed = this.placed.filter((x) => x !== p);
    this.onRemove();
    this.onChange();
  }

  update(dt: number) {
    // pop-in animations
    for (const p of this.placed) {
      const o = p.obj;
      if (o.userData.pop !== undefined && o.userData.pop < 1) {
        o.userData.pop = Math.min(1, o.userData.pop + dt * 4);
        const t = o.userData.pop;
        const s = 1 + Math.sin(t * Math.PI) * 0.18 * (1 - t) + (t < 1 ? -(1 - t) * (1 - t) * 0.9 : 0);
        o.scale.setScalar(Math.max(0.01, s));
      }
    }
    this.swingDoors(dt);
    if (!this.active) return;
    const i = this.input;
    for (let n = 1; n <= BUILDABLES.length; n++) if (i.pressed.has(String(n))) this.select(n - 1);
    if (i.pressed.has('r')) this.rotate();
    if (i.pressed.has('undo')) this.undo();
    if (i.pressed.has('x')) this.removeHovered();
    if (i.wheel !== 0 && i.keys.has('control')) this.select(this.selected + i.wheel);

    const ok = this.computeTarget();
    if (this.ghost) {
      this.ghost.visible = ok && !this.removeMode;
      this.ghost.position.copy(this.target);
      // ghost swings round to the new rotation so the turn is easy to see
      let dy = (BUILDABLES[this.selected].snap ? this.targetRot : this.rotation) - this.ghostYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.ghostYaw += dy * Math.min(1, dt * 14);
      this.ghost.rotation.y = this.ghostYaw;
      const valid = ok && this.isValid();
      this.ghostValid = valid;
      if (valid !== this.ghostMatState) { this.ghostMatState = valid; this.applyGhostMat(valid); }
      const bob = 1 + Math.sin(performance.now() * 0.006) * 0.02;
      this.ghost.scale.setScalar(bob);
    }
    this.cell.visible = ok;
    (this.cell.material as THREE.MeshBasicNodeMaterial).color.set(this.removeMode ? '#ff6b6b' : '#ffffff');
    this.cell.position.set(this.target.x, this.target.y + 0.03, this.target.z);
  }
}
