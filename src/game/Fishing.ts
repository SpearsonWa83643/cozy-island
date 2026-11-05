import * as THREE from 'three/webgpu';
import type { Game } from '../core/Game';
import { heightAt } from '../world/Terrain';
import { WATER_LEVEL, BASE_POND, ISLAND_SCALE } from '../world/config';
import { nearestLand } from '../world/Shore';
import { FISH, RARITY_W, ZONE_W, type FishDef, type Water } from './FishDefs';

/**
 * Fishing (Order 52a). Stand by the water (beach, dock, the marsh pond) or sit in the rowboat and tap 🎣 Fish:
 * the bobber flies out where you're looking, bobs, and after a few seconds a fish bites (the bobber dips, "!").
 * Tap Hook! within the bite window, then the reel meter: a marker sweeps a bar, tap Reel! while it's in the
 * green zone (two tries). Which fish bites depends on the water (pond / shore / open sea from the boat),
 * the time of day and the rain. Catches are saved (count + best size) for the journal (52b).
 * Rod, line and bobber are three small meshes, hidden (no draws) when you're not fishing.
 */
export type FishState = 'idle' | 'cast' | 'wait' | 'bite' | 'reel';
const POND = { x: BASE_POND.x * ISLAND_SCALE, z: BASE_POND.z * ISLAND_SCALE, r: BASE_POND.r * ISLAND_SCALE + 3 };
const MIN_DEPTH = 0.45, BITE_WIN = 1.8, REEL_TIME = 7;
const SEG = 10;

export class Fishing {
  group = new THREE.Group();
  state: FishState = 'idle';
  /** tapped Fish in a moving boat: resting the oars, casts once it has slowed */
  settle = false;
  /** where the bobber lands; water kind there */
  spot = new THREE.Vector3(); water: Water = 'sea';
  canFish = false;
  /** reel meter: marker 0..1, zone centre, tries left; the hooked fish */
  marker = 0; zone = 0.5; zoneW = 0.3; tries = 2; fish: FishDef | null = null;
  /** test hook: hold the meter marker still */
  freeze = false; // test hook: holds the bite timer + reel marker (the real rAF loop also steps the game)
  catches = 0; misses = 0; last: { id: string; size: number; isNew: boolean } | null = null;
  private t = 0; private waitFor = 3; private dir = 1; private probeT = 0; private bobT = 0;
  private rod: THREE.Mesh; private line: THREE.Line; private bobber: THREE.Mesh;
  private linePos: Float32Array;
  private btn: HTMLButtonElement; private meter: HTMLDivElement; private mk: HTMLElement; private zn: HTMLElement;
  private shownLabel = '';
  rnd = Math.random;

