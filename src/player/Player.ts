import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type RAPIER from '@dimforge/rapier3d';
import type { Physics } from '../core/Physics';
import type { Input } from '../core/Input';
import type { System } from '../core/System';
import { heightAt, WATER_LEVEL } from '../world/Terrain';
import { SWIM_SOFT, SWIM_MAX, nearestLand } from '../world/Shore';
const LAND = { off: 0, cx: 0, cz: 0, islet: -1 };
import { Baker } from '../world/Baker';
import { mat } from '../world/Models';
import { Outfit, type Sockets } from './Wearables';

const HALF_H = 0.35, RADIUS = 0.32;
const WALK = 4.2, RUN = 7, JUMP = 7.5, GRAVITY = -20;
const SWIM = 2.5, SWIM_FAST = 3.6;
/** feet height while floating: head and shoulders stay above the surface */
const FLOAT_FEET = WATER_LEVEL - 0.8;
const SWIM_IN = 0.95, SWIM_OUT = 0.82; // ground depth thresholds (hysteresis)
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const sph = (r: number, w = 10, h = 8) => new THREE.SphereGeometry(r, w, h);

/** One shoe: the same dark oval, with a lighter sole, a folded sock and a small strap. */
function makeFoot(material: THREE.Material) {
  const b = new Baker();
  b.ao = false;
  b.add(sph(0.12, 12, 8), '#3a2f2a', [0, 0, 0], [0, 0, 0], [1, 0.6, 1.4]);
  b.add(sph(0.1, 8, 6), '#6a5144', [0, -0.048, 0.02], [0, 0, 0], [1.02, 0.26, 1.28]);
  b.add(sph(0.055, 8, 6), '#f3eee4', [0, 0.02, 0.1], [0, 0, 0], [1.15, 0.42, 0.48]);
  b.add(new THREE.BoxGeometry(0.08, 0.012, 0.018), '#2c241f', [0, 0.028, 0.12]);
  const mesh = new THREE.Mesh(b.build(), material);
  mesh.name = 'foot';
  const g = new THREE.Group();
  g.add(mesh);
  return g;
}

/**
 * Same cozy capsule proportions and palette, with a few readable bits of clothing and a face.
 * Shirt sleeves share the dye texture. Cuffs and the hem stay a warm cream so seams read on every dye.
 * Extra parts are merged so the character is fewer draw calls than the plain capsule.
 */
