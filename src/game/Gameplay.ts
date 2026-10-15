import * as THREE from 'three/webgpu';
import type { Game } from '../core/Game';
import type { System } from '../core/System';
import { Save } from './Save';
import { Forage, type FoodItem } from './Forage';
import { Treasure } from './Treasure';
import { Guide } from './Guide';
import { TapWalk, type WalkGoal } from './TapWalk';
import { Dig } from './Dig';
import { Harvest } from './Harvest';
import { Puzzles, stoneChestLoot } from './Puzzles';
import { FriendScreen, ensurePet } from './FriendScreen';
import { WEARABLES, CAVE_WEAR } from './Items';
import { DYES, FOODS, RARITY, SEA_WEAR, TASTES, WEAR_BY_ID, type FoodId, type Slot, type Species } from './Items';
import { Fauna, type FollowCtx, type FriendRef } from '../world/Fauna';
import type { SeaBottle } from '../world/Reef';
import { MapOverlay } from '../ui/MapOverlay';
import { Juice } from '../ui/Juice';
import { Panels } from '../ui/Panels';
import { TapReact } from '../world/TapReact';
import type { Mount } from '../player/Mount';
import { showWhatsNew } from '../ui/whatsnewNote';
import { showEntry, afterEntry, openEntryEditor, player as entryPlayer } from '../ui/Entry';

type Kind = 'open' | 'dig' | 'take' | 'feed' | 'pick' | 'reset';
interface Target { kind: Kind; icon: string; label: string; key: string; pos: THREE.Vector3; run: () => void; }

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Treasure maps, foraging, feeding/followers, wardrobe and saving: the "cozy loop" layer on top of the world. */
export class Gameplay implements System {
  save = new Save();
  forage: Forage;
  treasure: Treasure;
  guide = new Guide();
  walk: TapWalk;
  digger = new Dig();
  harvest!: Harvest;
  puzzles!: Puzzles;
  private digCool = 0; private digMsgT = 0;
  private ray = new THREE.Raycaster();
  map: MapOverlay;
  juice: Juice;
  panels: Panels;
  react: TapReact;
  target: Target | null = null;
  private crumbs: THREE.Vector3[] = [];
  private warmT = 0; private remindT = 10; private targetT = 0;
  private preview = 0; // 0..1 blend into wardrobe camera
  private previewOn = false;
  private previewYaw = 0;
  private camFrom = new THREE.Vector3(); private camLook = new THREE.Vector3();
  private ctx: FollowCtx;
  private lockMove = 0;
  friend!: FriendScreen;
  private careT = 0;
  private swimUi: HTMLDivElement;
  private swimTip = false;
  /** ms between the lid popping and the reward card (tests stretch it to capture the burst) */
  rewardDelay = 750;
  private pendingReward: (() => void) | null = null;
  private rewardTimer = 0;
  mount: Mount | null = null;
  /** wardrobe / friend overlays that should block Call Mount */
  get previewing() { return this.previewOn; }
  get lockMoving() { return this.lockMove > 0; }
  /** show a pending reward card immediately (tests) */
  showRewardNow() { clearTimeout(this.rewardTimer); this.pendingReward?.(); }

