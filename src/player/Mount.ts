import * as THREE from 'three/webgpu';
import type { System } from '../core/System';
import type { Input } from '../core/Input';
import type { Player } from './Player';
import type { CameraRig } from './CameraRig';
import { heightAt, WATER_LEVEL } from '../world/Terrain';
import { offshore, SWIM_MAX } from '../world/Shore';

/**
 * Mounts (v1: the default bald eagle). Adapted from 2D Master's eagle (src/mount/mount.ts):
 * Call Mount → the eagle swoops in on a Hermite curve and hovers beside you → Hop on (button / tap the eagle / V)
 * → fly with the same joystick / WASD (Shift or stick rim = faster, Space = big flap up, tap the ground = glide there)
 * → Land (button / V) sets you down and the eagle soars away. Never underground: entering the cave or build mode lands you.
 */
export type MountPhase = 'off' | 'arrive' | 'wait' | 'hop' | 'ride' | 'leave';
export type MountId = 'eagle';
export const MOUNTS: Record<MountId, { name: string; icon: string }> = { eagle: { name: 'Bald Eagle', icon: '🦅' } };

const RIDE_ALT = 5.6;      // metres above ground / sea while flying
const WAIT_ALT = 1.05;     // hover height beside you while it waits
const FLY_SPEED = 9;
const FLY_FAST = 14;
const ARRIVE_T = 1.7;
const LEAVE_T = 1.7;
const HOP_T = 0.42;
const WAIT_MAX = 30;       // seconds it waits before flying off
const SCALE = 1.55;
/** seat on the eagle's back, in eagle (body) space */
const SEAT = new THREE.Vector3(0, 0.36, -0.02);

function hermite(p0: number, v0: number, p1: number, v1: number, t: number) {
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * v0 + (-2 * t3 + 3 * t2) * p1 + (t3 - t2) * v1;
}
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
type Seg = { x0: number; z0: number; y0: number; vx0: number; vz0: number; x1: number; z1: number; y1: number; vx1: number; vz1: number; T: number; ease: (t: number) => number };

export interface MountHooks {
  /** true when calling is not allowed right now (build mode, friend screen, wardrobe, cave fade…) */
  blocked: () => boolean;
  /** true when a ride must end now (build mode opened, cave) */
  mustLand: () => boolean;
  toast: (html: string, ms?: number) => void;
  sfx: (kind: 'call' | 'hop' | 'flap' | 'land' | 'leave') => void;
  /** stop tap-to-walk */
  cancelWalk: () => void;
  /** a ride started (save stats) */
  onRide: () => void;
}

export class Mount implements System {
  phase: MountPhase = 'off';
  id: MountId = 'eagle';
  object = new THREE.Group();
  /** eagle position (body centre), heading (yaw, +z forward like the player), speed */
  gx = 0; gy = 0; gz = 0; heading = 0; speed = 0;
  alt = 0;
  rides = 0; landings = 0; calls = 0;
  /** tapped glide target while riding */
  target: { x: number; z: number } | null = null;
  private bank = 0;
  private flap = 0; private flapRate = 1.6; private glideAmt = 0; private glide = 0; private nextGlide = 3;
  private boost = 0;
  private waitT = 0;
  private hopT = 0; private hopFrom = new THREE.Vector3();
  private seg: Seg | null = null; private segT = 0;
  private t = 0;
  private body = new THREE.Group();
  private head = new THREE.Group();
  private wingL = new THREE.Group(); private wingR = new THREE.Group();
  private tipL = new THREE.Group(); private tipR = new THREE.Group();
  private tail = new THREE.Group();
  private legs = new THREE.Group();
  private shadow: THREE.Mesh;
  private mats: THREE.MeshStandardNodeMaterial[] = [];
  private v = new THREE.Vector3();