function makeCharacter() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const shirt = new THREE.MeshStandardNodeMaterial({ color: '#ffffff', roughness: 0.7 });
  const skinMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.6 });
  const eyeMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.4 });
  const clothMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.74 });
  const footMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.55 });

  const torsoGeo = new THREE.CapsuleGeometry(0.3, 0.35, 6, 14);
  torsoGeo.translate(0, 0.55, 0);
  const sleeve = (s: number) => {
    const g = sph(0.118, 10, 8);
    g.scale(0.92, 0.8, 0.86);
    g.translate(s * 0.3, 0.64, 0.02);
    return g;
  };
  const shirtGeo = mergeGeometries([torsoGeo, sleeve(-1), sleeve(1)]);
  if (!shirtGeo) throw new Error('shirt merge failed');
  const torso = new THREE.Mesh(shirtGeo, shirt);
  torso.name = 'shirt';

  const skinB = new Baker();
  skinB.ao = false;
  skinB.add(sph(0.33, 20, 16), '#ffd9b8', [0, 1.18, 0]);
  for (const s of [-1, 1]) {
    skinB.add(sph(0.05, 10, 8), '#ff9aa8', [s * 0.19, 1.1, 0.27], [0, 0, 0], [1, 0.5, 0.3]);
    skinB.add(sph(0.055, 8, 6), '#ffd9b8', [s * 0.355, 0.525, 0.065], [0, 0, 0], [0.95, 0.88, 0.9]);
  }
  skinB.add(new THREE.TorusGeometry(0.046, 0.009, 5, 12, Math.PI * 0.9), '#e08b7c', [0, 1.072, 0.302], [0.2, 0, Math.PI]);
  const skin = new THREE.Mesh(skinB.build(), skinMat);
  skin.name = 'skin';

  const eyeB = new Baker();
  eyeB.ao = false;
  for (const s of [-1, 1]) {
    eyeB.add(sph(0.045, 10, 8), '#3a2f2a', [s * 0.11, 1.2, 0.3]);
    eyeB.add(sph(0.014, 6, 5), '#fffdf8', [s * 0.124, 1.216, 0.337]);
  }
  const eyes = new THREE.Mesh(eyeB.build(), eyeMat);
  eyes.name = 'eyes';

  // Same bowl cut. Fringe and cheek locks are on this mesh so covering hats still hide them.
  const cap = new THREE.SphereGeometry(0.345, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
  cap.applyMatrix4(new THREE.Matrix4().makeRotationX(-0.25));
  cap.translate(0, 1.2, 0);
  const fringe = (x: number, y: number, z: number, sx: number) => {
    const g = sph(0.048, 8, 6);
    g.scale(sx, 0.62, 0.7);
    g.translate(x, y, z);
    return g;
  };
  const lock = (s: number) => {
    const g = sph(0.075, 8, 6);
    g.scale(0.7, 1.15, 0.62);
    g.translate(s * 0.31, 1.1, 0.16);
    return g;
  };
  const hairGeo = mergeGeometries([
    cap,
    fringe(0, 1.255, 0.34, 1.45),
    fringe(-0.09, 1.275, 0.33, 1.05),
    fringe(0.09, 1.275, 0.33, 1.05),
    lock(-1), lock(1),
  ]);
  if (!hairGeo) throw new Error('hair merge failed');
  const hair = new THREE.Mesh(hairGeo, mat('#7a4a2e', { flat: false }));
  hair.name = 'hair';

  // No separate collar: the head sits on the shirt, and a light band there reads as teeth.
  // Hem and cuffs carry the layered-clothing read instead.
  const trimB = new Baker();
  trimB.ao = false;
  trimB.add(new THREE.TorusGeometry(0.27, 0.018, 5, 16), '#e7d3bf', [0, 0.19, 0], [Math.PI / 2, 0, 0]);
  for (const s of [-1, 1]) trimB.add(sph(0.046, 8, 6), '#f4eee6', [s * 0.342, 0.575, 0.05], [0, 0, 0], [1.2, 0.42, 0.95]);
  const trim = new THREE.Mesh(trimB.build(), clothMat);
  trim.name = 'trim';

  const sock = () => new THREE.Group();
  const hatS = sock(), faceS = sock(), sproutS = sock(), neckS = sock(), backS = sock();
  for (const s of [hatS, faceS, sproutS]) s.position.y = 1.18;
  neckS.position.y = 0.9; backS.position.set(0, 0.62, -0.3);
  const footL = makeFoot(footMat);
  footL.position.set(-0.14, 0.08, 0.04);
  const footR = footL.clone();
  footR.position.x = 0.14;
  body.add(torso, skin, eyes, hair, trim, hatS, faceS, sproutS, neckS, backS);
  root.add(footL, footR);
  root.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  const sockets: Sockets = { hat: hatS, face: faceS, neck: neckS, back: backS, sprout: sproutS, torso, hair };
  return { root, body, footL, footR, sockets };
}

export class Player implements System {
  object: THREE.Group;
  outfit: Outfit;
  /** when set (wardrobe preview), the character faces this yaw instead of its movement */
  previewYaw: number | null = null;
  private t = 0;
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
  onStep: (pos: THREE.Vector3, run: boolean) => void = () => {};
  onJump: () => void = () => {};
  onLand: (pos: THREE.Vector3, impact: number) => void = () => {};
  private lastStepSign = 1;
  private airVy = 0;
  /** swimming state + 0..1 blend for the animation */
  swimming = false;
  /** soaking in a hot spring (Order 46a): the body sinks down so you sit in the water */
  soaking = false; soakBlend = 0;
  /** solid props in the water (shipwreck hull) where the shoreline anti-stuck hop must not push you through */
  solidNear: ((x: number, z: number) => boolean) | null = null;
  swimBlend = 0;
  /** 0..1 how hard the current is pulling (UI stamina ring) */
  current = 0;
  /** metres past the shoreline */
  offshoreDist = 0;
  /** water depth at the player's feet column (ground below surface) */
  depth = 0;
  onSwimStart: (pos: THREE.Vector3) => void = () => {};
  onSwimEnd: (pos: THREE.Vector3) => void = () => {};
  onStroke: (pos: THREE.Vector3, moving: number) => void = () => {};
  private stuckT = 0;
  /** tap-to-walk steering (world-space unit dir + speed scale), set by TapWalk each frame */
  autoDir: { x: number; z: number; s: number } | null = null;
  /** true while keys / joystick are driving (cancels tap-to-walk) */
  manual = false;
  /** ground height function (the cave swaps this for its floor) */
  ground: (x: number, z: number) => number = heightAt;
  /** underground: no water, no current, no shoreline watchdog */
  inCave = false;
  /** riding a mount: movement is driven by Mount */
  mounted = false;
  /** times the anti-stuck nudge fired (tests) */
  unstuckCount = 0;
  private strokePhase = 0;

