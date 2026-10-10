import * as THREE from 'three/webgpu';
import type { Input } from '../core/Input';
import type { System } from '../core/System';
import type { Player } from './Player';
import { heightAt } from '../world/Terrain';

/** Third-person orbit camera: drag to orbit, wheel to zoom, Q/E to rotate. */
export class CameraRig implements System {
  yaw = 0.6;
  pitch = 0.42;
  distance = 9;
  target = new THREE.Vector3();
  sensitivity = 1;
  locked = false; // when true, screenshot/debug code drives the camera

  constructor(public camera: THREE.PerspectiveCamera, private input: Input, private player: Player) {
    this.target.copy(player.position);
  }

  update(dt: number) {
    if (this.locked) return;
    const i = this.input;
    this.yaw -= i.dragDX * 0.005 * this.sensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch + i.dragDY * 0.004 * this.sensitivity, 0.05, 1.35);
    if (i.keys.has('z')) this.yaw += dt * 1.8;
    if (i.keys.has('c')) this.yaw -= dt * 1.8;
    this.distance = THREE.MathUtils.clamp(this.distance * (1 + i.wheel * 0.1) / i.pinch, 3.5, 28);
    const p = this.player.position.add(new THREE.Vector3(0, 1.1, 0));
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
    const minY = Math.max(heightAt(pos.x, pos.z), 0) + 0.4;
    if (pos.y < minY) pos.y = minY;
    this.camera.position.copy(pos);
    this.camera.lookAt(this.target);
  }
}