  constructor(private g: Game, spawn: THREE.Vector2) {
    const d = this.save.data;
    this.forage = new Forage(g.flora, spawn, g.cave.itemSpots);
    g.scene.add(this.forage.group);
    this.treasure = new Treasure(d, g.flora, spawn);
    g.scene.add(this.treasure.group, this.guide.mesh);
    this.walk = new TapWalk(g.player);
    g.scene.add(this.walk.marker, this.digger.group);
    this.walk.onGiveUp = () => this.juice.pop(g.player.position.add(new THREE.Vector3(0, 1.9, 0)), '🤔', 'emote', 1.2, 20);
    g.input.onStickStart.push(() => this.walk.cancel());
    // build mode: far pieces in remove mode → walk over, then remove
    g.build.onFarRemove = (pos, done) => { this.walk.go({ pos: () => pos, reach: 3.2, key: '', arrive: done }); return true; };
    this.guide.enabled = d.guide !== false;
    const root = document.getElementById('hud') ?? document.body;
    this.map = new MapOverlay(document.body, g.flora);
    this.map.onClose = () => g.audio.paper();
    this.map.onGuide = () => { this.setGuide(!this.guide.enabled); return this.guide.enabled; };
    this.map.guideOn = this.guide.enabled;
    this.juice = new Juice(root, g.camera);
    this.juice.onEquipFromReward = () => { const last = this.lastReward; if (last) { this.equip(WEAR_BY_ID.get(last)!.slot, last); } };
    this.react = new TapReact(g.flora, g.audio, (pos, icon) => this.juice.pop(pos, icon, 'emote', 1.0, 45));
    this.react.bind({ fauna: g.fauna, build: g.build, reef: g.reef, camera: g.camera });
    g.scene.add(this.react.group);
    this.harvest = new Harvest(
      g.flora, g.audio,
      (id, pos, icon) => {
        const f = this.save.data.food; f[id] = (f[id] ?? 0) + 1; this.save.touch();
        this.juice.pop(pos.clone().add(new THREE.Vector3(0, 0.25, 0)), '+1', 'plus', 0.9, 40);
        this.juice.fly(pos, icon, this.panels.bagBtn, () => this.panels.refreshBadges());
      },
      (h, ms) => this.juice.toast(h, ms),
      (pos, icon) => this.juice.pop(pos, icon, 'emote', 1.0, 45),
    );
    g.scene.add(this.harvest.group);
    this.puzzles = new Puzzles(
      g.flora, g.audio,
      (h, ms) => this.juice.toast(h, ms),
      (pos) => {
        const d = this.save.data;
        d.puzzles = { ...(d.puzzles ?? {}), stones: true };
        const loot = stoneChestLoot(d.owned);
        if (loot) {
          d.owned[loot.id] = 1; this.lastReward = loot.id;
          this.juice.pop(pos, loot.icon, 'emote big', 1.8, 60);
          this.g.audio.chest(loot.rarity); this.g.player.cheer();
          this.juice.toast(`🎁 The stone chest held a <b>${loot.name}</b>! ✨ <small>(wardrobe)</small>`, 3200);
        } else {
          d.shells += 8;
          this.juice.pop(pos, '🐚', 'emote big', 1.6, 50);
          this.juice.toast('🎁 The stone chest held <b>+8 🐚</b>!', 2600);
        }
        this.save.touch(); this.panels.refreshBadges();
      },
      !!d.puzzles?.stones,
    );
    g.scene.add(this.puzzles.group);
    this.panels = new Panels(document.body, {
      save: () => this.save.data,
      equip: (slot, id) => this.equip(slot, id),
      buyDye: (id) => { const dy = DYES.find((x) => x.id === id)!; if (d.shells < dy.cost) { this.juice.toast(`Need 🐚 ${dy.cost} shells for ${dy.name}`); return false; } d.shells -= dy.cost; d.dyes.push(id); this.g.audio.pop(1.5); this.save.touch(); return true; },
      setDye: (id) => { d.dye = id; this.applyOutfit(); this.g.audio.pop(1.2); this.save.touch(); },
      friends: () => this.g.fauna.friends().map((f) => ({ species: f.species, hunger: f.a.hunger, name: ensurePet(d, this.g.fauna.keyOf(f), f.species).name })),
      visit: (i) => { const f = this.g.fauna.friends()[i]; if (f) { this.panels.toggle(null); this.friend.show(f); } },
      dismiss: (i) => { const f = this.g.fauna.friends()[i]; if (f) { this.g.fauna.dismiss(f); this.juice.pop(new THREE.Vector3(f.a.x, f.a.y + 0.9, f.a.z), '👋', 'emote', 1.6, 40); } },
      sheet: (k) => { this.setPreview(k === 'wardrobe'); this.save.touch(); if (!k) this.panels.refreshBadges(); },
      map: () => this.toggleMap(),
      ui: () => this.g.audio.ui(),
      trade: (id) => { const n = d.food[id] ?? 0, f = FOODS[id]; if (!n || !f.trade) return; const got = n * (f.trade ?? 1); d.food[id] = 0; d.shells += got; this.g.audio.pop(1.6); this.juice.toast(`Traded ${n} ${f.icon} for <b>+${got} 🐚</b>`); this.save.touch(); this.panels.refreshBadges(); },
    }, g.isTouch);
    // swim stamina / current ring (shown when you're far out)
    this.swimUi = document.createElement('div');
    this.swimUi.className = 'swim-meter';
    this.swimUi.innerHTML = '<div class="ring"><span>🏊</span></div><div class="lbl"></div>';
    root.appendChild(this.swimUi);
    this.panels.onAction = () => this.act();
    // friend close-up screen
    this.friend = new FriendScreen(g, {
      save: () => this.save.data,
      touch: () => { this.syncFollowers(); this.save.touch(); },
      toast: (h) => this.juice.toast(h),
      grantWear: (id) => {
        const w = WEAR_BY_ID.get(id)!;
        if (d.owned[id]) { d.owned[id]++; d.shells += RARITY[w.rarity].shells; this.save.touch(); return false; }
        d.owned[id] = 1; this.lastReward = id; this.save.touch(); this.panels.refreshBadges(); return true;
      },
      refreshBadges: () => this.panels.refreshBadges(),
    });
    // restore followers from the last session, gathered around you
    (d.followers ?? []).forEach((k, i) => {
      const ref = g.fauna.byKey(k); if (!ref) return;
      const pet = ensurePet(d, k, ref.species), p0 = g.player.position, an = i * 1.1 + 2.4;
      g.fauna.befriend(ref, Math.max(60, pet.hunger ?? 300), p0.x + Math.cos(an) * (1.6 + i * 0.4), p0.z + Math.sin(an) * (1.6 + i * 0.4));
    });
    // contextual action from a tap/click near the target
    g.input.onClick.push((e, drag) => {
      if (drag || g.build.active || e.button !== 0 || this.previewOn || this.lockMove > 0 || this.friend.open) return;
      g.audio.unlock();
      // mount: tap the waiting eagle to hop on, or tap the ground while riding to glide there
      if (this.mount?.active) {
        const used = this.mount.onTap(e.clientX, e.clientY, (v) => this.juice.project(v), (cx, cy) => {
          const r = g.renderer.renderer.domElement.getBoundingClientRect();
          const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
          this.ray.setFromCamera(ndc, g.camera);
          return g.terrain.raycast(this.ray.ray.origin, this.ray.ray.direction);
        }, g.isTouch ? 80 : 64);
        if (used) { this.walk.cancel(false); return; }
      }
      // tapping a follower opens its close-up friend screen
      const fr = this.friendAt(e.clientX, e.clientY);
      if (fr) { this.walk.cancel(false); this.friend.show(fr); return; }
      // seasonal tap reactions (ghosts giggle + twirl, jack-o'-lanterns flare)
      if (g.dress?.tapAt(e.clientX, e.clientY, (v) => this.juice.project(v), g.isTouch ? 70 : 56)) { this.walk.cancel(false); return; }
      const lim = g.isTouch ? 70 : 56;
      const proj = (v: THREE.Vector3) => this.juice.project(v);
      // animal hop/startle (skips followers — FriendScreen already handled above); plays alongside feed walks
      const animalHit = this.react.tapAnimal(e.clientX, e.clientY, proj, lim, g.player.position);
      // flora sway / petal burst + rock wobble; does not steal chest/animal taps
      const floraHit = this.react.tapAt(e.clientX, e.clientY, proj, lim, g.player.position);
      // wood chop / fruit pick on tree taps (within range)
      if (floraHit && this.react.lastSpot) this.harvest.onTreeTap(this.react.lastSpot, g.player.position);
      // placed build props squash-bounce
      const propHit = this.react.tapProp(e.clientX, e.clientY, proj, lim, g.player.position);
      // tapping the thing you're already next to uses it right away
      if (this.target) {
        const s = this.juice.project(this.target.pos);
        if (Math.hypot(s.x - e.clientX, s.y - e.clientY) < (g.isTouch ? 64 : 56)) { this.walk.cancel(false); this.act(); return; }
      }
      this.tapAt(e.clientX, e.clientY);
      // water ripples only when the tap didn't land on a solid reactable / interactable walk goal
      // water ripples when the tap isn't squarely on flora/rock/prop (animals may splash themselves)
      if (floraHit !== 'core' && propHit !== 'core') {
        this.react.tapWater(e.clientX, e.clientY, proj, lim, g.player.position, g.renderer.renderer.domElement);
      }
      // tap squarely on a reactable (and nothing to pick there): react in place instead of walking into it
      if ((animalHit === 'core' || floraHit === 'core' || propHit === 'core') && (!this.walk.goal || !this.walk.goal.key)) this.walk.cancel(false);
    });
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (this.friend?.open) return;
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
    window.addEventListener('beforeunload', () => { this.syncFollowers(); this.save.flush(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.syncFollowers(); this.save.flush(); } });
    // Entry (name + DOB) first; What's new waits until it closes. Mounts wire in via bindMount.
    showEntry({
      audio: this.g.audio,
      toast: (h, ms) => this.juice.toast(h, ms),
      onChange: (p) => this.g.hud.setPlayerName(p.name),
    });
    this.g.hud.setPlayerName(entryPlayer.name);
    this.g.hud.bindPlayer(() => openEntryEditor({
      audio: this.g.audio,
      toast: (h, ms) => this.juice.toast(h, ms),
      onChange: (p) => this.g.hud.setPlayerName(p.name),
    }));
    afterEntry(() => setTimeout(() => showWhatsNew(this.g.audio), 400));
  }