  constructor(physics: Physics, private input: Input, spawn: THREE.Vector3) {
    const R = physics.R;
    this.parts = makeCharacter();
    this.object = this.parts.root;
    this.outfit = new Outfit(this.parts.sockets);
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

  /** brief squash-and-stretch hop of joy (feeding, chest) */
  cheer() { this.cheerT = 0.6; }
  private cheerT = 0;
  get facingYaw() { return this.facing; }
  get speed() { return this.speedSmoothed; }

  get position() {
    const t = this.body.translation();
    return new THREE.Vector3(t.x, t.y - HALF_H - RADIUS, t.z);
  }

  /** place the kinematic body at feet height y without ground-snapping (mount seating) */
  snapBody(x: number, y: number, z: number, facing?: number) {
    const p = { x, y: y + HALF_H + RADIUS, z };
    this.body.setTranslation(p, true);
    this.body.setNextKinematicTranslation(p);
    if (facing !== undefined) this.facing = facing;
    this.vy = 0; this.swimming = false; this.swimBlend = 0; this.speedSmoothed = 0;
  }
  /** back on your feet after a ride: legs and lean back to normal */
  unseat() {
    const { footL, footR, body } = this.parts;
    footL.position.set(-0.14, 0.08, 0.04); footR.position.set(0.14, 0.08, 0.04);
    body.rotation.set(0, 0, 0); body.position.y = 0;
    this.object.rotation.set(0, this.facing, 0);
    this.grounded = false; this.airVy = 0; this.vy = 0;
  }

  /** turn to face a yaw without moving (fishing casts, Order 52a) */
  face(yaw: number) { this.facing = yaw; }
  /** move to (x, z); `feetY` stands you on something that isn't terrain (a dock deck, Order 51b) */
  teleport(x: number, z: number, facing?: number, feetY?: number) {
    const g = this.ground(x, z), deep = !this.inCave && WATER_LEVEL - g > SWIM_IN;
    const y = (feetY !== undefined ? feetY + 0.05 : deep ? FLOAT_FEET : g + 0.05) + HALF_H + RADIUS;
    if (feetY !== undefined) this.swimming = false;
    this.body.setTranslation({ x, y, z }, true);
    this.body.setNextKinematicTranslation({ x, y, z });
    if (facing !== undefined) this.facing = facing;
    this.vy = 0;
  }

  update(dt: number) {
    if (this.mounted) {
      // Mount seats the mesh; keep a soft idle breathe so the rider feels alive
      this.t += dt; this.outfit.update(this.t);
      const breathe = 1 + Math.sin(performance.now() * 0.003) * 0.015;
      const { body, footL, footR } = this.parts;
      body.scale.set(1, breathe, 1);
      body.position.y = -0.1 + Math.sin(this.t * 2.6) * 0.012; // settled into the feathers
      body.rotation.set(0.14, 0, 0); // lean into the wind
      // legs astride the eagle's back, dangling a little
      const sw = Math.sin(this.t * 2.2) * 0.03;
      footL.position.set(-0.36, 0.06 + sw, 0.12); footR.position.set(0.36, 0.06 - sw, 0.12);
      return;
    }
    const k = this.input.keys;
    let fx = 0, fz = 0;
    if (this.enabled) {
      if (k.has('w') || k.has('arrowup')) fz -= 1;
      if (k.has('s') || k.has('arrowdown')) fz += 1;
      if (k.has('a') || k.has('arrowleft')) fx -= 1;
      if (k.has('d') || k.has('arrowright')) fx += 1;
    }
    // analog virtual joystick (touch): pushing to the rim breaks into a jog
    let analog = 1;
    const st = this.input.stick;
    const sm = Math.hypot(st.x, st.y);
    if (this.enabled && sm > 0.08 && fx === 0 && fz === 0) {
      fx = st.x; fz = st.y;
      analog = Math.min(1, sm) < 0.9 ? Math.min(1, sm / 0.9) : 1 + (RUN / WALK - 1) * 0.8;
    }
    const len = Math.hypot(fx, fz);
    const t0 = this.body.translation();
    const ground = this.ground(t0.x, t0.z);
    this.depth = this.inCave ? -10 : WATER_LEVEL - ground;
    if (!this.swimming && this.depth > SWIM_IN && t0.y - HALF_H - RADIUS < FLOAT_FEET + 0.35) { this.swimming = true; this.vy = 0; this.onSwimStart(this.position); }
    else if (this.swimming && this.depth < SWIM_OUT) { this.swimming = false; this.onSwimEnd(this.position); }
    // wading slows you a little; swimming is calmer still
    const wade = 1 - smooth(0.15, SWIM_IN, this.depth) * 0.35;
    const fast = k.has('shift') || analog > 1;
    const speed = this.swimming ? (fast ? SWIM_FAST : SWIM) * Math.min(1, analog) : (k.has('shift') ? RUN : WALK) * analog * wade;
    let mx = 0, mz = 0;
    this.manual = len > 0;
    if (len === 0 && this.autoDir && this.enabled) {
      const a = this.autoDir, sp = (this.swimming ? SWIM : WALK) * a.s * (this.swimming ? 1 : wade);
      mx = a.x * sp; mz = a.z * sp;
      let d = Math.atan2(a.x, a.z) - this.facing; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.facing += d * Math.min(1, dt * 10);
    }
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
    if (this.swimming) { this.coyote = 0; this.jumpBuffer = 0; }
    if (this.jumpBuffer > 0 && this.coyote > 0) { this.vy = JUMP; this.grounded = false; this.coyote = 0; this.jumpBuffer = 0; this.onJump(); }
    const t = this.body.translation();
    const feet = t.y - HALF_H - RADIUS;
    // soft swim boundary: past SWIM_SOFT a gentle current carries you back toward the beach (no invisible wall)
    // nearest landmass (main island or an archipelago islet, Order 42a): the current carries you back to *that* beach
    const land = this.depth > 0.2 && !this.inCave ? nearestLand(t.x, t.z, LAND) : null;
    this.offshoreDist = land ? land.off : -1;
    this.current = smooth(SWIM_SOFT, SWIM_MAX, this.offshoreDist);
    if (this.current > 0 && land) {
      const rx = t.x - land.cx, rz = t.z - land.cz, r = Math.hypot(rx, rz) || 1, push = this.current * 3.4 + smooth(SWIM_MAX, SWIM_MAX + 5, this.offshoreDist) * 6;
      mx -= (rx / r) * push; mz -= (rz / r) * push;
    }
    if (this.swimming) {
      // buoyancy: ease the feet toward the float line with a gentle bob
      const bob = Math.sin(this.t * 2.2) * 0.04;
      this.vy = (FLOAT_FEET + bob - feet) * 5;
    } else {
      this.vy += GRAVITY * dt;
      if (this.vy < -30) this.vy = -30;
      // never sink below the float line in deep water (e.g. jumping off a rock into the sea)
      if (this.depth > SWIM_IN && feet < FLOAT_FEET && this.vy < 0) this.vy *= 0.5;
    }

    const desired = { x: mx * dt, y: this.vy * dt, z: mz * dt };
    this.controller.computeColliderMovement(this.collider, desired);
    const mv = this.controller.computedMovement();
    const wasGrounded = this.grounded;
    this.grounded = this.controller.computedGrounded();
    if (!wasGrounded && this.grounded && this.airVy < -4) this.onLand(this.position, -this.airVy);
    if (!this.grounded) this.airVy = this.vy;
    if (this.grounded && this.vy < 0) this.vy = 0;
    let nx = t.x + mv.x, ny = t.y + mv.y, nz = t.z + mv.z;
    // anti-stuck: wanted to move but barely did for a while (wedged at the shoreline, a rock, a follower)
    const want = Math.hypot(desired.x, desired.z), got = Math.hypot(mv.x, mv.z);
    // (only around the waterline, so walls and placed blocks stay solid)
    if (len > 0 && want > 0.01 && got < want * 0.15 && this.depth > -0.35 && !this.solidNear?.(t.x, t.z)) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt * 2);
    if (this.stuckT > 0.8) {
      this.stuckT = 0;
      // free the capsule: a small hop along the wished direction, biased toward the beach, never below ground or the float line
      const r = Math.hypot(nx, nz) || 1, ml = Math.hypot(mx, mz) || 1;
      nx += (mx / ml) * 0.3 - (nx / r) * 0.25; nz += (mz / ml) * 0.3 - (nz / r) * 0.25;
      const feetY = Math.max(this.ground(nx, nz) + 0.05, this.depth > SWIM_IN ? FLOAT_FEET : -99, ny - HALF_H - RADIUS);
      ny = feetY + HALF_H + RADIUS + 0.1;
      this.body.setTranslation({ x: nx, y: ny, z: nz }, true);
      this.unstuckCount++;
    }
    // safety net: fell through the ground somehow
    const gy = this.ground(nx, nz);
    if (ny - HALF_H - RADIUS < gy - 0.5) ny = gy + HALF_H + RADIUS + 0.05;
    this.body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });

    // Visuals
    const p = this.position;
    this.object.position.copy(p);
    this.object.rotation.y = this.previewYaw ?? this.facing;
    this.t += dt; this.outfit.update(this.t);
    const horiz = Math.hypot(mx, mz);
    this.speedSmoothed += (horiz - this.speedSmoothed) * Math.min(1, dt * 10);
    this.walkPhase += dt * (4 + this.speedSmoothed * 2.2);
    const amt = Math.min(1, this.speedSmoothed / WALK);
    const sgn = Math.sin(this.walkPhase) >= 0 ? 1 : -1;
    if (sgn !== this.lastStepSign) { this.lastStepSign = sgn; if (this.grounded && !this.swimming && horiz > 0.8) this.onStep(p, horiz > WALK * 1.2); }
    const { body, footL, footR } = this.parts;
    this.swimBlend += ((this.swimming ? 1 : 0) - this.swimBlend) * Math.min(1, dt * 5);
    if (this.swimBlend > 0.02) {
      // breaststroke-ish paddle: lean forward, bob, kicking feet, a stroke sound every half cycle
      const mov = Math.min(1, this.speedSmoothed / SWIM);
      this.strokePhase += dt * (2.4 + mov * 3.2);
      const s = this.swimBlend, sp = this.strokePhase;
      const prev = Math.sin(sp - dt * (2.4 + mov * 3.2)), now = Math.sin(sp);
      if (this.swimming && prev < 0 && now >= 0) this.onStroke(p, mov);
      body.position.y = (Math.sin(sp * 2) * 0.035 - 0.04) * s;
      body.rotation.x = (0.32 + mov * 0.18) * s;
      body.rotation.z = Math.sin(sp) * 0.07 * s;
      footL.position.set(-0.14, 0.08 + (0.22 + Math.sin(sp * 2.2) * 0.07) * s, 0.04 - (0.32 - Math.sin(sp * 2.2) * 0.1) * s);
      footR.position.set(0.14, 0.08 + (0.22 - Math.sin(sp * 2.2) * 0.07) * s, 0.04 - (0.32 + Math.sin(sp * 2.2) * 0.1) * s);
      if (s > 0.5) { body.scale.set(1, 1, 1); return; }
    }
    body.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.08 * amt + (this.grounded ? 0 : 0.05);
    body.rotation.z = Math.sin(this.walkPhase) * 0.06 * amt;
    body.rotation.x = 0.08 * amt;
    footL.position.z = 0.04 + Math.sin(this.walkPhase) * 0.18 * amt;
    footR.position.z = 0.04 - Math.sin(this.walkPhase) * 0.18 * amt;
    footL.position.y = 0.08 + Math.max(0, Math.cos(this.walkPhase)) * 0.08 * amt;
    footR.position.y = 0.08 + Math.max(0, -Math.cos(this.walkPhase)) * 0.08 * amt;
    this.soakBlend += ((this.soaking ? 1 : 0) - this.soakBlend) * Math.min(1, dt * 4);
    if (this.soakBlend > 0.01) { body.position.y -= 0.42 * this.soakBlend; footL.position.y -= 0.3 * this.soakBlend; footR.position.y -= 0.3 * this.soakBlend; }
    // idle breathing
    const breathe = 1 + Math.sin(performance.now() * 0.003) * 0.015 * (1 - amt);
    if (this.cheerT > 0) {
      this.cheerT -= dt;
      const k = 1 - this.cheerT / 0.6, j = Math.sin(k * Math.PI);
      body.position.y += j * 0.35;
      body.scale.set(1 - j * 0.08, breathe + j * 0.14, 1 - j * 0.08);
    } else body.scale.set(1, breathe, 1);
  }
}
