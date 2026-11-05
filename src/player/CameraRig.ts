import * as THREE from 'three/webgpu';
import type { Input } from '../core/Input';
import type { System } from '../core/System';
import type { Player } from './Player';
import { heightAt } from '../world/Terrain';

/** Third-person orbit camera: drag to orbit, wheel to zoom, Q/E to rotate. */
export interface CaveBounds { clampCamera(target: THREE.Vector3, pos: THREE.Vector3): void; }

export class CameraRig implements System {
  /** set while underground */
  cave: CaveBounds | null = null;
  /** Order 53a: set while inside a built cottage (pulls camera in, clamps to the room) */
  cottage: { cx: number; cz: number; floorY: number; half?: number } | null = null;
  yaw = 0.6;
  pitch = 0.42;
  distance = 9;
  target = new THREE.Vector3();
  sensitivity = 1;
  private pendYaw = 0;
  private pendPitch = 0;
  locked = false; // when true, screenshot/debug code drives the camera
  /** extra look-at height while riding a mount */
  mountBoost = 0;

  constructor(public camera: THREE.PerspectiveCamera, private input: Input, private player: Player) {
    this.target.copy(player.position);
  }

  update(dt: number) {
    if (this.locked) return;
    const i = this.input;
    // eased orbit: drags feed a pending amount that the camera glides through (no jitter from uneven touch events)
    this.pendYaw -= i.dragDX * 0.005 * this.sensitivity;
    this.pendPitch += i.dragDY * 0.004 * this.sensitivity;
    const k = 1 - Math.exp(-dt * 22);
    const sy = this.pendYaw * k, sp = this.pendPitch * k;
    this.pendYaw -= sy; this.pendPitch -= sp;
    this.yaw += sy;
    this.pitch = THREE.MathUtils.clamp(this.pitch + sp, 0.05, 1.35);
    if (this.pitch <= 0.05 || this.pitch >= 1.35) this.pendPitch = 0;
    if (i.keys.has('z')) this.yaw += dt * 1.8;
    if (i.keys.has('c')) this.yaw -= dt * 1.8;
    const dMin = this.cottage ? 2.6 : this.mountBoost > 0.5 ? 7 : 3.5;
    const dMax = this.cottage ? 5.2 : 28;
    this.distance = THREE.MathUtils.clamp(this.distance * (1 + i.wheel * 0.1) / i.pinch, dMin, dMax);
    if (this.mountBoost > 0.5 && this.distance < 10 && !this.cottage) this.distance += (10 - this.distance) * Math.min(1, dt * 1.5);
    // Order 53a: ease toward a cozy interior framing (close, slightly pitched down into the room)
    if (this.cottage) {
      this.distance += (3.8 - this.distance) * Math.min(1, dt * 3.2);
      const wantP = Math.max(0.48, Math.min(this.pitch, 0.95));
      this.pitch += (wantP - this.pitch) * Math.min(1, dt * 2.4);
    }
    const p = this.player.position.add(new THREE.Vector3(0, 1.1 + this.mountBoost, 0));
    this.target.lerp(p, Math.min(1, dt * 8));
    this.apply();
    this.player.cameraYaw = this.yaw;
  }

  apply() {
    const cp = Math.cos(this.pitch);
    const pos = new THREE.Vector3(
      this.target.x + Math.sin(this.yaw) * cp * this.distance,
      this.target.y + Math.sin(this.pitch) * this.distance,
      this.target.z + Math.cos(this.yaw) * cp * this.distance,
    );
    if (this.cave) {
      // underground: closer, and never through the ceiling or the walls
      const lim = Math.min(this.distance, 4.6), d = pos.clone().sub(this.target).setLength(lim);
      pos.copy(this.target).add(d);
      this.cave.clampCamera(this.target, pos);
    } else if (this.cottage) {
      // inside a cottage: keep the camera in the room volume (roof is hidden)
      const half = this.cottage.half ?? 1.05;
      const lim = Math.min(this.distance, 4.4), d = pos.clone().sub(this.target).setLength(lim);
      pos.copy(this.target).add(d);
      pos.x = THREE.MathUtils.clamp(pos.x, this.cottage.cx - half, this.cottage.cx + half);
      pos.z = THREE.MathUtils.clamp(pos.z, this.cottage.cz - half, this.cottage.cz + half);
      const lo = this.cottage.floorY + 0.55, hi = this.cottage.floorY + 2.55;
      pos.y = THREE.MathUtils.clamp(pos.y, lo, hi);
    } else {
      const minY = Math.max(heightAt(pos.x, pos.z) + 0.4, 0.75); // stays above the swell
      if (pos.y < minY) pos.y = minY;
    }
    this.camera.position.copy(pos);
    this.camera.lookAt(this.target);
  }
}
