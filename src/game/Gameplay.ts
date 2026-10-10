import * as THREE from 'three/webgpu';
import type { Game } from '../core/Game';
import type { System } from '../core/System';
import { Save } from './Save';
import { Forage, type FoodItem } from './Forage';
import { Treasure } from './Treasure';
import { Guide } from './Guide';
import { DYES, FOODS, RARITY, SEA_WEAR, TASTES, WEAR_BY_ID, type FoodId, type Slot, type Species } from './Items';
import { Fauna, type FollowCtx, type FriendRef } from '../world/Fauna';
import type { SeaBottle } from '../world/Reef';
import { MapOverlay } from '../ui/MapOverlay';
import { Juice } from '../ui/Juice';
import { Panels } from '../ui/Panels';

type Kind = 'open' | 'dig' | 'take' | 'feed' | 'pick';
interface Target { kind: Kind; icon: string; label: string; key: string; pos: THREE.Vector3; run: () => void; }

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Treasure maps, foraging, feeding/followers, wardrobe and saving: the "cozy loop" layer on top of the world. */
export class Gameplay implements System {
  save = new Save();
  forage: Forage;
  treasure: Treasure;
  guide = new Guide();
  map: MapOverlay;
  juice: Juice;
  panels: Panels;
  target: Target | null = null;
  private crumbs: THREE.Vector3[] = [];
  private warmT = 0; private remindT = 10; private targetT = 0;
  private preview = 0; // 0..1 blend into wardrobe camera
  private previewOn = false;
  private previewYaw = 0;
  private camFrom = new THREE.Vector3(); private camLook = new THREE.Vector3();
  private ctx: FollowCtx;
  private lockMove = 0;
  private swimUi: HTMLDivElement;
  private swimTip = false;
  /** ms between the lid popping and the reward card (tests stretch it to capture the burst) */
  rewardDelay = 750;
  private pendingReward: (() => void) | null = null;
  private rewardTimer = 0;
  /** show a pending reward card immediately (tests) */
  showRewardNow() { clearTimeout(this.rewardTimer); this.pendingReward?.(); }