  constructor(private g: Game) {
    const rodGeo = new THREE.CylinderGeometry(0.012, 0.025, 1.7, 5); rodGeo.translate(0, 0.85, 0);
    this.rod = new THREE.Mesh(rodGeo, new THREE.MeshStandardNodeMaterial({ color: 0x8a5a33, roughness: 0.8 }));
    const bg = new THREE.SphereGeometry(0.09, 10, 8), col = new Float32Array(bg.attributes.position.count * 3);
    for (let i = 0; i < bg.attributes.position.count; i++) { const top = bg.attributes.position.getY(i) > 0; col.set(top ? [0.95, 0.2, 0.18] : [0.98, 0.96, 0.92], i * 3); }
    bg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.bobber = new THREE.Mesh(bg, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.5 }));
    this.linePos = new Float32Array((SEG + 1) * 3);
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3));
    this.line = new THREE.Line(lg, new THREE.LineBasicNodeMaterial({ color: 0xf4f1e8, transparent: true, opacity: 0.8 }));
    this.line.frustumCulled = false;
    for (const o of [this.rod, this.bobber, this.line]) { o.castShadow = false; o.name = 'fishing'; this.group.add(o); }
    this.group.visible = false;

    // 🎣 button: in the touch button grid (next to Jump), or a fixed button on desktop (Q)
    this.btn = document.createElement('button');
    this.btn.type = 'button';
    const grid = document.querySelector('.touch-ui .tbtns');
    if (grid) { this.btn.className = 'tbtn fish hide'; grid.insertBefore(this.btn, grid.querySelector('.jump')); }
    else { this.btn.className = 'fish-btn desktop hide'; document.body.appendChild(this.btn); }
    this.btn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.btn.classList.add('down'); g.audio.unlock(); this.press(); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) this.btn.addEventListener(ev, () => this.btn.classList.remove('down'));
    this.btn.addEventListener('click', (e) => e.stopPropagation());
    window.addEventListener('keydown', (e) => { if ((e.target as HTMLElement)?.tagName === 'INPUT') return; if (e.key.toLowerCase() === 'q' && !e.repeat) this.press(); });

    this.meter = document.createElement('div');
    this.meter.className = 'fish-meter off';
    this.meter.innerHTML = '<div class="fm-title">🎣 Tap <b>Reel!</b> in the green</div><div class="fm-bar"><div class="fm-zone"></div><div class="fm-mark"></div></div><div class="fm-tries"></div>';
    this.meter.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); if (this.state === 'reel') this.press(); });
    document.body.appendChild(this.meter);
    this.mk = this.meter.querySelector('.fm-mark')!; this.zn = this.meter.querySelector('.fm-zone')!;
    this.syncBtn();
  }

  private boatRide() { const m = this.g.mount; return m.id === 'rowboat' && m.phase === 'ride'; }
  private blocked() {
    const g = this.g, m = g.mount;
    if (g.build?.active || g.cave.inside || g.play.previewing || g.play.friend?.open || g.play.journal?.open || g.player.swimming) return true;
    if (m.phase !== 'off' && !this.boatRide()) return true; // flying / swimming mounts: no
    return false;
  }
  private depth(x: number, z: number) { return WATER_LEVEL - heightAt(x, z); }
  private waterAt(x: number, z: number): Water {
    if (Math.hypot(x - POND.x, z - POND.z) < POND.r) return 'pond';
    return nearestLand(x, z).off > 18 ? 'deep' : 'sea';
  }
  /** where a cast from here would land (first spot 2.5-9 m out along the camera, then the way you face, deep enough) */
  private probe(out: THREE.Vector3): boolean {
    const g = this.g, boat = this.boatRide();
    const ox = boat ? g.mount.gx : g.player.position.x, oz = boat ? g.mount.gz : g.player.position.z;
    const yaws = [g.rig.yaw + Math.PI, g.player.facingYaw];
    for (const yw of yaws) {
      const fx = Math.sin(yw), fz = Math.cos(yw);
      for (let d = boat ? 3 : 2.5; d <= 9; d += 0.75) {
        const x = ox + fx * d, z = oz + fz * d;
        if (this.depth(x, z) > MIN_DEPTH) { out.set(x, WATER_LEVEL, z); return true; }
      }
    }
    return false;
  }

  /** the one button: Fish -> (wait: reel in) -> Hook! -> Reel! */
  press() {
    const g = this.g;
    if (this.state === 'idle') {
      if (this.blocked() || !this.probe(this.spot)) { if (!this.blocked()) g.play.toast('🎣 Stand by the water (beach, dock, pond) or sit in the rowboat to fish'); return; }
      if (this.boatRide()) g.mount.stopTour();
      if (this.boatRide() && g.mount.speed > 2.5) { if (!this.settle) g.play.toast('🎣 Resting the oars… casting as the boat slows'); this.settle = true; return; }
      this.settle = false;
      g.play.walk.cancel(false);
      this.water = this.waterAt(this.spot.x, this.spot.z);
      this.state = 'cast'; this.t = 0; this.waitFor = 2 + this.rnd() * 3.5; this.group.visible = true;
      if (!this.boatRide()) { const p = g.player.position; g.player.face(Math.atan2(this.spot.x - p.x, this.spot.z - p.z)); }
      g.audio.ui(); this.syncBtn(); return;
    }
    if (this.state === 'cast' || this.state === 'wait') { g.play.toast('🎣 Nothing on the line yet — reeled in', 1600); this.stop(); return; }
    if (this.state === 'bite') {
      this.fish = this.pick(); this.state = 'reel'; this.t = 0; this.tries = 2; this.marker = 0; this.dir = 1;
      this.zoneW = ZONE_W[this.fish.rarity]; this.zone = this.zoneW / 2 + 0.12 + this.rnd() * (0.76 - this.zoneW);
      this.zn.style.left = `${(this.zone - this.zoneW / 2) * 100}%`; this.zn.style.width = `${this.zoneW * 100}%`;
      this.meter.classList.remove('off'); g.audio.pop(1.4); this.syncBtn(); return;
    }
    if (this.state === 'reel') {
      if (Math.abs(this.marker - this.zone) <= this.zoneW / 2) { this.land(); return; }
      this.tries--; this.misses++; g.audio.pop(0.7);
      this.meter.classList.remove('miss'); void this.meter.offsetWidth; this.meter.classList.add('miss');
      if (this.tries <= 0) { g.play.toast('🐟 It wriggled free… try again!', 1800); this.stop(); }
      this.syncBtn();
    }
  }

  /** which fish bites: this water, this time of day, the rain; weighted by rarity */
  pick(): FishDef {
    const g = this.g, night = g.time.night > 0.5, rain = g.weather.rain > 0.25;
    const pool = FISH.filter((f) => (f.water === this.water || (this.water === 'deep' && f.water === 'sea' && f.time === 'any')) &&
      (f.time === 'any' || (f.time === 'night' ? night : f.time === 'day' ? !night : rain)));
    let sum = 0; for (const f of pool) sum += RARITY_W[f.rarity];
    let r = this.rnd() * sum; for (const f of pool) { r -= RARITY_W[f.rarity]; if (r <= 0) return f; }
    return pool[0];
  }

  private land() {
    const g = this.g, f = this.fish!, d = g.play.save.data;
    const size = Math.round(f.size[0] + (f.size[1] - f.size[0]) * Math.pow(this.rnd(), 1.6));
    const book = (d.fish ??= {}), rec = book[f.id], isNew = !rec;
    book[f.id] = { n: (rec?.n ?? 0) + 1, best: Math.max(rec?.best ?? 0, size) };
    g.play.save.touch(); this.catches++; this.last = { id: f.id, size, isNew };
    const best = !isNew && size > (rec?.best ?? 0);
    const p = g.player.position.clone().add(new THREE.Vector3(0, 2.1, 0));
    g.play.juice.pop(p, `<span class="fish-ico" style="filter:hue-rotate(${f.hue}deg)">${f.icon}</span>`, 'emote', 1.8, 50);
    g.play.toast(`🎣 You caught a <b>${f.name}</b> ${f.icon} — ${size} cm${isNew ? ' <b>NEW!</b> <small>(journal)</small>' : best ? ' <b>Best yet!</b>' : ''}`, 3000);
    g.audio.pop(1.8); setTimeout(() => g.audio.pop(2.2), 120);
    g.play.checkJournalRewards();
    this.stop();
  }

  stop() { this.state = 'idle'; this.fish = null; this.group.visible = false; this.meter.classList.add('off'); this.syncBtn(); }

  private syncBtn() {
    const lbl = this.state === 'idle' ? '🎣<span>Fish</span>' : this.state === 'bite' ? '❗<span>Hook!</span>' : this.state === 'reel' ? '🎣<span>Reel!</span>' : '🎣<span>Reel in</span>';
    if (lbl !== this.shownLabel) { this.btn.innerHTML = lbl; this.shownLabel = lbl; this.btn.setAttribute('aria-label', lbl.replace(/<[^>]+>/g, '').replace(/^\W+/, '')); }
    this.btn.classList.toggle('hide', this.state === 'idle' && !this.canFish);
    this.btn.classList.toggle('on', this.state !== 'idle');
    this.btn.classList.toggle('bite', this.state === 'bite');
  }

  update(dt: number, time: number) {
    const g = this.g;
    if (this.state === 'idle') {
      if (this.settle) {
        const st = g.input.stick;
        if (!this.boatRide() || Math.hypot(st.x, st.y) > 0.3) this.settle = false;
        else { g.mount.stopTour(); if (g.mount.speed <= 2.5) this.press(); }
      }
      this.probeT -= dt;
      if (this.probeT <= 0) { this.probeT = 0.25; const c = !this.blocked() && this.probe(this.spot); if (c !== this.canFish) { this.canFish = c; this.syncBtn(); } }
      return;
    }
    // walking off, rowing, a mount, build mode or swimming reels the line in
    const st = g.input.stick;
    if (this.blocked() || Math.hypot(st.x, st.y) > 0.3 || g.play.walk.goal) { this.stop(); return; }
    if (!(this.freeze && this.state !== 'cast' && this.state !== 'wait')) this.t += dt; this.bobT += dt;
    if (this.state === 'cast' && this.t > 0.55) { this.state = 'wait'; this.t = 0; g.audio.pop(0.9); }
    else if (this.state === 'wait' && this.t > this.waitFor) {
      this.state = 'bite'; this.t = 0; this.syncBtn(); g.audio.pop(1.6);
      g.play.juice.pop(this.spot.clone().add(new THREE.Vector3(0, 0.6, 0)), '❗', 'emote', 1.2, 30);
    } else if (this.state === 'bite' && this.t > BITE_WIN) { g.play.toast('🐟 Too slow — it took the bait and swam off', 1800); this.stop(); return; }
    else if (this.state === 'reel') {
      if (!this.freeze) { this.marker += this.dir * this.fish!.speed * dt * 1.6; if (this.marker > 1) { this.marker = 2 - this.marker; this.dir = -1; } if (this.marker < 0) { this.marker = -this.marker; this.dir = 1; } }
      this.mk.style.left = `${this.marker * 100}%`;
      this.meter.querySelector('.fm-tries')!.textContent = this.tries > 1 ? '2 tries' : 'last try!';
      if (this.t > REEL_TIME) { g.play.toast('🐟 The fish tired of waiting and swam off', 1800); this.stop(); return; }
    }
    this.pose(time);
  }

  /** rod in hand, bobber arc / bob / dip, sagging line from the rod tip */
  private pose(time: number) {
    const g = this.g, boat = this.boatRide();
    const base = boat ? new THREE.Vector3(g.mount.gx, WATER_LEVEL + 0.7, g.mount.gz) : g.player.position.clone().add(new THREE.Vector3(0, 0.95, 0));
    const dx = this.spot.x - base.x, dz = this.spot.z - base.z, L = Math.hypot(dx, dz) || 1, fx = dx / L, fz = dz / L;
    base.x += fx * 0.35 + fz * 0.28; base.z += fz * 0.35 - fx * 0.28;
    this.rod.position.copy(base);
    const tipDir = new THREE.Vector3(fx * 0.55, 0.83, fz * 0.55).normalize();
    this.rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tipDir);
    const tip = base.clone().addScaledVector(tipDir, 1.7);
    const b = this.bobber.position;
    if (this.state === 'cast') { const k = Math.min(1, this.t / 0.55); b.lerpVectors(tip, this.spot, k); b.y += Math.sin(k * Math.PI) * 1.4; }
    else {
      const dip = this.state === 'bite' ? 0.09 + Math.max(0, Math.sin(this.t * 22)) * 0.08 : this.state === 'reel' ? 0.06 + Math.sin(this.t * 14) * 0.04 : 0;
      b.set(this.spot.x, WATER_LEVEL + 0.03 + Math.sin(this.bobT * 2.6) * 0.025 - dip, this.spot.z);
    }
    const sag = this.state === 'reel' ? 0.1 : 0.6;
    for (let i = 0; i <= SEG; i++) { const s = i / SEG;
      this.linePos[i * 3] = tip.x + (b.x - tip.x) * s; this.linePos[i * 3 + 1] = tip.y + (b.y - tip.y) * s - Math.sin(s * Math.PI) * sag; this.linePos[i * 3 + 2] = tip.z + (b.z - tip.z) * s; }
    (this.line.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    void time;
  }

  snapshot() {
    return { state: this.state, canFish: this.canFish, water: this.water, spot: [+this.spot.x.toFixed(1), +this.spot.z.toFixed(1)], marker: +this.marker.toFixed(2), zone: +this.zone.toFixed(2), zoneW: this.zoneW,
      tries: this.tries, fish: this.fish?.id ?? null, catches: this.catches, misses: this.misses, last: this.last, visible: this.group.visible, btn: !this.btn.classList.contains('hide') };
  }
}
