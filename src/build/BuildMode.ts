import * as THREE from 'three/webgpu';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Physics } from '../core/Physics';
import type { Input } from '../core/Input';
import type { System } from '../core/System';
import { heightAt } from '../world/Terrain';
import { makeBlock, makeFence, makeFlowerPot, makeLamp, makeRoundTree } from '../world/Models';
import { mulberry32 } from '../world/noise';

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
];

interface Placed { obj: THREE.Object3D; collider: RAPIER.Collider; def: Buildable; }

export class BuildMode implements System {
  active = false;
  selected = 0;
  rotation = 0;
  group = new THREE.Group();
  private ghost: THREE.Object3D | null = null;
  private ghostValid = false;
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

  constructor(private scene: THREE.Scene, private camera: THREE.Camera, private terrain: THREE.Mesh,
    private physics: Physics, private input: Input, private playerPos: () => THREE.Vector3) {
    scene.add(this.group);
    this.cell.visible = false;
    this.cell.renderOrder = 5;
    scene.add(this.cell);
    input.onClick.push((e, drag) => {
      if (!this.active || drag) return;
      if (e.button === 0) this.place();
      else if (e.button === 2) this.removeHovered();
    });
  }

  get count() { return this.placed.length; }

  toggle(on = !this.active) {
    this.active = on;
    this.cell.visible = on;
    if (!on && this.ghost) { this.scene.remove(this.ghost); this.ghost = null; }
    if (on) this.rebuildGhost();
    this.onChange();
  }

  select(i: number) {
    this.selected = (i + BUILDABLES.length) % BUILDABLES.length;
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
    const hits = this.raycaster.intersectObjects([this.terrain, this.group], true);
    this.hoverPlaced = null;
    if (!hits.length) return false;
    const hit = hits[0];
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
    return this.placeAt(this.target.x, this.target.z, this.selected, this.rotation, this.target.y);
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

  removeHovered() {
    if (!this.active) return;
    this.computeTarget();
    const p = this.hoverPlaced;
    if (!p) return;
    this.group.remove(p.obj);
    this.physics.remove(p.collider);
    this.placed = this.placed.filter((x) => x !== p);
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
      this.ghost.visible = ok;
      this.ghost.position.copy(this.target);
      this.ghost.rotation.y = this.rotation;
      const valid = ok && this.isValid();
      if (valid !== this.ghostValid) { this.ghostValid = valid; this.applyGhostMat(valid); }
      const bob = 1 + Math.sin(performance.now() * 0.006) * 0.02;
      this.ghost.scale.setScalar(bob);
    }
    this.cell.visible = ok;
    this.cell.position.set(this.target.x, this.target.y + 0.03, this.target.z);
  }
}