  constructor(private g: Game, spawn: THREE.Vector2) {
    const d = this.save.data;
    this.forage = new Forage(g.flora, spawn);
    g.scene.add(this.forage.group);
    this.treasure = new Treasure(d, g.flora, spawn);
    g.scene.add(this.treasure.group, this.guide.mesh);
    this.guide.enabled = d.guide !== false;
    const root = document.getElementById('hud') ?? document.body;
    this.map = new MapOverlay(document.body, g.flora);
    this.map.onClose = () => g.audio.paper();
    this.map.onGuide = () => { this.setGuide(!this.guide.enabled); return this.guide.enabled; };
    this.map.guideOn = this.guide.enabled;
    this.juice = new Juice(root, g.camera);
    this.juice.onEquipFromReward = () => { const last = this.lastReward; if (last) { this.equip(WEAR_BY_ID.get(last)!.slot, last); } };
    this.panels = new Panels(document.body, {
      save: () => this.save.data,
      equip: (slot, id) => this.equip(slot, id),
      buyDye: (id) => { const dy = DYES.find((x) => x.id === id)!; if (d.shells < dy.cost) { this.juice.toast(`Need 🐚 ${dy.cost} shells for ${dy.name}`); return false; } d.shells -= dy.cost; d.dyes.push(id); this.g.audio.pop(1.5); this.save.touch(); return true; },
      setDye: (id) => { d.dye = id; this.applyOutfit(); this.g.audio.pop(1.2); this.save.touch(); },
      friends: () => this.g.fauna.friends().map((f) => ({ species: f.species, hunger: f.a.hunger })),
      dismiss: (i) => { const f = this.g.fauna.friends()[i]; if (f) { this.g.fauna.dismiss(f); this.juice.pop(new THREE.Vector3(f.a.x, f.a.y + 0.9, f.a.z), '👋', 'emote', 1.6, 40); } },
      sheet: (k) => { this.setPreview(k === 'wardrobe'); this.save.touch(); if (!k) this.panels.refreshBadges(); },
      map: () => this.toggleMap(),
      ui: () => this.g.audio.ui(),
      trade: (id) => { const n = d.food[id] ?? 0, f = FOODS[id]; if (!n || !f.sea) return; const got = n * (f.trade ?? 1); d.food[id] = 0; d.shells += got; this.g.audio.pop(1.6); this.juice.toast(`Traded ${n} ${f.icon} for <b>+${got} 🐚</b>`); this.save.touch(); this.panels.refreshBadges(); },
    }, g.isTouch);
    // swim stamina / current ring (shown when you're far out)
    this.swimUi = document.createElement('div');
    this.swimUi.className = 'swim-meter';
    this.swimUi.innerHTML = '<div class="ring"><span>🏊</span></div><div class="lbl"></div>';
    root.appendChild(this.swimUi);
    this.panels.onAction = () => this.act();
    // contextual action from a tap/click near the target
    g.input.onClick.push((e, drag) => {
      if (drag || g.build.active || e.button !== 0 || !this.target) return;
      const s = this.juice.project(this.target.pos);
      if (Math.hypot(s.x - e.clientX, s.y - e.clientY) < (g.isTouch ? 90 : 110)) this.act();
    });
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (k === 'escape') { this.map.hide(); this.panels.toggle(null); }
      if (k === 'm') { g.audio.unlock(); this.toggleMap(); }
      if (k === 'g') this.setGuide(!this.guide.enabled);
      if (k === 'i') this.panels.toggle('bag');
      if (k === 'o') this.panels.toggle('wardrobe');
    });
    // restore placed builds
    for (const b of d.builds) if (b.t >= 0) g.build.placeAt(b.x, b.z, b.t, b.r, b.y);
    const prevChange = g.build.onChange;
    g.build.onChange = () => { prevChange(); d.builds = g.build.serialize(); this.save.touch(); };
    this.treasure.onDug = () => { this.g.audio.chest(0); this.juice.pop(this.treasure.spot.clone().add(new THREE.Vector3(0, 1.2, 0)), '✨', 'emote', 1.2, 50); this.save.touch(); };
    this.applyOutfit();
    this.ctx = {
      trail: (dist, out) => this.trail(dist, out),
      px: 0, py: 0, pz: 0, running: false,
      attract: (sp) => this.bestFood(sp as Species) !== null,
      friends: [],
      emote: (kind, x, y, z, sp) => {
        const t = TASTES[sp as Species];
        if (kind === 'hungry') this.juice.pop(new THREE.Vector3(x, y, z), `💭${FOODS[t.fav[0]].icon}`, 'emote', 3, 30);
        else { this.juice.pop(new THREE.Vector3(x, y, z), '👋', 'emote', 2, 40); this.juice.toast(`${t.icon} ${t.name} got hungry and wandered home`); }
      },
    };
    window.addEventListener('beforeunload', () => this.save.flush());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.save.flush(); });
  }

  get followCtx() { return this.ctx; }

  // ---------------- outfit ----------------
  private lastReward: string | null = null;
  applyOutfit() {
    const d = this.save.data;
    this.g.player.outfit.apply(d.equipped, DYES.find((x) => x.id === d.dye)?.color ?? '#ff8a65');
  }
  equip(slot: Slot, id: string | null) {
    const d = this.save.data;
    if (id) d.equipped[slot] = id; else delete d.equipped[slot];
    this.applyOutfit();
    this.g.player.cheer();
    this.g.audio.pop(id ? 1 : 0.7);
    this.save.touch();
  }

  // ---------------- map ----------------
  private toggleMap() {
    const d = this.save.data;
    this.g.audio.paper();
    this.map.toggle({ state: d.map.state, n: d.map.n, x: d.map.x, z: d.map.z, hint: d.map.hint, bottle: { x: this.treasure.bottlePos.x, z: this.treasure.bottlePos.z } });
  }

  setGuide(on: boolean) {
    this.guide.enabled = on; this.save.data.guide = on; this.map.guideOn = on; this.save.touch();
    this.g.audio.pop(on ? 1.3 : 0.8);
    this.juice.toast(on ? '✨ Treasure trail on' : 'Treasure trail off <small>(G / map to turn back on)</small>', 1600);
  }

  // ---------------- food ----------------
  private bestFood(sp: Species): { id: FoodId; fav: boolean } | null {
    const t = TASTES[sp], f = this.save.data.food;
    for (const id of t.fav) if ((f[id] ?? 0) > 0) return { id, fav: true };
    for (const id of t.likes) if ((f[id] ?? 0) > 0) return { id, fav: false };
    return null;
  }

  // ---------------- follower trail ----------------
  private recordTrail(p: THREE.Vector3) {
    // followers are land animals: they wait at the waterline while you swim
    if (this.g.player.depth > 0.35) return;
    const last = this.crumbs[0];
    if (!last || last.distanceToSquared(p) > 0.25 * 0.25) { this.crumbs.unshift(p.clone()); if (this.crumbs.length > 140) this.crumbs.pop(); }
  }
  private trail(dist: number, out: THREE.Vector3) {
    const p = this.g.player.position;
    let prev = this.g.player.depth > 0.35 && this.crumbs[0] ? this.crumbs[0] : p, acc = 0;
    for (const c of this.crumbs) {
      const seg = prev.distanceTo(c);
      if (acc + seg >= dist) { const k = (dist - acc) / (seg || 1); return out.copy(prev).lerp(c, k); }
      acc += seg; prev = c;
    }
    return out.copy(prev);
  }

  // ---------------- interaction ----------------
  private findTarget(p: THREE.Vector3): Target | null {
    const tr = this.treasure, st = tr.state;
    if (tr.busy) return null;
    if (st === 'dug' && p.distanceTo(tr.chestPos) < 2.2) return { kind: 'open', icon: '🎁', label: 'Open', key: 'open:chest', pos: tr.chestPos.clone().add(new THREE.Vector3(0, 1.0, 0)), run: () => this.openChest() };
    if (st === 'active') { const sp = tr.spot; if (Math.hypot(p.x - sp.x, p.z - sp.z) < 1.7) return { kind: 'dig', icon: '⛏️', label: 'Dig', key: 'dig:spot', pos: sp.clone().add(new THREE.Vector3(0, 0.6, 0)), run: () => this.dig() }; }
    if (st === 'bottle' && Math.hypot(p.x - tr.bottlePos.x, p.z - tr.bottlePos.z) < 1.8) return { kind: 'take', icon: '🍾', label: 'Take', key: 'take:bottle', pos: tr.bottlePos.clone().add(new THREE.Vector3(0, 0.6, 0)), run: () => this.takeBottle() };
    const sb = this.g.reef.nearestBottle(p.x, p.z, 1.9);
    if (sb) return { kind: 'take', icon: '🍾', label: 'Take Bottle', key: 'take:seabottle', pos: new THREE.Vector3(sb.x, 0.6, sb.z), run: () => this.takeSeaBottle(sb) };
    const an = this.g.fauna.nearestFeedable(p.x, p.z, 2.5);
    if (an) {
      const food = this.bestFood(an.species as Species);
      const full = !an.a.friend && this.g.fauna.friendCount() >= Fauna.MAX_FRIENDS;
      if (food && !full) return { kind: 'feed', icon: FOODS[food.id].icon, label: `Feed ${TASTES[an.species as Species].name}`, key: `feed:${an.species}:${food.id}`, pos: new THREE.Vector3(an.a.x, an.a.y + 0.7, an.a.z), run: () => this.feed(an, food.id, food.fav) };
    }
    const it = this.forage.nearest(p, 1.5);
    if (it) return { kind: 'pick', icon: FOODS[it.id].icon, label: `${FOODS[it.id].sea ? 'Collect' : 'Pick'} ${FOODS[it.id].name}`, key: `pick:${it.id}`, pos: new THREE.Vector3(it.x, it.y + 0.45, it.z), run: () => this.pick(it) };
    return null;
  }

  act() {
    this.g.audio.unlock();
    const t = this.target; if (!t) return;
    t.run();
    this.target = null; this.targetT = 0.15;
  }

  private pick(it: FoodItem) {
    this.forage.pick(it);
    this.g.audio.pick();
    const pos = new THREE.Vector3(it.x, it.y + 0.2, it.z);
    this.juice.pop(pos.clone().add(new THREE.Vector3(0, 0.3, 0)), '+1', 'plus', 0.9, 40);
    // count immediately (never lost if the page closes mid-flight); the badge updates when the icon lands
    const f = this.save.data.food; f[it.id] = (f[it.id] ?? 0) + 1; this.save.touch();
    this.juice.fly(pos, FOODS[it.id].icon, this.panels.bagBtn, () => this.panels.refreshBadges());
  }

  private feed(an: FriendRef, food: FoodId, fav: boolean) {
    const d = this.save.data;
    d.food[food] = Math.max(0, (d.food[food] ?? 0) - 1);
    const pos = new THREE.Vector3(an.a.x, an.a.y + 0.6, an.a.z);
    this.juice.pop(pos, FOODS[food].icon, 'emote', 0.8, 20);
    const res = this.g.fauna.feed(an, fav);
    const t = TASTES[an.species as Species];
    this.g.audio.feed(res === 'friend');
    this.juice.hearts(pos, res === 'friend' ? 7 : res === 'refill' ? 4 : 2);
    if (res === 'friend') { d.friendsMade++; this.g.player.cheer(); this.juice.toast(`${t.icon} <b>${t.name}</b> is following you! <small>(${this.g.fauna.friendCount()}/${Fauna.MAX_FRIENDS})</small>`); }
    else if (res === 'more') this.juice.toast(`${t.icon} ${t.name} liked that! One more…${fav ? '' : ` <small>(favourite: ${t.fav.map((f) => FOODS[f].icon).join(' ')})</small>`}`);
    else this.juice.toast(`${t.icon} ${t.name} is full and happy`);
    this.save.touch(); this.panels.refreshBadges();
  }

  private takeBottle() {
    this.treasure.takeBottle();
    this.g.audio.paper(); this.g.audio.chest(1);
    this.juice.pop(this.treasure.bottlePos.clone().add(new THREE.Vector3(0, 0.8, 0)), '🗺️', 'emote big', 1.6, 60);
    this.juice.toast('🗺️ A treasure map was inside! Press <b>Map</b> to read it.');
    this.save.touch();
    setTimeout(() => this.toggleMap(), 700);
  }

  /** a bottle bobbing on the reef: the treasure map (if you haven't got one yet) or a piece of the seaside set */
  private takeSeaBottle(b: SeaBottle) {
    const d = this.save.data;
    this.g.reef.takeBottle(b);
    this.g.audio.paper(); this.g.audio.chest(1);
    const at = new THREE.Vector3(b.x, 0.9, b.z);
    if (d.map.state === 'none' || d.map.state === 'bottle') {
      this.treasure.takeBottle();
      this.juice.pop(at, '🗺️', 'emote big', 1.6, 60);
      this.juice.toast('🗺️ A treasure map was rolled up inside! Press <b>Map</b> to read it.');
      this.save.touch();
      return;
    }
    // prefer seaside pieces you don't own; rarer ones are rarer
    const pool = SEA_WEAR.map((id) => WEAR_BY_ID.get(id)!).filter((w) => w && !d.owned[w.id]);
    if (pool.length) {
      let tot = 0; for (const w of pool) tot += RARITY[w.rarity].weight;
      let r = Math.random() * tot, item = pool[0];
      for (const w of pool) { if ((r -= RARITY[w.rarity].weight) <= 0) { item = w; break; } }
      d.owned[item.id] = 1; this.lastReward = item.id;
      const rr = RARITY[item.rarity];
      this.g.player.cheer();
      this.juice.pop(at, item.icon, 'emote big', 1.8, 60);
      this.juice.toast(`🍾 A note: “for the swimmer” — <b style="color:${rr.color}">${item.name}</b> (${rr.name}) added to your wardrobe!`, 3600);
    } else {
      d.food.pearl = (d.food.pearl ?? 0) + 1; d.shells += 5;
      this.juice.pop(at, '🦪', 'emote big', 1.6, 60);
      this.juice.toast('🍾 A pearl and <b>+5 🐚</b> were tucked in the bottle');
    }
    this.save.touch(); this.panels.refreshBadges();
  }

  private dig() {
    this.treasure.startDig();
    this.lockMove = 1.1;
    this.g.player.cheer();
    for (const t of [0, 350, 700]) setTimeout(() => this.g.audio.dig(), t);
  }

  private openChest() {
    const d = this.save.data;
    const { item, dup } = this.treasure.roll(d.owned);
    const r = RARITY[item.rarity];
    this.treasure.open(item.rarity);
    this.g.audio.chest(item.rarity + 1);
    this.g.player.cheer();
    d.chests++;
    let extra: string;
    if (dup) { d.shells += r.shells; d.owned[item.id] = (d.owned[item.id] ?? 1) + 1; extra = `Already have it! Turned into <b>+${r.shells} 🐚</b> shells`; }
    else { d.owned[item.id] = 1; extra = '<b>NEW!</b> Added to your wardrobe'; }
    this.lastReward = item.id;
    // a new map was tucked inside the chest
    d.map.n++; d.map.state = 'opened';
    this.save.touch();
    this.pendingReward = () => {
      this.pendingReward = null;
      const card = this.juice.reward(item.icon, item.name, r.name, r.color, extra, () => {
        this.treasure.finish();
        this.treasure.newSpot();
        this.save.touch();
        this.panels.refreshBadges();
        this.juice.toast('🗺️ A new map was tucked inside the chest!');
        this.panels.setMapPulse(true, true);
      });
      card.classList.add('r' + item.rarity);
    };
    this.rewardTimer = window.setTimeout(() => this.pendingReward?.(), this.rewardDelay);
  }

  // ---------------- wardrobe preview camera ----------------
  private setPreview(on: boolean) {
    if (on === this.previewOn) return;
    this.previewOn = on;
    const pl = this.g.player;
    if (on) { this.previewYaw = Math.atan2(this.g.camera.position.x - pl.position.x, this.g.camera.position.z - pl.position.z); pl.previewYaw = this.previewYaw; }
    this.camFrom.copy(this.g.camera.position);
  }
  private updatePreview(dt: number) {
    const target = this.previewOn ? 1 : 0;
    if (this.preview === target && !this.previewOn) return;
    this.preview += (target - this.preview > 0 ? 1 : -1) * Math.min(Math.abs(target - this.preview), dt / 0.55);
    const pl = this.g.player, p = pl.position, cam = this.g.camera;
    const narrow = this.g.isTouch || innerWidth < 900;
    if (this.previewOn) {
      this.previewYaw -= this.g.input.dragDX * 0.01;
      pl.previewYaw = this.previewYaw + Math.sin(performance.now() * 0.0006) * 0.12 * (this.g.input.dragDX ? 0 : 1);
    }
    const yaw = this.previewYaw;
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    // frame the character in the part of the screen the sheet leaves free
    const D = narrow ? 5.4 : 4.0;
    const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)), tanH = tanV * cam.aspect;
    const camPos = p.clone().addScaledVector(fwd, D).add(new THREE.Vector3(0, 1.3, 0));
    const look = p.clone().add(new THREE.Vector3(0, 0.8, 0));
    if (narrow) { const sheetH = Math.min(innerHeight * 0.56, 520) / innerHeight; const ndcY = sheetH; look.y -= ndcY * D * tanV; }
    else { const freeW = innerWidth - 452; const ndcX = (freeW / 2) / innerWidth * 2 - 1; look.addScaledVector(right, -ndcX * D * tanH * 1.0); }
    const k = easeInOut(this.preview);
    const rigPos = cam.position.clone(); // what the orbit rig computed this frame
    const rigLook = this.g.rig.target.clone();
    cam.position.copy(rigPos).lerp(camPos, k);
    this.camLook.copy(rigLook).lerp(look, k);
    cam.lookAt(this.camLook);
    this.g.rig.locked = this.previewOn;
    pl.enabled = !this.previewOn && this.lockMove <= 0;
    if (!this.previewOn && this.preview <= 0) { pl.previewYaw = null; this.g.rig.locked = false; }
  }

  update(dt: number) {
    const g = this.g, p = g.player.position, d = this.save.data;
    this.recordTrail(p);
    this.ctx.px = p.x; this.ctx.py = p.y; this.ctx.pz = p.z; this.ctx.running = g.player.speed > 5.2;
    this.forage.update(dt, p);
    this.treasure.update(dt, p);
    this.guide.update(dt, p, d.map.state === 'active' && !this.treasure.busy ? this.treasure.spot : null);
    if (this.lockMove > 0) { this.lockMove -= dt; g.player.enabled = this.lockMove <= 0 && !this.previewOn; }
    // keyboard action
    if (g.input.pressed.has('e') && !g.build.active) this.act();
    // contextual target
    this.targetT -= dt;
    if (this.targetT <= 0) this.target = g.build.active || this.previewOn ? null : this.findTarget(p);
    const t = this.target;
    this.panels.setAction(t && g.isTouch ? t.icon : null, t?.label ?? '', t?.key ?? '');
    if (!g.isTouch) this.juice.setPrompt(t ? t.pos : null, t ? `<kbd>E</kbd> ${t.label} <span>${t.icon}</span>` : '');
    else this.juice.setPrompt(t ? t.pos : null, t ? `<span>${t.icon}</span>` : '');
    // warmer / colder
    const c = this.treasure.closeness(p);
    this.warmT -= dt;
    if (c > 0 && this.warmT <= 0) { g.audio.warm(c); this.warmT = 2.8 - c * 2.1; }
    this.panels.setMapPulse(c > 0.6 || d.map.state === 'bottle', d.map.state !== 'none');
    this.map.update(p.x, p.z, g.player.facingYaw, c);
    // hungry followers remind you now and then
    this.remindT -= dt;
    if (this.remindT <= 0) {
      this.remindT = 14;
      for (const f of g.fauna.friends()) if (f.a.hunger < 0) { const tt = TASTES[f.species as Species]; this.juice.pop(new THREE.Vector3(f.a.x, (f.a as { y: number }).y + 0.9, f.a.z), `💭${FOODS[tt.fav[0]].icon}`, 'emote', 2.5, 25); }
    }
    // swimming: current ring + a friendly first-time tip
    const pl = g.player;
    const showMeter = pl.swimming && pl.offshoreDist > 7;
    this.swimUi.classList.toggle('show', showMeter);
    if (showMeter) {
      const energy = 1 - pl.current;
      this.swimUi.style.setProperty('--e', energy.toFixed(3));
      this.swimUi.classList.toggle('low', energy < 0.55);
      const lbl = this.swimUi.querySelector('.lbl')!, txt = energy < 0.55 ? 'The current is carrying you back to shore' : energy < 0.95 ? 'Getting tired…' : 'Reef';
      if (lbl.textContent !== txt) lbl.textContent = txt;
    }
    if (pl.swimming && !this.swimTip) { this.swimTip = true; if (!d.swum) { d.swum = true; this.save.touch(); this.juice.toast('🏊 Splash! Swim out over the reef: look for 🐚 shells, 💎 sea glass, ⭐ starfish, 🦪 pearls and drifting 🍾 bottles', 4200); } }
    this.updatePreview(dt);
    this.juice.update(dt);
  }
}