  constructor(private player: Player, private input: Input, private rig: CameraRig, private hooks: MountHooks) {
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicNodeMaterial({ color: '#2a1a10', transparent: true, opacity: 0.3, depthWrite: false }));
    this.shadow.renderOrder = 3;
    this.buildEagle();
    this.object.visible = false; this.shadow.visible = false;
  }

  /** add both to the scene */
  get groups() { return [this.object, this.shadow]; }

  // ------------------------------------------------------------ art
  private m(hex: string, rough = 0.8, flat = true) {
    const m = new THREE.MeshStandardNodeMaterial({ color: hex, roughness: rough, metalness: 0, flatShading: flat });
    this.mats.push(m); return m;
  }
  private buildEagle() {
    const brown = this.m('#6b4630'), dark = this.m('#4a2e1f'), white = this.m('#fbf7ee', 0.6, false), gold = this.m('#f2b13b', 0.45, false),
      eye = this.m('#2a1a12', 0.3, false), shine = this.m('#ffffff', 0.2, false), feather = this.m('#7d5438');
    const mesh = (g: THREE.BufferGeometry, mt: THREE.Material, p: [number, number, number], s: [number, number, number] = [1, 1, 1], r: [number, number, number] = [0, 0, 0]) => {
      const o = new THREE.Mesh(g, mt); o.position.set(...p); o.scale.set(...s); o.rotation.set(...r); return o;
    };
    const sph = (r: number, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h);
    // round, cosy body: chest and back, slightly tilted head-up
    this.body.add(mesh(sph(0.42), brown, [0, 0, 0], [0.95, 0.78, 1.45]));
    this.body.add(mesh(sph(0.3), feather, [0, -0.08, 0.22], [1, 0.8, 1.1]));
    // a soft saddle-ish tuft where the rider sits
    this.body.add(mesh(sph(0.2, 10, 8), this.m('#c9a26b', 0.9), [0, 0.27, -0.02], [1.1, 0.35, 1.3]));
    // head (bald eagle: white)
    this.head.position.set(0, 0.24, 0.6);
    this.head.add(mesh(sph(0.27), white, [0, 0.06, 0.02], [1, 0.95, 1.05]));
    this.head.add(mesh(sph(0.22), white, [0, -0.06, -0.12], [1.1, 0.9, 1])); // white neck ruff
    const beak = new THREE.ConeGeometry(0.075, 0.24, 8); beak.rotateX(Math.PI / 2);
    this.head.add(mesh(beak, gold, [0, 0.0, 0.3]));
    this.head.add(mesh(sph(0.06, 8, 6), gold, [0, -0.03, 0.4], [1, 0.8, 1])); // hooked tip
    for (const s of [-1, 1]) {
      this.head.add(mesh(sph(0.05, 10, 8), eye, [s * 0.15, 0.1, 0.18]));
      this.head.add(mesh(sph(0.016, 6, 5), shine, [s * 0.165, 0.125, 0.22]));
      this.head.add(mesh(sph(0.045, 8, 6), brown, [s * 0.14, 0.17, 0.14], [1.4, 0.45, 1], [0, 0, s * -0.3])); // brow
    }
    this.body.add(this.head);
    // white fan tail
    this.tail.position.set(0, 0.04, -0.6);
    for (let i = -2; i <= 2; i++) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.035, 0.5), white);
      f.position.set(i * 0.075, 0, -0.22); f.rotation.y = i * 0.18; this.tail.add(f);
    }
    this.body.add(this.tail);
    // golden legs, tucked in flight
    for (const s of [-1, 1]) {
      this.legs.add(mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.26, 6), gold, [s * 0.14, -0.32, 0.06]));
      this.legs.add(mesh(sph(0.065, 8, 6), gold, [s * 0.14, -0.46, 0.12], [1, 0.6, 1.3]));
    }
    this.body.add(this.legs);
    // wings: shoulder hinge → inner wing → hinged tip with fingered primaries
    const wing = (root: THREE.Group, tip: THREE.Group, s: number) => {
      root.position.set(s * 0.3, 0.14, 0.06);
      root.add(mesh(new THREE.BoxGeometry(0.95, 0.07, 0.62), brown, [s * 0.47, 0, -0.02]));
      root.add(mesh(new THREE.BoxGeometry(0.8, 0.075, 0.24), dark, [s * 0.45, 0.01, 0.22])); // leading-edge coverts
      tip.position.set(s * 0.93, 0, -0.03);
      tip.add(mesh(new THREE.BoxGeometry(0.55, 0.05, 0.5), dark, [s * 0.27, 0, -0.04]));
      for (let i = 0; i < 4; i++) tip.add(mesh(new THREE.BoxGeometry(0.34, 0.03, 0.1), dark, [s * (0.6 + i * 0.02), 0, 0.13 - i * 0.12], [1, 1, 1], [0, s * (-0.12 - i * 0.12), 0]));
      root.add(tip);
      this.body.add(root);
    };
    wing(this.wingL, this.tipL, 1); wing(this.wingR, this.tipR, -1);
    this.body.scale.setScalar(SCALE);
    this.object.add(this.body);
    this.object.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  }
  private setAlpha(a: number) {
    for (const m of this.mats) { const tr = a < 0.999; if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; } m.opacity = a; }
    (this.shadow.material as THREE.MeshBasicNodeMaterial).opacity = 0.3 * a;
  }

  // ------------------------------------------------------------ state
  get active() { return this.phase !== 'off'; }
  /** rider is on the eagle (or hopping on) */
  get carrying() { return this.phase === 'hop' || this.phase === 'ride'; }
  get riding() { return this.phase === 'ride'; }
  /** what the HUD button should say */
  get buttonState(): 'call' | 'busy' | 'hop' | 'land' | 'blocked' {
    if (this.phase === 'ride') return 'land';
    if (this.phase === 'wait') return 'hop';
    if (this.phase !== 'off') return 'busy';
    return this.canCall() ? 'call' : 'blocked';
  }
  canCall() { return this.phase === 'off' && !this.player.inCave && !this.hooks.blocked(); }

  /** the one Mount button / V key: Call → Hop on → Land */
  press() {
    if (this.phase === 'off') return this.call();
    if (this.phase === 'wait') return this.mount();
    if (this.phase === 'ride') return this.land();
    return false;
  }

  call() {
    if (!this.canCall()) {
      if (this.player.inCave) this.hooks.toast('🦅 The eagle can\'t fly down here — head outside first', 1800);
      return false;
    }
    this.calls++;
    const p = this.player.position;
    // swoop in from behind the camera's right shoulder, high and wide, ending hovering just beside you
    const camYaw = this.rig.yaw;
    const side = new THREE.Vector3(Math.cos(camYaw), 0, -Math.sin(camYaw));
    const back = new THREE.Vector3(Math.sin(camYaw), 0, Math.cos(camYaw));
    const to = p.clone().addScaledVector(side, 1.7).addScaledVector(back, -0.4);
    const from = p.clone().addScaledVector(side, 26).addScaledVector(back, 18);
    const fy = Math.max(heightAt(from.x, from.z), WATER_LEVEL) + 20;
    const ty = this.groundAt(to.x, to.z) + WAIT_ALT;
    const h0 = Math.atan2(to.x - from.x, to.z - from.z), v0 = 22;
    // arrive facing the same way as the camera looks, so "hop on" reads naturally
    const h1 = camYaw + Math.PI;
    this.seg = { x0: from.x, z0: from.z, y0: fy, vx0: Math.sin(h0) * v0, vz0: Math.cos(h0) * v0, x1: to.x, z1: to.z, y1: ty, vx1: Math.sin(h1) * 3, vz1: Math.cos(h1) * 3, T: ARRIVE_T, ease: (t) => 1 - (1 - t) ** 3 };
    this.segT = 0;
    this.gx = from.x; this.gy = fy; this.gz = from.z; this.heading = h0;
    this.phase = 'arrive';
    this.setAlpha(1);
    this.object.visible = this.shadow.visible = true;
    this.glideAmt = 1; this.glide = 0;
    this.hooks.sfx('call');
    this.hooks.toast('🦅 Here comes your eagle!', 1500);
    return true;
  }

  /** hop onto the waiting eagle */
  mount() {
    if (this.phase !== 'wait') return false;
    if (this.hooks.blocked()) return false;
    this.hooks.cancelWalk();
    this.hopT = 0; this.hopFrom.copy(this.player.position);
    this.player.mounted = true;
    this.phase = 'hop';
    this.hooks.sfx('hop');
    return true;
  }

  /** set the rider down under the eagle and send it home */
  land() {
    if (this.phase !== 'ride') return false;
    this.dropRider();
    this.hooks.sfx('land');
    this.startLeave();
    return true;
  }

  /** end everything at once (cave, build mode, reset) */
  dropNow() {
    if (this.carrying) this.dropRider();
    if (this.phase !== 'off' && this.phase !== 'leave') this.startLeave(true);
  }

  private dropRider() {
    // land on the ground straight below (or float if it's sea)
    const x = this.gx, z = this.gz;
    this.player.mounted = false;
    this.player.unseat();
    this.player.teleport(x, z, this.heading);
    this.target = null;
    this.landings++;
    this.rig.mountBoost = 0;
  }

  private startLeave(fast = false) {
    const ang = this.heading + 0.5;
    const sp = Math.max(this.speed, 4);
    this.seg = { x0: this.gx, z0: this.gz, y0: this.gy, vx0: Math.sin(this.heading) * sp, vz0: Math.cos(this.heading) * sp,
      x1: this.gx + Math.sin(ang) * 34, z1: this.gz + Math.cos(ang) * 34, y1: this.gy + 16, vx1: Math.sin(ang) * 24, vz1: Math.cos(ang) * 24,
      T: fast ? 1.0 : LEAVE_T, ease: (t) => t * t };
    this.segT = 0;
    this.phase = 'leave';
    this.hooks.sfx('leave');
  }

  /** a tap while the eagle is about; returns true when the mount used it */
  onTap(cx: number, cy: number, project: (v: THREE.Vector3) => { x: number; y: number; vis: boolean }, ground: (cx: number, cy: number) => THREE.Vector3 | null, slop = 80) {
    if (this.phase === 'wait') {
      const s = project(this.v.set(this.gx, this.gy + 0.2, this.gz));
      if (s.vis && Math.hypot(s.x - cx, s.y - cy) < slop * 1.3) { this.mount(); return true; }
      return false;
    }
    if (this.phase === 'ride') {
      const pt = ground(cx, cy);
      if (pt) this.target = { x: pt.x, z: pt.z };
      return true;
    }
    return this.phase === 'hop' || this.phase === 'arrive';
  }

  private groundAt(x: number, z: number) { return Math.max(heightAt(x, z), WATER_LEVEL); }

  // ------------------------------------------------------------ per-frame
  private stepSeg(dt: number) {
    const s = this.seg!;
    this.segT = Math.min(1, this.segT + dt / s.T);
    const t = this.segT;
    const px = this.gx, pz = this.gz;
    this.gx = hermite(s.x0, s.vx0 * s.T, s.x1, s.vx1 * s.T, t);
    this.gz = hermite(s.z0, s.vz0 * s.T, s.z1, s.vz1 * s.T, t);
    this.gy = s.y0 + (s.y1 - s.y0) * s.ease(t);
    // never clip the terrain on the way in
    this.gy = Math.max(this.gy, this.groundAt(this.gx, this.gz) + 0.6);
    const dx = this.gx - px, dz = this.gz - pz, d = Math.hypot(dx, dz);
    if (dt > 0) this.speed = d / dt;
    if (d > 0.002) this.turnTo(Math.atan2(dx, dz), dt, 8);
    return t >= 1;
  }

  private turnTo(want: number, dt: number, rate: number) {
    const d = wrap(want - this.heading), step = d * Math.min(1, dt * rate);
    this.heading = wrap(this.heading + step);
    // bank into turns (body roll), eased
    const bankWant = THREE.MathUtils.clamp(-(step / Math.max(dt, 1e-3)) * 0.22, -0.5, 0.5);
    this.bank += (bankWant - this.bank) * Math.min(1, dt * 4);
  }

  private steer(dt: number) {
    const k = this.input.keys, en = this.player.enabled || this.player.mounted;
    let fx = 0, fz = 0;
    if (en) {
      if (k.has('w') || k.has('arrowup')) fz -= 1;
      if (k.has('s') || k.has('arrowdown')) fz += 1;
      if (k.has('a') || k.has('arrowleft')) fx -= 1;
      if (k.has('d') || k.has('arrowright')) fx += 1;
    }
    const st = this.input.stick, sm = Math.hypot(st.x, st.y);
    let analog = 1;
    if (en && sm > 0.08 && fx === 0 && fz === 0) { fx = st.x; fz = st.y; analog = Math.min(1, sm / 0.9); }
    const len = Math.hypot(fx, fz);
    const fast = k.has('shift') || sm > 0.92;
    let want = 0;
    if (len > 0) {
      this.target = null; // manual flying cancels a tapped glide
      fx /= len; fz /= len;
      const cy = Math.cos(this.rig.yaw), sy = Math.sin(this.rig.yaw);
      const mx = fx * cy + fz * sy, mz = -fx * sy + fz * cy;
      this.turnTo(Math.atan2(mx, mz), dt, 3.2);
      want = (fast ? FLY_FAST : FLY_SPEED) * Math.max(0.35, analog);
    } else if (this.target) {
      const dx = this.target.x - this.gx, dz = this.target.z - this.gz, d = Math.hypot(dx, dz);
      if (d < 1.2) this.target = null;
      else { this.turnTo(Math.atan2(dx, dz), dt, 2.6); want = Math.min(FLY_SPEED, d * 1.4); }
    } else this.bank += (0 - this.bank) * Math.min(1, dt * 3);
    this.speed += (want - this.speed) * Math.min(1, dt * (want > this.speed ? 1.8 : 1.4));
    let nx = this.gx + Math.sin(this.heading) * this.speed * dt, nz = this.gz + Math.cos(this.heading) * this.speed * dt;
    // soft leash: past the reef the wind turns you back toward the island
    const off = offshore(nx, nz);
    if (off > SWIM_MAX + 6) { const r = Math.hypot(nx, nz) || 1, push = Math.min(1, (off - SWIM_MAX - 6) / 6) * 8 * dt; nx -= (nx / r) * push; nz -= (nz / r) * push; }
    this.gx = nx; this.gz = nz;
    // Space: one big flap upward (eases back down)
    if (en && this.input.pressed.has(' ')) { this.boost = Math.min(6, this.boost + 3.2); this.hooks.sfx('flap'); this.glide = 0; }
    this.boost = Math.max(0, this.boost - dt * 0.9);
    // height: look ahead so it lifts over hills before reaching them
    const la = 2 + this.speed * 0.6;
    const g = Math.max(this.groundAt(this.gx, this.gz), this.groundAt(this.gx + Math.sin(this.heading) * la, this.gz + Math.cos(this.heading) * la) - 0.6);
    const wy = g + RIDE_ALT + this.boost + Math.sin(this.t * 1.3) * 0.25;
    this.gy += (wy - this.gy) * Math.min(1, dt * 1.8);
    this.gy = Math.max(this.gy, this.groundAt(this.gx, this.gz) + 1.4);
  }

  update(dt: number) {
    if (this.phase === 'off') return;
    this.t += dt;
    // never underground, never while building
    if (this.carrying && (this.player.inCave || this.hooks.mustLand())) { this.dropNow(); }
    switch (this.phase) {
      case 'arrive':
        if (this.stepSeg(dt)) { this.phase = 'wait'; this.waitT = 0; this.speed = 0; this.hooks.sfx('land'); }
        break;
      case 'wait': {
        this.waitT += dt;
        // hover beside you, turning to keep you in view
        const p = this.player.position;
        const wy = this.groundAt(this.gx, this.gz) + WAIT_ALT + Math.sin(this.t * 2.1) * 0.08;
        this.gy += (wy - this.gy) * Math.min(1, dt * 3);
        // drift to stay close if you wander a little
        const dx = p.x - this.gx, dz = p.z - this.gz, d = Math.hypot(dx, dz);
        if (d > 3.2) { const k = Math.min(1, dt * 1.5) * (d - 2.2) / d; this.gx += dx * k; this.gz += dz * k; this.turnTo(Math.atan2(dx, dz), dt, 3); }
        this.bank += (0 - this.bank) * Math.min(1, dt * 3);
        if (this.waitT > WAIT_MAX || d > 18 || this.player.inCave) { this.hooks.toast('🦅 The eagle got bored and flew off. Call it again any time!', 2000); this.startLeave(); }
        break;
      }
      case 'hop': {
        this.hopT = Math.min(1, this.hopT + dt / HOP_T);
        this.gy += (this.groundAt(this.gx, this.gz) + WAIT_ALT - 0.15 - this.gy) * Math.min(1, dt * 6);
        if (this.hopT >= 1) {
          this.phase = 'ride'; this.rides++; this.speed = 0; this.boost = 1.5; this.target = null;
          this.hooks.onRide();
          this.hooks.sfx('flap');
          if (this.rides === 1) this.hooks.toast('🦅 Wheee! Steer with the stick · <b>Jump</b> to flap higher · tap <b>Land</b> to hop off', 3600);
        }
        break;
      }
      case 'ride':
        this.steer(dt);
        break;
      case 'leave':
        if (this.stepSeg(dt)) { this.phase = 'off'; this.object.visible = this.shadow.visible = false; this.seg = null; this.setAlpha(1); return; }
        if (this.segT > 0.55) this.setAlpha(1 - (this.segT - 0.55) / 0.45);
        break;
    }
    this.alt = this.gy - this.groundAt(this.gx, this.gz);
    this.draw(dt);
    this.rig.mountBoost += ((this.phase === 'ride' ? 1.2 : 0) - this.rig.mountBoost) * Math.min(1, dt * 2);
    if (this.carrying) this.seatRider();
  }

  private draw(dt: number) {
    const ph = this.phase;
    // gliding now and then on a ride, wings held in a soaring V
    if (ph === 'ride' && this.boost < 0.5) { this.nextGlide -= dt; if (this.nextGlide <= 0 && this.glide <= 0) { this.glide = 1.6 + Math.random(); this.nextGlide = 4 + Math.random() * 4; } }
    if (this.glide > 0) this.glide -= dt;
    const gWant = (this.glide > 0 && this.speed > 3) || (ph === 'arrive' && this.segT < 0.55) ? 1 : 0;
    this.glideAmt += (gWant - this.glideAmt) * Math.min(1, dt * 4);
    const rate = ph === 'wait' ? 2.6 : ph === 'hop' ? 3.4 : ph === 'leave' ? 2.6 : ph === 'arrive' ? 1.4 : this.boost > 0.5 ? 2.8 : 1.5 + this.speed * 0.04;
    this.flapRate += (rate - this.flapRate) * Math.min(1, dt * 5);
    this.flap += dt * Math.PI * 2 * this.flapRate * (1 - this.glideAmt * 0.9);
    const c = Math.cos(this.flap);
    const amp = ph === 'wait' ? 0.75 : 0.62;
    const up = c * amp * (1 - this.glideAmt) + 0.18 * this.glideAmt;
    this.wingL.rotation.z = up; this.wingR.rotation.z = -up;
    // tips lag behind the stroke (a soft whip)
    const tip = Math.cos(this.flap - 0.9) * 0.35 * (1 - this.glideAmt) - 0.05 * this.glideAmt;
    this.tipL.rotation.z = tip; this.tipR.rotation.z = -tip;
    // a little forward sweep on the downstroke
    this.wingL.rotation.y = -Math.sin(this.flap) * 0.12; this.wingR.rotation.y = Math.sin(this.flap) * 0.12;
    const bob = -Math.sin(this.flap) * 0.07 * (1 - this.glideAmt);
    this.object.position.set(this.gx, this.gy + bob, this.gz);
    // pitch: nose up while hovering / braking, level at speed
    const pitch = ph === 'wait' || ph === 'hop' ? -0.25 : THREE.MathUtils.clamp(-0.25 + this.speed * 0.022, -0.25, 0.1);
    this.object.rotation.set(0, 0, 0);
    this.object.rotateY(this.heading);
    this.object.rotateX(pitch);
    this.object.rotateZ(this.bank);
    // tail fans while hovering; legs drop when it's close to the ground
    this.tail.scale.x = ph === 'wait' || ph === 'hop' ? 1.25 : 1;
    this.tail.rotation.x = ph === 'wait' ? 0.25 : -0.05;
    this.legs.position.y = this.alt < 2.2 ? -0.06 : 0.06;
    // head looks at you while waiting, into the turn while flying
    if (ph === 'wait') {
      const p = this.player.position;
      const want = wrap(Math.atan2(p.x - this.gx, p.z - this.gz) - this.heading);
      this.head.rotation.y += (THREE.MathUtils.clamp(want, -1, 1) - this.head.rotation.y) * Math.min(1, dt * 4);
      this.head.rotation.z = Math.sin(this.t * 1.7) * 0.12; // curious head tilt
    } else { this.head.rotation.y += (-this.bank * 0.8 - this.head.rotation.y) * Math.min(1, dt * 4); this.head.rotation.z *= 0.9; }
    // shadow on the ground, smaller and fainter the higher it is
    const gy = this.groundAt(this.gx, this.gz);
    const k = 1 / (1 + this.alt / 6);
    this.shadow.position.set(this.gx, gy + 0.06, this.gz);
    this.shadow.scale.set(1.5 * (0.5 + k * 0.6), 1, 1.1 * (0.5 + k * 0.6));
    this.shadow.rotation.y = this.heading;
    if (ph !== 'leave') (this.shadow.material as THREE.MeshBasicNodeMaterial).opacity = 0.1 + 0.25 * k;
  }

  /** place the rider on the eagle's back (and keep the physics body under them) */
  private seatRider() {
    this.object.updateMatrixWorld(true);
    const seat = this.body.localToWorld(this.v.copy(SEAT));
    const o = this.player.object;
    if (this.phase === 'hop') {
      // little arc from where you stood onto the eagle's back
      const t = this.hopT, e = t * t * (3 - 2 * t);
      o.position.lerpVectors(this.hopFrom, seat, e);
      o.position.y += Math.sin(t * Math.PI) * 0.9;
      let d = wrap(this.heading - o.rotation.y);
      o.rotation.set(0, o.rotation.y + d * Math.min(1, e * 1.5), 0);
    } else {
      o.position.copy(seat);
      o.rotation.set(0, 0, 0);
      o.rotateY(this.heading);
      o.rotateZ(this.bank * 0.9);
    }
    // body sits a bit under the rider's feet: followers, camera and audio use player.position
    this.player.snapBody(o.position.x, o.position.y, o.position.z, this.heading);
  }

  /** test/debug snapshot */
  snapshot() {
    return {
      phase: this.phase, riding: this.riding, carrying: this.carrying, button: this.buttonState,
      pos: [this.gx, this.gy, this.gz].map((n) => +n.toFixed(2)), alt: +this.alt.toFixed(2), speed: +this.speed.toFixed(2),
      heading: +this.heading.toFixed(2), rides: this.rides, landings: this.landings, calls: this.calls, target: this.target,
      mounted: this.player.mounted, visible: this.object.visible,
    };
  }
}
