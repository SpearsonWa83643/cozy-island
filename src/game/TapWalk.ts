import * as THREE from 'three/webgpu';
import { heightAt, WATER_LEVEL } from '../world/Terrain';
import type { Player } from '../player/Player';

/** what a tap asked for: a spot on the ground, or an interactable to walk to and use */
export interface WalkGoal {
  /** current world position of the goal (animals move, so it's a getter) */
  pos: () => { x: number; z: number };
  /** stop this close (m) */
  reach: number;
  /** target key we expect to be able to act on at arrival ('' = just walk) */
  key: string;
  /** called on arrival; return false if the target wasn't there any more */
  arrive?: () => void;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Tap / click to walk: steers the character toward a goal (straight line, Rapier slides along small obstacles,
 * and a cheap left/right detour kicks in when progress stalls). Shows a soft ground marker at the destination.
 * Any manual input cancels it.
 */
export class TapWalk {
  goal: WalkGoal | null = null;
  marker = new THREE.Group();
  private ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicNodeMaterial>;
  private dot: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicNodeMaterial>;
  private mt = 1; // marker animation 0..1 (spawn), then fades
  private fade = 0;
  private t = 0;
  private stall = 0; private lastD = 0; private detour = 0; private detourSign = 1; private detours = 0;
  private elapsed = 0;
  /** walks completed / cancelled (tests) */
  stats = { done: 0, cancelled: 0 };
  onGiveUp: () => void = () => {};

  constructor(private player: Player) {
    const mat = (o: number) => new THREE.MeshBasicNodeMaterial({ color: '#fff6dc', transparent: true, opacity: o, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.46, 32).rotateX(-Math.PI / 2), mat(0.85));
    this.dot = new THREE.Mesh(new THREE.CircleGeometry(0.12, 20).rotateX(-Math.PI / 2), mat(0.9));
    this.marker.add(this.ring, this.dot);
    this.marker.visible = false; this.marker.renderOrder = 4;
    this.ring.renderOrder = this.dot.renderOrder = 4;
  }

  go(goal: WalkGoal, showMarker = true) {
    this.goal = goal; this.stall = 0; this.detour = 0; this.detours = 0; this.elapsed = 0;
    const p = goal.pos(), pl = this.player.position;
    this.lastD = Math.hypot(p.x - pl.x, p.z - pl.z);
    if (showMarker) { this.mt = 0; this.fade = 0; this.marker.visible = true; this.placeMarker(p.x, p.z); }
  }
  cancel(counted = true) {
    if (this.goal && counted) this.stats.cancelled++;
    this.goal = null; this.player.autoDir = null; this.fade = Math.max(this.fade, 0.001);
  }
  get active() { return !!this.goal; }

  private placeMarker(x: number, z: number) { this.marker.position.set(x, Math.max(heightAt(x, z), WATER_LEVEL + 0.06) + 0.05, z); }

  update(dt: number) {
    this.t += dt;
    const pl = this.player;
    // marker: pop in, gentle breathing, fade out once we're done
    if (this.marker.visible) {
      this.mt = Math.min(1, this.mt + dt / 0.35);
      if (!this.goal) this.fade = Math.min(1, this.fade + dt / 0.4);
      const a = (1 - this.fade) * easeOut(this.mt);
      const k = easeOut(this.mt) * (1 + Math.sin(this.t * 5) * 0.06);
      this.ring.scale.setScalar(k * (1.5 - 0.5 * easeOut(this.mt))); this.dot.scale.setScalar(k);
      this.ring.material.opacity = 0.85 * a; this.dot.material.opacity = 0.9 * a;
      if (this.goal) { const g = this.goal.pos(); this.placeMarker(g.x, g.z); }
      if (this.fade >= 1) this.marker.visible = false;
    }
    const g = this.goal;
    if (!g) return;
    if (pl.manual) { this.cancel(); return; }
    this.elapsed += dt;
    const p = g.pos(), me = pl.position;
    let dx = p.x - me.x, dz = p.z - me.z;
    const d = Math.hypot(dx, dz);
    if (d <= g.reach) {
      pl.autoDir = null; this.goal = null; this.stats.done++;
      g.arrive?.();
      return;
    }
    if (this.elapsed > 18) { this.cancel(); this.onGiveUp(); return; }
    // stall detection → detour sideways for a moment (cheap obstacle steering)
    this.stall += dt;
    if (this.stall > 0.6) {
      if (this.lastD - d < 0.25 && this.detour <= 0) {
        this.detours++; this.detourSign = -this.detourSign; this.detour = 0.8;
        if (this.detours > 6) { this.cancel(); this.onGiveUp(); return; }
      }
      this.lastD = d; this.stall = 0;
    }
    dx /= d; dz /= d;
    if (this.detour > 0) {
      this.detour -= dt;
      const a = this.detourSign * 1.2, c = Math.cos(a), s = Math.sin(a);
      [dx, dz] = [dx * c - dz * s, dx * s + dz * c];
    }
    // ease in on arrival
    pl.autoDir = { x: dx, z: dz, s: Math.min(1, 0.45 + (d - g.reach) * 0.6) };
  }
}
