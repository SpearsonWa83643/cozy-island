import * as THREE from 'three/webgpu';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Physics } from '../core/Physics';
import type { Input } from '../core/Input';
import type { System } from '../core/System';
import { heightAt, type Terrain } from '../world/Terrain';
import { makeBlock, makeFence, makeFlowerPot, makeLamp, makeRoundTree } from '../world/Models';
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
];
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

interface Placed { obj: THREE.Object3D; collider: RAPIER.Collider; def: Buildable; }

export class BuildMode implements System {
  active = false;
  /** touch: taps remove instead of place */
  removeMode = false;
  selected = 0;
  rotation = 0;
  group = new THREE.Group();
  private ghost: THREE.Object3D | null = null;
  private ghostValid = false;
  private ghostMatState = true;
  private cell = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicNodeMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false }),
  );
  private ghostMatOk = new THREE.MeshStandardNodeMaterial({ color: '#9effa8', transparent: true, opacity: 0.55, emissive: '#3aff6a', emissiveIntensity: 0.35, depthWrite: false });
  private ghostMatBad = new THREE.MeshStandardNodeMaterial({ color: '#ff8a8a', transparent: true, opacity: 0.55, emissive: '#ff3a3a', emissiveIntensity: 0.35, depthWrite: false });
  private placed: Placed[] = [];
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
    const x = Math.round(p.x), z = Math.round(p.z);
    // sit on lowest-cost ground: average of cell corners so blocks don't float
    const h = Math.min(heightAt(x - 0.4, z - 0.4), heightAt(x + 0.4, z - 0.4), heightAt(x - 0.4, z + 0.4), heightAt(x + 0.4, z + 0.4), heightAt(x, z));
    this.target.set(x, h, z);
    return true;
  }

  private findPlaced(o: THREE.Object3D | null): Placed | null {
    while (o) {
      const p = this.placed.find((pl) => pl.obj === o);
      if (p) return p;
      o = o.parent;
    }
    return null;
  }

  private isValid(): boolean {
    const t = this.target;
    if (heightAt(t.x, t.z) < 0.15) return false; // no building in the sea
    if (t.y > 12) return false;
    const pp = this.playerPos();
    if (Math.hypot(pp.x - t.x, pp.z - t.z) < 0.7 && Math.abs(pp.y - t.y) < 1.5) return false;
    // occupied cell at same level?
    return !this.placed.some((p) => Math.abs(p.obj.position.x - t.x) < 0.01 && Math.abs(p.obj.position.z - t.z) < 0.01
      && Math.abs(p.obj.position.y - t.y) < 0.5);
  }

  place(): boolean {
    if (!this.active || !this.ghostValid) return false;
    const ok = this.placeAt(this.target.x, this.target.z, this.selected, this.rotation, this.target.y);
    if (ok) this.onPlace(this.selected);
    return ok;
  }

  placeAt(x: number, z: number, type: number, rot = 0, y?: number): boolean {
    const def = BUILDABLES[type];
    const obj = def.make();
    const yy = y ?? Math.min(heightAt(x - 0.4, z - 0.4), heightAt(x + 0.4, z + 0.4), heightAt(x + 0.4, z - 0.4), heightAt(x - 0.4, z + 0.4));
    obj.position.set(x, yy, z);
    obj.rotation.y = rot;
    // pop-in animation
    obj.scale.setScalar(0.01);
    obj.userData.pop = 0;
    this.group.add(obj);
    const [hx, hy, hz, cy] = def.box;
    const collider = this.physics.addBox(x, yy + cy, z, hx, hy, hz, rot);
    this.placed.push({ obj, collider, def });
    this.onChange();
    return true;
  }

  /** placed pieces as plain data (for saving) */
  serialize() {
    return this.placed.map((p) => ({ x: +p.obj.position.x.toFixed(3), y: +p.obj.position.y.toFixed(3), z: +p.obj.position.z.toFixed(3), t: BUILDABLES.indexOf(p.def), r: +p.obj.rotation.y.toFixed(4) }));
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
    this.physics.remove(p.collider);
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
    if (!this.active) return;
    const i = this.input;
    for (let n = 1; n <= BUILDABLES.length; n++) if (i.pressed.has(String(n))) this.select(n - 1);
    if (i.pressed.has('r')) { this.rotation += Math.PI / 2; }
    if (i.pressed.has('x')) this.removeHovered();
    if (i.wheel !== 0 && i.keys.has('control')) this.select(this.selected + i.wheel);

    const ok = this.computeTarget();
    if (this.ghost) {
      this.ghost.visible = ok && !this.removeMode;
      this.ghost.position.copy(this.target);
      this.ghost.rotation.y = this.rotation;
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
