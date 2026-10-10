import * as THREE from 'three/webgpu';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Physics } from '../core/Physics';
import type { Input } from '../core/Input';
import type { System } from '../core/System';
import { heightAt } from '../world/Terrain';
import { mat } from '../world/Models';

const HALF_H = 0.35, RADIUS = 0.32;
const WALK = 4.2, RUN = 7, JUMP = 7.5, GRAVITY = -20;

function makeCharacter() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const shirt = mat('#ff8a65', { flat: false, rough: 0.7 });
  const skin = mat('#ffd9b8', { flat: false, rough: 0.6 });
  const dark = mat('#3a2f2a', { flat: false, rough: 0.4 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.35, 6, 14), shirt);
  torso.position.y = 0.55;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.33, 20, 16), skin);
  head.position.y = 1.18;
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.345, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), mat('#7a4a2e', { flat: false }));
  hair.position.y = 1.2; hair.rotation.x = -0.25;
  const eyeGeo = new THREE.SphereGeometry(0.045, 10, 8);
  const eyeL = new THREE.Mesh(eyeGeo, dark); eyeL.position.set(-0.11, 1.2, 0.3);
  const eyeR = eyeL.clone(); eyeR.position.x = 0.11;
  const blushGeo = new THREE.SphereGeometry(0.05, 10, 8);
  const blushM = mat('#ff9aa8', { flat: false });
  const bl = new THREE.Mesh(blushGeo, blushM); bl.scale.set(1, 0.5, 0.3); bl.position.set(-0.19, 1.1, 0.27);
  const br = bl.clone(); br.position.x = 0.19;
  // sprout on head
  const leafM = mat('#6dcc4f', { flat: false });
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.18, 6), leafM);
  stem.position.set(0, 1.58, 0);
  const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), leafM);
  leaf.scale.set(1.6, 0.35, 0.8); leaf.position.set(0.1, 1.67, 0); leaf.rotation.z = 0.4;
  // feet
  const footGeo = new THREE.SphereGeometry(0.12, 12, 8);
  const footL = new THREE.Mesh(footGeo, dark); footL.scale.set(1, 0.6, 1.4); footL.position.set(-0.14, 0.08, 0.04);
  const footR = footL.clone(); footR.position.x = 0.14;
  // backpack
  const pack = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.15, 4, 10), mat('#ffd166', { flat: false }));
  pack.position.set(0, 0.62, -0.28);
  body.add(torso, head, hair, eyeL, eyeR, bl, br, stem, leaf, pack);
  root.add(footL, footR);
  root.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  return { root, body, footL, footR };
}

export class Player implements System {
  object: THREE.Group;
  private parts: ReturnType<typeof makeCharacter>;
  private body: RAPIER.RigidBody;
  private collider: RAPIER.Collider;
  private controller: RAPIER.KinematicCharacterController;
  private vy = 0;
  private grounded = false;
  private coyote = 0;
  private jumpBuffer = 0;
  private facing = 0;
  private walkPhase = 0;
  private speedSmoothed = 0;
  cameraYaw = 0; // set by camera rig
  enabled = true;

  constructor(physics: Physics, private input: Input, spawn: THREE.Vector3) {
    const R = physics.R;
    this.parts = makeCharacter();
    this.object = this.parts.root;
    const y = heightAt(spawn.x, spawn.z) + HALF_H + RADIUS + 0.2;
    this.body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, y, spawn.z));
    this.collider = physics.world.createCollider(R.ColliderDesc.capsule(HALF_H, RADIUS), this.body);
    this.controller = physics.world.createCharacterController(0.02);
    this.controller.enableAutostep(0.45, 0.2, true);
    this.controller.enableSnapToGround(0.4);
    this.controller.setMaxSlopeClimbAngle((55 * Math.PI) / 180);
    this.controller.setSlideEnabled(true);
    this.facing = Math.PI;
  }

  get position() {
    const t = this.body.translation();
    return new THREE.Vector3(t.x, t.y - HALF_H - RADIUS, t.z);
  }

  teleport(x: number, z: number, facing?: number) {
    this.body.setTranslation({ x, y: heightAt(x, z) + HALF_H + RADIUS + 0.05, z }, true);
    this.body.setNextKinematicTranslation({ x, y: heightAt(x, z) + HALF_H + RADIUS + 0.05, z });
    if (facing !== undefined) this.facing = facing;
    this.vy = 0;
  }

  update(dt: number) {
    const k = this.input.keys;
    let fx = 0, fz = 0;
    if (this.enabled) {
      if (k.has('w') || k.has('arrowup')) fz -= 1;
      if (k.has('s') || k.has('arrowdown')) fz += 1;
      if (k.has('a') || k.has('arrowleft')) fx -= 1;
      if (k.has('d') || k.has('arrowright')) fx += 1;
    }
    const len = Math.hypot(fx, fz);
    const speed = k.has('shift') ? RUN : WALK;
    let mx = 0, mz = 0;
    if (len > 0) {
      fx /= len; fz /= len;
      const cy = Math.cos(this.cameraYaw), sy = Math.sin(this.cameraYaw);
      mx = (fx * cy + fz * sy) * speed;
      mz = (-fx * sy + fz * cy) * speed;
      const target = Math.atan2(mx, mz);
      let d = target - this.facing;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.facing += d * Math.min(1, dt * 12);
    }
    if (this.enabled && this.input.pressed.has(' ')) this.jumpBuffer = 0.15;
    this.jumpBuffer -= dt;
    this.coyote = this.grounded ? 0.12 : this.coyote - dt;
    if (this.jumpBuffer > 0 && this.coyote > 0) { this.vy = JUMP; this.grounded = false; this.coyote = 0; this.jumpBuffer = 0; }
    this.vy += GRAVITY * dt;
    if (this.vy < -30) this.vy = -30;

    const t = this.body.translation();
    // keep the player on the island: block moves into deep water
    const nx = t.x + mx * dt, nz = t.z + mz * dt;
    if (heightAt(nx, nz) < -0.45) { mx = 0; mz = 0; }

    const desired = { x: mx * dt, y: this.vy * dt, z: mz * dt };
    this.controller.computeColliderMovement(this.collider, desired);
    const mv = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.vy < 0) this.vy = 0;
    this.body.setNextKinematicTranslation({ x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z });

    // Visuals
    const p = this.position;
    this.object.position.copy(p);
    this.object.rotation.y = this.facing;
    const horiz = Math.hypot(mx, mz);
    this.speedSmoothed += (horiz - this.speedSmoothed) * Math.min(1, dt * 10);
    this.walkPhase += dt * (4 + this.speedSmoothed * 2.2);
    const amt = Math.min(1, this.speedSmoothed / WALK);
    const { body, footL, footR } = this.parts;
    body.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.08 * amt + (this.grounded ? 0 : 0.05);
    body.rotation.z = Math.sin(this.walkPhase) * 0.06 * amt;
    body.rotation.x = 0.08 * amt;
    footL.position.z = 0.04 + Math.sin(this.walkPhase) * 0.18 * amt;
    footR.position.z = 0.04 - Math.sin(this.walkPhase) * 0.18 * amt;
    footL.position.y = 0.08 + Math.max(0, Math.cos(this.walkPhase)) * 0.08 * amt;
    footR.position.y = 0.08 + Math.max(0, -Math.cos(this.walkPhase)) * 0.08 * amt;
    // idle breathing
    const breathe = 1 + Math.sin(performance.now() * 0.003) * 0.015 * (1 - amt);
    body.scale.set(1, breathe, 1);
  }
}