  bindMount(m: Mount) {
    this.mount = m;
  }

  get followCtx() { return this.ctx; }

  /** remember who follows you (restored on reload) */
  syncFollowers() {
    const g = this.g, d = this.save.data;
    const keys = g.fauna.friends().map((f) => g.fauna.keyOf(f));
    for (const f of g.fauna.friends()) ensurePet(d, g.fauna.keyOf(f), f.species).hunger = f.a.hunger;
    if (keys.join() !== (d.followers ?? []).join()) { d.followers = keys; this.save.touch(); }
  }

  /** follower under a screen point (generous radius), nearest first */
  friendAt(cx: number, cy: number): FriendRef | null {
    const lim = this.g.isTouch ? 72 : 56, v = new THREE.Vector3();
    const up: Record<string, number> = { bunny: 0.3, deer: 0.9, duck: 0.22, crab: 0.12, bird: 0 };
    let best: FriendRef | null = null, bd = lim;
    for (const f of this.g.fauna.friends()) {
      const s = this.juice.project(v.set(f.a.x, f.a.y + (up[f.species] ?? 0.3), f.a.z));
      const dd = Math.hypot(s.x - cx, s.y - cy);
      if (dd < bd) { bd = dd; best = f; }
    }
    return best;
  }

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
    const th = this.g.dress?.target(p);
    if (th) return th as Target;
    const pz = this.puzzles?.target(p);
    if (pz) return pz as Target;
    if (this.g.cave.inside) {
      // underground: the mole, and cave finds
      const mo = this.g.cave.mole;
      if (mo.up > 0.5 && Math.hypot(p.x - mo.x, p.z - mo.z) < 2.1) {
        const d = this.save.data, food = (['worm', 'bug'] as FoodId[]).find((f) => (d.food[f] ?? 0) > 0);
        const pos = new THREE.Vector3(mo.x, mo.y + 0.8, mo.z);
        if (food) return { kind: 'feed', icon: FOODS[food].icon, label: 'Feed Mole', key: `feed:mole:${food}`, pos, run: () => this.feedMole(food) };
        return { kind: 'feed', icon: '🐾', label: 'Pet Mole', key: 'feed:mole:pet', pos, run: () => this.feedMole(null) };
      }
      const ci = this.forage.nearest(p, 1.5);
      return ci ? { kind: 'pick', icon: FOODS[ci.id].icon, label: `Collect ${FOODS[ci.id].name}`, key: `pick:${ci.id}`, pos: new THREE.Vector3(ci.x, ci.y + 0.45, ci.z), run: () => this.pick(ci) } : null;
    }
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

  /** tap / click on the world: walk to an interactable (and use it on arrival) or to the ground spot */
  tapAt(cx: number, cy: number) {
    const g = this.g, r = g.renderer.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, g.camera);
    const o = this.ray.ray.origin, dir = this.ray.ray.direction;
    if (g.cave.inside) {
      const hit = this.ray.intersectObject(g.cave.floorMesh, false)[0];
      if (!hit) return false;
      const cpt = hit.point;
      const goal = this.pickGoal(cpt, cx, cy) ?? { pos: () => ({ x: cpt.x, z: cpt.z }), reach: 0.3, key: '' };
      this.walk.go(goal); return true;
    }
    const ground = g.terrain.raycast(o, dir);
    let pt = ground;
    if (dir.y < 0) { const t = (0.02 - o.y) / dir.y, wp = o.clone().addScaledVector(dir, t); if (!pt || (pt.y < 0 && wp.distanceTo(o) < pt.distanceTo(o))) pt = wp; }
    if (!pt) return false;
    const goal = this.pickGoal(pt, cx, cy) ?? { pos: () => ({ x: pt!.x, z: pt!.z }), reach: 0.3, key: '' };
    this.walk.go(goal);
    return true;
  }

  /** nearest interactable around the tapped point (by screen distance), as a walk goal that acts on arrival */
  private pickGoal(pt: THREE.Vector3, cx: number, cy: number): WalkGoal | null {
    const g = this.g, tr = this.treasure, st = tr.state, lim = g.isTouch ? 80 : 60;
    const cands: { key: string; pos: () => { x: number; z: number }; y: number; reach: number }[] = [];
    for (const it of this.forage.items) if (it.active && it.t >= 0.9 && Math.hypot(it.x - pt.x, it.z - pt.z) < 3.5 && Math.abs(it.y - pt.y) < 3) cands.push({ key: `pick:${it.id}`, pos: () => it, y: it.y + 0.15, reach: 0.9 });
    if (g.cave.inside) { const mo = g.cave.mole; if (Math.hypot(mo.x - pt.x, mo.z - pt.z) < 2.5) cands.push({ key: 'feed:', pos: () => mo, y: mo.y + 0.4, reach: 1.5 }); }
    else {
    if (st === 'bottle') cands.push({ key: 'take:bottle', pos: () => tr.bottlePos, y: tr.bottlePos.y + 0.2, reach: 1.1 });
    if (st === 'dug') cands.push({ key: 'open:chest', pos: () => tr.chestPos, y: tr.chestPos.y + 0.4, reach: 1.4 });
    if (st === 'active' && Math.hypot(tr.spot.x - pt.x, tr.spot.z - pt.z) < 2.5) cands.push({ key: 'dig:spot', pos: () => tr.spot, y: tr.spot.y + 0.1, reach: 0.9 });
    for (const b of g.reef.bottles) if (b.active) cands.push({ key: 'take:seabottle', pos: () => b, y: 0.1, reach: 1.1 });
    const an = g.fauna.nearestFeedable(pt.x, pt.z, 2.2);
    if (an && this.bestFood(an.species as Species)) cands.push({ key: 'feed:', pos: () => an.a, y: an.a.y + 0.4, reach: 1.6 });
    }
    let best: (typeof cands)[0] | null = null, bd = lim;
    const v = new THREE.Vector3();
    for (const c of cands) {
      const p = c.pos(); const s = this.juice.project(v.set(p.x, c.y, p.z));
      const d = Math.hypot(s.x - cx, s.y - cy);
      if (d < bd) { bd = d; best = c; }
    }
    if (!best) return null;
    const want = best.key;
    return {
      pos: best.pos, reach: best.reach, key: want,
      arrive: () => {
        const t = this.findTarget(g.player.position);
        // picks must be the same item type; other actions just need the same kind (the animal may have shuffled)
        const kind = want.split(':')[0];
        if (t && (kind === 'pick' ? t.key === want : t.kind === kind)) { this.target = t; this.act(); }
      },
    };
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
    if (it.id === 'geode') this.crackGeode(pos);
  }

  /** geodes sometimes hold a piece of the cave set (the first one always does) */
  private crackGeode(pos: THREE.Vector3) {
    const d = this.save.data;
    d.geodes = (d.geodes ?? 0) + 1;
    if (d.geodes > 1 && Math.random() > 0.3) return;
    this.giveCaveWear(pos, d.geodes === 1 ? 'crystalneck' : null, 'Cracked open the geode…');
  }
  /** theme collectibles (candy) */
  get candy() { return this.save.data.candy ?? 0; }
  addCandy(n: number, pos: THREE.Vector3, icon = '🍬') {
    const d = this.save.data; d.candy = Math.max(0, (d.candy ?? 0) + n); this.save.touch();
    if (n > 0) { this.juice.pop(pos.clone().add(new THREE.Vector3(0, 0.5, 0)), `${icon} +${n}`, 'emote', 1.2, 40); this.g.audio.pop(1.8); }
  }
  toast(h: string, ms?: number) { this.juice.toast(h, ms); }
  emote(pos: THREE.Vector3, icon: string) { this.juice.pop(pos, icon, 'emote', 1.2, 40); }
  /** give a not-yet-owned wearable from a themed set (null if all owned) */
  giveThemeWear(pos: THREE.Vector3, ids: string[], why: string): boolean {
    const d = this.save.data;
    const pool = ids.filter((id) => !d.owned[id]);
    const id = pool[Math.floor(Math.random() * pool.length)];
    if (!id) return false;
    const w = WEAR_BY_ID.get(id)!;
    d.owned[id] = 1; this.lastReward = id;
    this.juice.pop(pos.clone().add(new THREE.Vector3(0, 0.6, 0)), w.icon, 'emote big', 1.8, 60);
    this.g.audio.chest(w.rarity); this.g.player.cheer();
    this.juice.toast(`${why} <b style="color:${RARITY[w.rarity].color}">${w.name}</b>! ✨ <small>(in your wardrobe)</small>`, 3200);
    this.save.touch(); this.panels.refreshBadges();
    return true;
  }
  private giveCaveWear(pos: THREE.Vector3, prefer: string | null, why: string) {
    const d = this.save.data;
    const pool = CAVE_WEAR.filter((id) => !d.owned[id]);
    const id = prefer && !d.owned[prefer] ? prefer : pool[Math.floor(Math.random() * pool.length)];
    if (!id) { d.shells += 5; this.juice.toast(`${why} <b>+5 🐚</b>`); return; }
    const w = WEAR_BY_ID.get(id)!;
    d.owned[id] = 1; this.lastReward = id;
    setTimeout(() => {
      this.juice.pop(pos.clone().add(new THREE.Vector3(0, 0.6, 0)), w.icon, 'emote big', 1.8, 60);
      this.g.audio.chest(w.rarity); this.g.player.cheer();
      this.juice.toast(`${why} <b style="color:${RARITY[w.rarity].color}">${w.name}</b>! ✨ <small>(in your wardrobe)</small>`, 3200);
      this.save.touch(); this.panels.refreshBadges();
    }, 450);
  }
  /** the friendly mole: loves worms and beetles; says thanks with cave treasures */
  private feedMole(food: FoodId | null) {
    const g = this.g, mo = g.cave.mole, d = this.save.data;
    const pos = new THREE.Vector3(mo.x, mo.y + 0.7, mo.z);
    mo.joy = 1.4;
    if (!food) {
      g.audio.pop(1.4); this.juice.hearts(pos, 2);
      this.juice.toast('🐾 The mole sniffs your bag hopefully… it loves <b>worms 🪱</b> and <b>beetles 🐞</b> — dig for some!', 3200);
      return;
    }
    d.food[food] = Math.max(0, (d.food[food] ?? 0) - 1);
    this.juice.pop(pos, FOODS[food].icon, 'emote', 0.8, 20);
    g.audio.feed(true); this.juice.hearts(pos, 6);
    mo.fed++; d.moleFed = (d.moleFed ?? 0) + 1;
    if (d.moleFed === 1) this.giveCaveWear(pos, 'minerhelmet', '🐾 The mole digs up a gift:');
    else if (Math.random() < 0.25) this.giveCaveWear(pos, null, '🐾 The mole digs up a gift:');
    else { d.food.geode = (d.food.geode ?? 0) + 1; this.juice.fly(pos, '🪨', this.panels.bagBtn, () => this.panels.refreshBadges()); this.juice.toast('🐾 Munch munch! The mole pushes a <b>geode 🪨</b> your way'); }
    this.save.touch(); this.panels.refreshBadges();
  }

  // ---------------- cave ----------------
  private caveCool = 0;
  private fadeEl: HTMLElement | null = null;
  /** walk into the arch / back out of the tunnel: soft fade, then swap worlds */
  caveTransition(enter: boolean, instant = false) {
    const g = this.g, c = g.cave;
    this.walk.cancel(false); this.mount?.dropNow(); this.caveCool = 2;
    const swap = () => {
      g.setCave(enter);
      if (enter) { const e = c.entry; g.player.teleport(e.x, e.z, e.facing); g.rig.yaw = e.facing + Math.PI; g.rig.pitch = 0.32; }
      else { const o = c.outsideSpot; g.player.teleport(o.x, o.z, o.facing); g.rig.yaw = o.facing + Math.PI; g.rig.pitch = 0.35; }
      g.rig.target.copy(g.player.position).add(new THREE.Vector3(0, 1.1, 0)); g.rig.apply();
      g.audio.cave(enter);
      if (enter && !this.save.data.caved) { this.save.data.caved = true; this.save.touch(); setTimeout(() => this.juice.toast('🔮 <b>Crystal Cave</b> — crystals, glowcaps, geodes and a shy friend live down here', 3600), 600); }
    };
    if (instant) { swap(); return; }
    if (!this.fadeEl) { this.fadeEl = document.createElement('div'); this.fadeEl.className = 'cave-fade'; document.body.appendChild(this.fadeEl); }
    const f = this.fadeEl; this.lockMove = 0.9;
    f.classList.add('on');
    setTimeout(() => { swap(); requestAnimationFrame(() => f.classList.remove('on')); }, 380);
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
    if (res === 'friend') this.syncFollowers();
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

  /** shovel: dig right in front of you. At the map's X it digs up the chest; elsewhere a hole and maybe a find. */
  shovel() {
    const g = this.g, d = this.save.data, pl = g.player;
    if (this.lockMove > 0 || this.previewOn || g.build.active || this.digCool > 0 || pl.swimming || pl.mounted) return false;
    if (g.cave.inside) { if (this.digMsgT <= 0) { this.juice.toast('🪨 The cave floor is solid rock', 1300); this.digMsgT = 2; } g.audio.pop(0.55); this.digCool = 0.5; return false; }
    this.walk.cancel(false);
    const p = pl.position, f = pl.facingYaw;
    const x = p.x + Math.sin(f) * 0.75, z = p.z + Math.cos(f) * 0.75;
    const tr = this.treasure;
    if (tr.state === 'active' && !tr.busy && Math.hypot(tr.spot.x - x, tr.spot.z - z) < 1.9) { this.dig(); this.digCool = 1.2; return true; }
    const c = this.digger.check(x, z, (bx, bz) => g.build.occupiedAt(bx, bz));
    if (!c.ok) {
      this.digCool = 0.5;
      g.audio.pop(0.55);
      if (this.digMsgT <= 0) { this.juice.toast(c.why, 1300); this.digMsgT = 2; }
      return false;
    }
    this.digCool = 0.95; this.lockMove = 0.75;
    pl.cheer();
    g.audio.dig(); setTimeout(() => g.audio.dig(), 300);
    const surface = c.surface;
    setTimeout(() => {
      this.digger.hole(x, z, surface, f + Math.PI / 2);
      this.friend.dirtyNear(x, z, 0.08);
      d.digs = (d.digs ?? 0) + 1;
      const owned = WEARABLES.filter((w) => d.owned[w.id]).length;
      const find = this.digger.roll(x, z, surface, owned, WEARABLES.length);
      const at = new THREE.Vector3(x, heightAt0(this.g, x, z) + 0.35, z);
      if (find.kind === 'item') {
        const fd = FOODS[find.id];
        d.food[find.id] = (d.food[find.id] ?? 0) + find.n;
        this.juice.pop(at.clone().add(new THREE.Vector3(0, 0.4, 0)), `+${find.n}`, 'plus', 0.9, 40);
        this.juice.fly(at, fd.icon, this.panels.bagBtn, () => this.panels.refreshBadges());
        g.audio.pick();
        this.juice.toast(`🪏 Dug up ${find.n > 1 ? find.n + '× ' : 'a '}${fd.icon} <b>${fd.name}</b>!`, 1700);
        this.lastFind = find.id;
      } else if (find.kind === 'coins') {
        d.shells += find.n;
        this.juice.pop(at, `+${find.n} 🐚`, 'plus', 1.1, 40);
        g.audio.chest(0);
        this.juice.toast(`🪏 Buried shells! <b>+${find.n} 🐚</b>`, 1500);
        this.lastFind = 'coins';
      } else if (find.kind === 'wearable') {
        const pool = WEARABLES.filter((w) => !d.owned[w.id] && w.rarity <= 1 && !CAVE_WEAR.includes(w.id));
        const item = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
        if (item) {
          d.owned[item.id] = 1; this.lastReward = item.id;
          this.juice.pop(at.clone().add(new THREE.Vector3(0, 0.3, 0)), item.icon, 'emote big', 1.8, 60);
          g.audio.chest(2); pl.cheer();
          this.juice.toast(`🪏 Something buried! <b style="color:${RARITY[item.rarity].color}">${item.name}</b> added to your wardrobe`, 3000);
          this.lastFind = item.id;
        }
      } else {
        this.juice.pop(at, '…', 'emote', 1, 15);
        this.lastFind = 'nothing';
      }
      this.save.touch(); this.panels.refreshBadges();
    }, 480);
    return true;
  }
  /** last free-dig result (tests) */
  lastFind: string | null = null;

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
    if (!g.cave.inside && !g.player.mounted) this.recordTrail(p);
    this.ctx.px = p.x; this.ctx.py = p.y; this.ctx.pz = p.z; this.ctx.running = g.player.speed > 5.2;
    this.walk.update(dt);
    // friends get dusty / hungry over time; remember who follows you
    this.careT += dt;
    if (this.careT >= 1) {
      const fr = g.fauna.friends();
      this.friend.care(this.careT, fr, g.player.swimming);
      this.syncFollowers();
      this.careT = 0; this.save.touch();
    }
    // cave doors
    this.caveCool -= dt;
    { const c = g.cave;
      if (this.caveCool <= 0 && this.lockMove <= 0 && !g.player.mounted) {
        if (!c.inside) { const dp = c.doorPt; if (Math.hypot(p.x - dp.x, p.z - dp.z) < 1.15 && Math.abs(p.y - c.mouth.y) < 2.2) this.caveTransition(true); }
        else { const ep = c.exitPt; if (Math.hypot(p.x - ep.x, p.z - ep.z) < 1.3) this.caveTransition(false); }
      }
    }
    this.forage.update(dt, p);
    this.treasure.update(dt, p);
    this.guide.update(dt, p, d.map.state === 'active' && !this.treasure.busy && !g.cave.inside ? this.treasure.spot : null);
    if (this.lockMove > 0) { this.lockMove -= dt; g.player.enabled = this.lockMove <= 0 && !this.previewOn; }
    // keyboard action
    if (g.input.pressed.has('e') && !g.build.active && !g.player.mounted) this.act();
    if (g.input.pressed.has('v') && !this.friend.open) this.mount?.press();
    // shovel: F / Dig button, hold to keep digging
    this.digCool -= dt; this.digMsgT -= dt;
    if ((g.input.pressed.has('f') || g.input.keys.has('f')) && !g.build.active) this.shovel();
    this.digger.update(dt);
    this.harvest.update(dt);
    this.puzzles.sense(p, dt);
    this.puzzles.update(dt);
    // contextual target
    this.targetT -= dt;
    if (this.targetT <= 0) this.target = g.build.active || this.previewOn || g.player.mounted ? null : this.findTarget(p);
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
    this.react.update(dt);
    this.juice.update(dt);
  }
}

function heightAt0(g: Game, x: number, z: number) { return g.heightAt(x, z); }
