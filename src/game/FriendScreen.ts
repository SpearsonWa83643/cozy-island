import * as THREE from 'three/webgpu';
import type { Game } from '../core/Game';
import type { FriendRef } from '../world/Fauna';
import { Biome, BIOME_COUNT } from '../world/Biomes';
import { biomeWeights } from '../world/Terrain';
import { FOODS, TASTES, WEAR_BY_ID, RARITY, type FoodId, type Species } from './Items';
import type { SaveData, PetData } from './Save';
import { ensurePet, needFor } from './FriendPet';
export { ensurePet, needFor } from './FriendPet';
import { buildRig, dirtGeo, dirtMat, type Rig } from './FriendModel';

const STUDIO = new THREE.Vector3(0, 420, 0);
type Mode = 'pet' | 'clean' | 'feed';

const GIFT: Record<string, string> = { bunny: 'flower', deer: 'leafwings', duck: 'floatie', crab: 'shellneck', bird: 'butterfly', fox: 'leafwings', goat: 'flower' };
const TRICKS: Record<string, { name: string; icon: string }> = { spin: { name: 'Spin', icon: '🌀' }, dance: { name: 'Happy Dance', icon: '💃' } };
const BASE_YAW: Record<string, number> = { bunny: -0.35, deer: -0.75, duck: -0.45, crab: -0.15, bird: -0.4, fox: -0.55, goat: -0.6 };


interface Dirt { mesh: THREE.Mesh; p: THREE.Vector3; n: THREE.Vector3; r: number; dirt: number }

export interface FriendHost {
  save: () => SaveData;
  touch: () => void;
  toast: (html: string) => void;
  /** grant a wearable (returns false when it was a duplicate turned into shells) */
  grantWear: (id: string) => boolean;
  refreshBadges: () => void;
}

/**
 * Close-up friend screen: the follower in a cozy little studio (the world is paused and hidden behind a soft
 * bokeh backdrop). Pet / clean by dragging on it, feed from the bag, trigger tricks; lively idle reactions.
 */
export class FriendScreen {
  open = false;
  ref: FriendRef | null = null;
  key = '';
  pet: PetData | null = null;
  mode: Mode = 'pet';
  stats = { purr: 0, giggle: 0, quirk: 0, blink: 0, eat: 0, dislike: 0, shake: 0, sleepy: 0, levelUp: 0, trick: 0, hearts: 0, look: 0 };
  private el: HTMLDivElement;
  private stage: HTMLDivElement;
  private fx: HTMLDivElement;
  private cursor: HTMLDivElement;
  private tray: HTMLDivElement;
  private hint: HTMLDivElement;
  private studio = new THREE.Group();
  private backdrop: THREE.Mesh;
  private bokeh: THREE.Mesh[] = [];
  private shadow: THREE.Mesh;
  private rig: Rig | null = null;
  private dirt: Dirt[] = [];
  private hidden: THREE.Object3D[] = [];
  private saved = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), bg: null as THREE.Scene['background'] };
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2(0, 0);
  private ptr = { down: false, id: -1, x: 0, y: 0, sx: 0, sy: 0, t0: 0, moved: 0, hit: false, hitT: 0, last: 0, speed: 0, seen: 0 };
  private hitLocal = new THREE.Vector3();
  private t = 0;
  private inFlight = false;
  // animation state
  private a = { hop: 0, hopDur: 0.45, spin: 0, quirk: 0, wiggle: 0, headShake: 0, shakeOff: 0, eat: 0, ear: 0, tail: 0, flap: 0, click: 0, dance: 0, blink: 0, nextBlink: 2, nextIdle: 3, lean: 0, tilt: 0, closed: 0, yawL: 0, pitchL: 0, sleepy: false, petTime: 0, idleSince: 0, purrT: 0, heartT: 0, bubbleT: 0, scrubT: 0, giggleCd: 0, fastT: 0, zT: 0, earSide: 0, startDirty: false, tapLove: 0, yawn: 0 };

  constructor(private g: Game, private host: FriendHost) {
    // ---- studio ----
    const geo = new THREE.SphereGeometry(40, 32, 20);
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
    const bm = new THREE.MeshBasicNodeMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false }); bm.fog = false;
    this.backdrop = new THREE.Mesh(geo, bm); this.backdrop.renderOrder = -10;
    this.studio.add(this.backdrop);
    const soft = radialTex();
    for (let i = 0; i < 22; i++) {
      const mm = new THREE.MeshBasicNodeMaterial({ map: soft, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6 }); mm.fog = false;
      const b = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mm);
      const s = 1.5 + Math.random() * 4;
      b.scale.set(s, s, 1); b.position.set((Math.random() - 0.5) * 30, -1 + Math.random() * 12, -10 - Math.random() * 14);
      b.userData = { ph: Math.random() * 6.28, y: b.position.y, x: b.position.x };
      b.renderOrder = -5;
      this.bokeh.push(b); this.studio.add(b);
    }
    const floorM = new THREE.MeshBasicNodeMaterial({ map: soft, transparent: true, depthWrite: false, opacity: 0.55, color: '#fff6e6' }); floorM.fog = false;
    const floor = new THREE.Mesh(new THREE.CircleGeometry(4.5, 40), floorM); floor.rotation.x = -Math.PI / 2; floor.position.y = 0.001; floor.renderOrder = -4;
    this.studio.add(floor);
    const shM = new THREE.MeshBasicNodeMaterial({ map: soft, transparent: true, depthWrite: false, opacity: 0.45, color: '#3a2a1a' }); shM.fog = false;
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 28), shM); this.shadow.rotation.x = -Math.PI / 2; this.shadow.position.y = 0.01; this.shadow.renderOrder = -3;
    this.studio.add(this.shadow);
    const key = new THREE.PointLight('#fff1d6', 60, 0, 2); key.position.set(2.2, 3.4, 4.2);
    const rim = new THREE.PointLight('#bfe4ff', 40, 0, 2); rim.position.set(-2.4, 2.8, -2.6);
    const fill = new THREE.PointLight('#ffd6e8', 14, 0, 2); fill.position.set(-3, 1.2, 3);
    this.studio.add(key, rim, fill);
    this.studio.position.copy(STUDIO);
    this.studio.visible = false;
    g.scene.add(this.studio);

    // ---- DOM ----
    const el = this.el = document.createElement('div');
    el.className = 'friend-screen';
    el.innerHTML = `
      <div class="fs-stage"></div>
      <div class="fs-card">
        <div class="fs-namerow"><span class="fs-icon"></span><button class="fs-name" aria-label="Rename"></button><input class="fs-input" maxlength="14" aria-label="Name" /></div>
        <div class="fs-sub"><span class="fs-species"></span> · <b class="fs-lvl"></b><span class="fs-tricks"></span></div>
        <div class="fs-meter love"><i>💗</i><div class="bar"><b></b></div><span class="v"></span></div>
        <div class="fs-meter food"><i>🍎</i><div class="bar"><b></b></div><span class="v"></span></div>
        <div class="fs-meter clean"><i>🫧</i><div class="bar"><b></b></div><span class="v"></span></div>
      </div>
      <button class="fs-close" aria-label="Close">✕</button>
      <div class="fs-hint"></div>
      <div class="fs-tray"></div>
      <div class="fs-tools">
        <button class="fs-tool" data-mode="pet"><i>🤚</i><span>Pet</span></button>
        <button class="fs-tool" data-mode="clean"><i>🧽</i><span>Clean</span></button>
        <button class="fs-tool" data-mode="feed"><i>🍎</i><span>Feed</span></button>
        <button class="fs-tool trick" data-mode="trick"><i>✨</i><span>Trick</span></button>
      </div>
      <div class="fs-cursor"></div>
      <div class="fs-fx"></div>
      <div class="fs-fade"></div>`;
    document.body.appendChild(el);
    this.stage = el.querySelector('.fs-stage')!;
    this.fx = el.querySelector('.fs-fx')!;
    this.cursor = el.querySelector('.fs-cursor')!;
    this.tray = el.querySelector('.fs-tray')!;
    this.hint = el.querySelector('.fs-hint')!;
    el.querySelector('.fs-close')!.addEventListener('click', () => this.hide());
    for (const b of el.querySelectorAll<HTMLButtonElement>('.fs-tool')) b.addEventListener('click', (e) => { e.stopPropagation(); this.tool(b.dataset.mode!); });
    const nameBtn = el.querySelector<HTMLButtonElement>('.fs-name')!, input = el.querySelector<HTMLInputElement>('.fs-input')!;
    nameBtn.addEventListener('click', () => { el.classList.add('renaming'); input.value = this.pet?.name ?? ''; input.focus(); input.select(); });
    const commit = () => {
      if (!el.classList.contains('renaming')) return;
      el.classList.remove('renaming');
      const v = input.value.replace(/[<>]/g, '').trim().slice(0, 14);
      if (v && this.pet) { this.pet.name = v; this.host.touch(); this.g.audio.pop(1.3); this.react('hop'); }
      this.refresh();
    };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') commit(); if (e.key === 'Escape') { el.classList.remove('renaming'); } });
    input.addEventListener('blur', commit);
    window.addEventListener('keydown', (e) => { if (this.open && e.key === 'Escape' && !el.classList.contains('renaming')) this.hide(); });
    const st = this.stage;
    st.addEventListener('pointerdown', (e) => this.down(e));
    st.addEventListener('pointermove', (e) => this.move(e));
    st.addEventListener('pointerup', (e) => this.up(e));
    st.addEventListener('pointercancel', (e) => this.up(e));
    st.addEventListener('pointerleave', () => { if (!this.ptr.down) this.cursor.classList.remove('show'); });
    st.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ---------------- open / close ----------------
  show(ref: FriendRef) {
    if (this.open) return;
    const g = this.g, d = this.host.save();
    this.ref = ref; this.key = g.fauna.keyOf(ref);
    this.pet = ensurePet(d, this.key, ref.species);
    this.open = true;
    this.mode = 'pet';
    this.el.classList.add('open', 'fading');
    document.body.classList.add('friend-open');
    window.setTimeout(() => this.el.classList.remove('fading'), 380);
    // build the creature
    const rig = this.rig = buildRig(ref.species, g.fauna.colorOf(ref));
    rig.root.rotation.y = BASE_YAW[ref.species] ?? -0.3;
    this.studio.add(rig.root);
    for (const o of [...rig.ears, ...(rig.tail ? [rig.tail] : []), ...rig.wings, ...rig.claws]) o.userData.r0 = o.rotation.clone();
    // dirt blobs from the saved cleanliness
    this.dirt = [];
    const n = rig.dirtSpots.length, want = (1 - this.pet.clean) * n;
    rig.dirtSpots.forEach((s, i) => {
      const mesh = new THREE.Mesh(dirtGeo, dirtMat);
      mesh.position.copy(s.p).addScaledVector(s.n, 0.01);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), s.n);
      rig.dirtParent.add(mesh); rig.pickables.push(mesh);
      // spread the dirt so a few spots are full and one partial
      const k = Math.max(0, Math.min(1, want - ((i * 5) % n)));
      this.dirt.push({ mesh, p: s.p.clone(), n: s.n.clone(), r: s.r * (0.8 + ((i * 37) % 10) / 20), dirt: k });
    });
    this.a.startDirty = this.dirt.some((q) => q.dirt > 0.05);
    this.a.sleepy = false; this.a.petTime = 0; this.a.tapLove = 0;
    // the backdrop: today's sky and ground, softly out of focus
    this.paintBackdrop();
    // hide the world (paused), keep lights
    const keep = new Set<THREE.Object3D>([this.studio, g.hemi, g.sun, g.sun.target, g.camera]);
    this.hidden = g.scene.children.filter((o) => o.visible && !keep.has(o));
    for (const o of this.hidden) o.visible = false;
    this.studio.visible = true;
    this.saved.pos.copy(g.camera.position); this.saved.quat.copy(g.camera.quaternion); this.saved.bg = g.scene.background;
    g.scene.background = new THREE.Color('#f3e6d0');
    this.frame();
    g.audio.pop(1.1); g.audio.voice(ref.species);
    this.react('hop');
    this.refresh(); this.setMode('pet');
  }
  hide() {
    if (!this.open) return;
    const g = this.g;
    this.open = false;
    this.el.classList.remove('open', 'renaming');
    document.body.classList.remove('friend-open');
    for (const o of this.hidden) o.visible = true;
    this.hidden = [];
    this.studio.visible = false;
    if (this.rig) { this.studio.remove(this.rig.root); this.rig = null; }
    g.scene.background = this.saved.bg;
    g.camera.position.copy(this.saved.pos); g.camera.quaternion.copy(this.saved.quat);
    this.fx.innerHTML = '';
    this.cursor.classList.remove('show');
    this.host.touch(); this.host.refreshBadges();
    g.audio.pop(0.8);
  }

  /** frame the camera on the creature, leaving room for the card (top) and the tool bar (bottom) */
  frame() {
    const cam = this.g.camera, h = this.rig?.height ?? 1.4, wd = this.rig?.width ?? 1.1;
    const fov = THREE.MathUtils.degToRad(cam.fov), asp = cam.aspect, tn = 2 * Math.tan(fov / 2);
    // fit the height into ~46% of the view (room for the card and tool bar) and the width into ~60%
    const dist = Math.max((h / 0.46) / tn, (wd / 0.6) / (tn * asp));
    const look = new THREE.Vector3(0, h * 0.47, 0).add(STUDIO);
    cam.position.set(STUDIO.x + dist * 0.22, STUDIO.y + h * 0.62 + dist * 0.12, STUDIO.z + dist);
    cam.lookAt(look);
    cam.updateMatrixWorld();
  }
  private paintBackdrop() {
    const g = this.g, w = new Float32Array(BIOME_COUNT), p = g.player.position;
    biomeWeights(p.x, p.z, w);
    const top = g.hemi.color.clone().lerp(new THREE.Color('#bfe6ff'), 0.4);
    const mid = g.scene.fog ? (g.scene.fog as THREE.Fog).color.clone().lerp(new THREE.Color('#ffe9c8'), 0.45) : new THREE.Color('#f6e7cf');
    const bot = g.hemi.groundColor.clone().lerp(new THREE.Color('#f4d9b0'), 0.45);
    const pos = this.backdrop.geometry.attributes.position, col = this.backdrop.geometry.attributes.color as THREE.BufferAttribute, c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 40;
      if (y > 0) c.copy(mid).lerp(top, Math.min(1, y * 1.6)); else c.copy(mid).lerp(bot, Math.min(1, -y * 3));
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
    // bokeh tinted by the biome's flowers/leaves
    const pal: string[] = [];
    if (w[Biome.Autumn] > 0.3) pal.push('#ff9a4a', '#ffcf5a', '#e8603a');
    if (w[Biome.Tropical] > 0.3) pal.push('#7af0d8', '#ffd36b', '#ff8fb1');
    if (w[Biome.Alpine] > 0.3) pal.push('#dff3ff', '#b9d8ff', '#ffffff');
    if (w[Biome.Desert] > 0.3) pal.push('#ffc27a', '#ff9e6b', '#ffe7a8');
    if (w[Biome.Marsh] > 0.3) pal.push('#b4f0a0', '#e6f7c8', '#ffe9a0');
    if (!pal.length || w[Biome.Meadow] > 0.3) pal.push('#fff2a8', '#ffb3d1', '#b8f08c', '#ffffff');
    this.bokeh.forEach((b, i) => (b.material as THREE.MeshBasicNodeMaterial).color.set(pal[i % pal.length]));
  }

  // ---------------- UI ----------------
  refresh() {
    const p = this.pet, ref = this.ref; if (!p || !ref) return;
    const t = TASTES[ref.species as Species];
    const q = (s: string) => this.el.querySelector<HTMLElement>(s)!;
    q('.fs-icon').textContent = t.icon;
    q('.fs-name').innerHTML = `${esc(p.name)} <small>✏️</small>`;
    q('.fs-species').textContent = t.name;
    q('.fs-lvl').textContent = `Lv ${p.lvl}`;
    q('.fs-tricks').textContent = p.tricks.length ? ' · ' + p.tricks.map((k) => TRICKS[k].icon).join('') : '';
    const lo = needFor(p.lvl), hi = needFor(p.lvl + 1), lp = Math.max(0, Math.min(1, (p.love - lo) / (hi - lo)));
    this.meter('love', lp, `${Math.floor(p.love - lo)}/${hi - lo}`);
    const full = this.fullness();
    this.meter('food', full, full < 0.05 ? 'Hungry!' : full > 0.8 ? 'Full' : 'Peckish');
    this.meter('clean', p.clean, p.clean > 0.95 ? 'Sparkly' : p.clean > 0.6 ? 'Clean' : p.clean > 0.3 ? 'Dusty' : 'Muddy');
    const trick = q('.fs-tool.trick');
    trick.classList.toggle('locked', !p.tricks.length);
    trick.querySelector('span')!.textContent = p.tricks.length ? 'Trick' : 'Lv 2';
    trick.querySelector('i')!.textContent = p.tricks.length ? '✨' : '🔒';
  }
  private meter(k: string, v: number, label: string) {
    const m = this.el.querySelector<HTMLElement>(`.fs-meter.${k}`)!;
    m.querySelector<HTMLElement>('b')!.style.width = `${Math.round(v * 100)}%`;
    m.querySelector<HTMLElement>('.v')!.textContent = label;
  }
  fullness() { const a = this.ref?.a; return a ? Math.max(0, Math.min(1, a.hunger / 300)) : 0; }
  private setMode(m: Mode) {
    this.mode = m;
    for (const b of this.el.querySelectorAll<HTMLElement>('.fs-tool')) b.classList.toggle('on', b.dataset.mode === m);
    this.el.classList.toggle('feeding', m === 'feed');
    this.cursor.textContent = m === 'clean' ? '🧽' : '🤚';
    const n = esc(this.pet?.name ?? 'your friend');
    this.hint.innerHTML = m === 'pet' ? `Drag on ${n} to pet · tap to say hi` : m === 'clean' ? `Scrub ${n} to wash off the mud` : `Pick a snack for ${n}`;
    if (m === 'feed') this.renderTray();
  }
  tool(m: string) {
    this.g.audio.ui();
    if (m === 'trick') { this.trick(); return; }
    this.setMode(m === this.mode && m === 'feed' ? 'pet' : (m as Mode));
  }
  private renderTray() {
    const d = this.host.save(), sp = this.ref!.species as Species, t = TASTES[sp];
    const ids = (Object.keys(d.food) as FoodId[]).filter((id) => (d.food[id] ?? 0) > 0 && !FOODS[id].trade);
    const score = (id: FoodId) => (t.fav.includes(id) ? 0 : t.likes.includes(id) ? 1 : 2);
    ids.sort((a, b) => score(a) - score(b));
    this.tray.innerHTML = ids.length
      ? ids.map((id) => `<button class="fs-food${score(id) === 0 ? ' fav' : score(id) === 1 ? ' like' : ''}" data-id="${id}"><i>${FOODS[id].icon}</i><b>${d.food[id]}</b>${score(id) === 0 ? '<em>♥</em>' : ''}</button>`).join('')
      : '<div class="fs-empty">Your bag is empty. Forage some snacks first!</div>';
    for (const b of this.tray.querySelectorAll<HTMLButtonElement>('.fs-food')) b.addEventListener('click', (e) => { e.stopPropagation(); this.feed(b.dataset.id as FoodId, b); });
  }

  // ---------------- actions ----------------
  /** offer a food (from the tray, or a test) */
  feed(id: FoodId, from?: HTMLElement) {
    const d = this.host.save(), ref = this.ref, rig = this.rig; if (!ref || !rig || !this.pet) return;
    if ((d.food[id] ?? 0) <= 0 || this.a.eat > 0 || this.inFlight) return;
    this.inFlight = true;
    const t = TASTES[ref.species as Species], fav = t.fav.includes(id), like = fav || t.likes.includes(id);
    const mouth = this.screenOf(rig.head.localToWorld(rig.mouth.clone()));
    const r = from?.getBoundingClientRect();
    const fly = this.spawn(FOODS[id].icon, r ? r.left + r.width / 2 : innerWidth / 2, r ? r.top : innerHeight - 140, 'fly');
    requestAnimationFrame(() => { fly.style.transform = `translate(${mouth.x - parseFloat(fly.style.left)}px, ${mouth.y - parseFloat(fly.style.top)}px) scale(0.7)`; });
    window.setTimeout(() => {
      fly.remove();
      this.inFlight = false;
      if (!this.open) return;
      if (like) {
        d.food[id] = (d.food[id] ?? 0) - 1;
        this.g.fauna.feed(ref, fav);
        this.a.eat = 1.3; this.stats.eat++;
        for (let i = 0; i < 3; i++) window.setTimeout(() => this.open && this.g.audio.chomp(), 120 + i * 330);
        window.setTimeout(() => { if (!this.open) return; this.g.audio.feed(true); this.hearts(fav ? 5 : 3); this.react('hop'); this.addLove(fav ? 4 : 2); }, 1150);
        for (let i = 0; i < 5; i++) window.setTimeout(() => this.open && this.spawn('·', mouth.x + (Math.random() - 0.5) * 30, mouth.y + 10, 'crumb'), 150 + i * 160);
      } else {
        this.a.headShake = 0.9; this.stats.dislike++;
        this.g.audio.dislike();
        const hp = this.screenOf(rig.head.localToWorld(new THREE.Vector3(0, 0.45, 0)));
        this.spawn('🙅', hp.x, hp.y, 'pop');
        this.spawn(FOODS[id].icon, mouth.x, mouth.y, 'drop');
        this.host.toast(`${esc(this.pet!.name)} doesn't fancy ${FOODS[id].name}. Try ${t.fav.map((f) => FOODS[f].icon).join(' ')}`);
      }
      this.host.touch(); this.refresh(); if (this.mode === 'feed') this.renderTray(); this.host.refreshBadges();
    }, 470);
  }
  trick() {
    const p = this.pet; if (!p) return;
    if (!p.tricks.length) { this.host.toast(`Reach friendship <b>Lv 2</b> to learn a trick`); return; }
    const k = p.tricks[this.stats.trick % p.tricks.length];
    this.stats.trick++;
    if (k === 'spin') { this.a.spin = 1; this.react('hop'); } else { this.a.dance = 1.6; }
    this.g.audio.voice(this.ref!.species); this.g.audio.giggle(1.1);
    window.setTimeout(() => this.open && this.hearts(2), 700);
  }
  private addLove(v: number) {
    const p = this.pet; if (!p) return;
    p.love += v;
    while (p.love >= needFor(p.lvl + 1)) { p.lvl++; this.levelUp(p.lvl); }
    this.refresh(); this.host.touch();
  }
  private levelUp(l: number) {
    const p = this.pet!, sp = this.ref!.species;
    this.stats.levelUp++;
    this.g.audio.levelUp();
    let gift = '';
    if (l === 2 && !p.tricks.includes('spin')) { p.tricks.push('spin'); gift = `learned a trick: <b>${TRICKS.spin.icon} ${TRICKS.spin.name}</b>`; }
    else if (l === 4 && !p.tricks.includes('dance')) { p.tricks.push('dance'); gift = `learned a trick: <b>${TRICKS.dance.icon} ${TRICKS.dance.name}</b>`; }
    else if (l === 3) {
      const id = GIFT[sp] ?? 'flower', w = WEAR_BY_ID.get(id)!;
      const fresh = this.host.grantWear(id);
      gift = fresh ? `gave you <b>${w.icon} ${w.name}</b>!` : `gave you <b>+${RARITY[w.rarity].shells} 🐚</b>`;
    } else { const s = 5 * l; this.host.save().shells += s; gift = `found you <b>+${s} 🐚</b>`; }
    p.lastGift = gift;
    const banner = document.createElement('div');
    banner.className = 'fs-levelup';
    banner.innerHTML = `<div class="lv">💗 Friendship Lv ${l}!</div><div class="gift">${esc(p.name)} ${gift}</div>`;
    this.el.appendChild(banner);
    window.setTimeout(() => banner.remove(), 2600);
    for (let i = 0; i < 10; i++) window.setTimeout(() => this.open && this.spawn(['💗', '✨', '💖'][i % 3], innerWidth / 2 + (Math.random() - 0.5) * 260, innerHeight * 0.45, 'heart'), i * 60);
    this.a.spin = 1; this.react('hop');
    this.host.refreshBadges();
  }

  // ---------------- pointer ----------------
  private setNdc(e: PointerEvent) { this.ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); this.ptr.seen = this.t; }
  private pick(): THREE.Intersection | null {
    if (!this.rig) return null;
    this.ray.setFromCamera(this.ndc, this.g.camera);
    return this.ray.intersectObjects(this.rig.pickables, false)[0] ?? null;
  }
  private down(e: PointerEvent) {
    e.preventDefault();
    if (this.ptr.down) return;
    this.g.audio.unlock();
    const p = this.ptr;
    Object.assign(p, { down: true, id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t0: performance.now(), moved: 0, last: performance.now(), speed: 0 });
    this.rub.x = e.clientX; this.rub.dir = 0; this.rub.flips = [];
    try { this.stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    this.setNdc(e); this.placeCursor(e);
    this.cursor.classList.add('show', 'press');
    if (this.mode === 'feed') this.setMode('pet');
    this.probe();
  }
  private move(e: PointerEvent) {
    this.setNdc(e); this.placeCursor(e);
    if (e.pointerType === 'mouse') this.cursor.classList.add('show');
    const p = this.ptr;
    if (!p.down || e.pointerId !== p.id) return;
    const now = performance.now(), d = Math.hypot(e.clientX - p.x, e.clientY - p.y), dtm = Math.max(1, now - p.last);
    p.speed = p.speed * 0.7 + (d / dtm) * 1000 * 0.3;
    p.moved += d; p.x = e.clientX; p.y = e.clientY; p.last = now;
    if (this.probe()) this.stroke(d);
  }
  private up(e: PointerEvent) {
    const p = this.ptr;
    if (!p.down || e.pointerId !== p.id) return;
    p.down = false;
    this.cursor.classList.remove('press');
    if (e.pointerType !== 'mouse') this.cursor.classList.remove('show');
    // a quick tap on the creature: it says hi
    if (p.moved < 10 && performance.now() - p.t0 < 300 && p.hit) {
      this.react('quirk'); this.react('hop');
      if (this.a.tapLove < 1.5) { this.a.tapLove += 0.3; this.addLove(0.3); }
      if (this.a.sleepy) this.wake();
    }
  }
  private placeCursor(e: PointerEvent) { this.cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`; }
  private probe() {
    const hit = this.pick();
    this.ptr.hit = !!hit;
    if (hit && this.rig) { this.ptr.hitT = this.t; this.hitLocal.copy(this.rig.body.worldToLocal(hit.point.clone())); }
    return !!hit;
  }
  /** finger moved d px while over the creature */
  private stroke(d: number) {
    const a = this.a, au = this.g.audio, p = this.ptr;
    if (this.mode === 'clean') {
      // scrub the mud: blobs near the brush fade
      const amt = d * 0.0055;
      let best: Dirt | null = null, bd = 1e9;
      for (const q of this.dirt) {
        if (q.dirt <= 0) continue;
        const dd = q.p.distanceTo(this.hitLocal);
        if (dd < q.r + 0.3) this.scrubOne(q, amt * (1.2 - dd / (q.r + 0.3)));
        if (dd < bd) { bd = dd; best = q; }
      }
      if (best && best.dirt > 0) this.scrubOne(best, amt * 0.35); // forgiving: the nearest spot always gets some
      if (this.t - a.bubbleT > 0.05) { a.bubbleT = this.t; this.spawn('🫧', p.x + (Math.random() - 0.5) * 40, p.y + (Math.random() - 0.5) * 30, 'bubble'); }
      if (this.t - a.scrubT > 0.13) { a.scrubT = this.t; au.scrub(); }
      a.wiggle = Math.max(a.wiggle, 0.15);
      this.updateClean();
      return;
    }
    // petting
    a.petTime += 0; // advanced in update while touching
    // tickling = quick back-and-forth rubbing: several direction flips within ~0.8 s
    const dx = p.x - this.rub.x;
    if (Math.abs(dx) > 10) {
      const dir = Math.sign(dx);
      if (dir !== this.rub.dir) { this.rub.flips.push(performance.now()); this.rub.dir = dir; }
      this.rub.x = p.x;
    }
    const nowMs = performance.now();
    this.rub.flips = this.rub.flips.filter((q) => nowMs - q < 800);
    if (this.rub.flips.length >= 4 || p.speed > 2200) {
      if (a.giggleCd <= 0) { // tickled!
        a.giggleCd = 0.9; this.rub.flips = []; this.stats.giggle++;
        au.giggle(this.ref!.species === 'deer' ? 0.8 : this.ref!.species === 'bird' ? 1.3 : 1);
        a.wiggle = 0.7; this.react('hop');
        this.spawn('😆', p.x, p.y - 50, 'pop');
        if (a.sleepy) this.wake();
      }
    }
  }
  private rub = { x: 0, dir: 0, flips: [] as number[] };
  private scrubOne(q: Dirt, amt: number) {
    const was = q.dirt;
    q.dirt = Math.max(0, q.dirt - amt);
    if (was > 0 && q.dirt <= 0 && this.rig) {
      const s = this.screenOf(this.rig.body.localToWorld(q.p.clone()));
      this.spawn('✨', s.x, s.y, 'pop'); this.g.audio.pop(1.4 + Math.random() * 0.4);
    }
  }
  private updateClean() {
    const p = this.pet; if (!p || !this.dirt.length) return;
    const avg = this.dirt.reduce((s, q) => s + q.dirt, 0) / this.dirt.length;
    p.clean = Math.max(p.clean, 1 - avg);
    if (avg <= 0.001 && this.a.startDirty) {
      this.a.startDirty = false; p.clean = 1;
      this.a.shakeOff = 1; this.stats.shake++;
      this.g.audio.shake();
      const c = this.screenOf(this.rig!.body.localToWorld(new THREE.Vector3(0, (this.rig!.height) * 0.35, 0)));
      for (let i = 0; i < 12; i++) window.setTimeout(() => this.open && this.spawn(i % 3 ? '💧' : '✨', c.x + (Math.random() - 0.5) * 220, c.y + (Math.random() - 0.5) * 120, 'drop'), 250 + i * 40);
      window.setTimeout(() => { if (!this.open) return; this.hearts(3); this.host.toast(`✨ ${esc(p.name)} is squeaky clean!`); this.addLove(3); }, 1000);
    }
    this.refresh(); this.host.touch();
  }
  private wake() { this.a.sleepy = false; this.a.petTime = 0; this.a.yawn = 1; this.g.audio.voice(this.ref!.species); }

  // ---------------- reactions ----------------
  react(k: 'hop' | 'quirk' | 'ear' | 'tail' | 'look') {
    const a = this.a, sp = this.ref?.species;
    if (k === 'hop') { a.hop = 1; a.hopDur = 0.45; }
    if (k === 'ear') { a.ear = 0.6; a.earSide = Math.random() < 0.5 ? 0 : 1; }
    if (k === 'tail') a.tail = 0.9;
    if (k === 'quirk') {
      this.stats.quirk++;
      a.quirk = 0.9;
      this.g.audio.voice(sp ?? 'bunny');
      if (sp === 'duck' || sp === 'bird') a.flap = 0.8;
      if (sp === 'crab') a.click = 0.9;
      if (sp === 'deer') { a.ear = 0.5; a.earSide = Math.random() < 0.5 ? 0 : 1; }
      if (sp === 'bird') { a.hop = 1; a.hopDur = 0.3; }
    }
  }
  private hearts(n: number) {
    if (!this.rig) return;
    const c = this.screenOf(this.rig.head.localToWorld(new THREE.Vector3(0, 0.4, 0)));
    for (let i = 0; i < n; i++) window.setTimeout(() => this.open && this.spawn(i % 2 ? '💗' : '💖', c.x + (Math.random() - 0.5) * 90, c.y, 'heart'), i * 90);
    this.stats.hearts += n;
  }
  private spawn(txt: string, x: number, y: number, cls: string) {
    const s = document.createElement('span');
    s.className = `fsp ${cls}`; s.textContent = txt;
    s.style.left = `${x}px`; s.style.top = `${y}px`;
    s.style.setProperty('--dx', `${(Math.random() - 0.5) * 60}px`);
    this.fx.appendChild(s);
    if (cls !== 'fly') s.addEventListener('animationend', () => s.remove());
    return s;
  }
  screenOf(v: THREE.Vector3) {
    const p = v.clone().project(this.g.camera);
    return { x: (p.x * 0.5 + 0.5) * innerWidth, y: (-p.y * 0.5 + 0.5) * innerHeight };
  }
  /** screen position of the creature's body / head (tests) */
  where() {
    const r = this.rig!;
    return { body: this.screenOf(r.body.localToWorld(new THREE.Vector3(0, r.height * 0.3, 0))), head: this.screenOf(r.head.localToWorld(new THREE.Vector3(0, 0.05, 0.15))) };
  }

  // ---------------- per frame (world paused) ----------------
  update(dt: number) {
    if (!this.open || !this.rig) return;
    const r = this.rig, a = this.a, t = (this.t += dt), sp = this.ref!.species, au = this.g.audio;
    const petting = this.mode === 'pet' && this.ptr.down && this.ptr.hit && t - this.ptr.hitT < 0.2;
    // --- petting: lean into the hand, eyes close happily, purr, hearts, sleepy after a long while
    if (petting) {
      a.petTime += dt; a.idleSince = 0;
      const moving = performance.now() - this.ptr.last < 120;
      if (moving) this.addLove(dt * 0.7);
      if (t - a.purrT > 0.42) { a.purrT = t; au.purr(Math.min(1, this.ptr.speed / 900)); this.stats.purr++; }
      if (t - a.heartT > 0.55) { a.heartT = t; this.spawn(Math.random() < 0.5 ? '💗' : '💕', this.ptr.x + (Math.random() - 0.5) * 30, this.ptr.y - 30, 'heart'); this.stats.hearts++; }
      if (a.petTime > 7 && !a.sleepy) { a.sleepy = true; this.stats.sleepy++; this.host.toast(`${esc(this.pet!.name)} is getting sleepy… 💤`); }
    } else {
      a.idleSince += dt;
      if (a.idleSince > 1) a.petTime = Math.max(0, a.petTime - dt * 2);
      if (a.sleepy && a.idleSince > 3) this.wake();
    }
    if (a.sleepy && t - a.zT > 1.1) { a.zT = t; const h = this.screenOf(r.head.localToWorld(new THREE.Vector3(0.2, 0.4, 0))); this.spawn('💤', h.x, h.y, 'zz'); }
    const leanT = petting ? THREE.MathUtils.clamp(this.hitLocal.x * -0.9, -0.28, 0.28) : 0;
    a.lean += (leanT - a.lean) * Math.min(1, dt * 6);
    a.tilt += ((petting ? leanT * 1.4 : 0) - a.tilt) * Math.min(1, dt * 5);
    // --- blink
    a.nextBlink -= dt;
    if (a.nextBlink <= 0) { a.blink = 0.16; a.nextBlink = 1.8 + Math.random() * 3.2; this.stats.blink++; }
    a.blink = Math.max(0, a.blink - dt);
    const blinkK = a.blink > 0 ? Math.sin((a.blink / 0.16) * Math.PI) : 0;
    const closedT = Math.max(blinkK, petting || a.sleepy ? 1 : 0, a.eat > 0 ? 0.7 : 0);
    a.closed += (closedT - a.closed) * Math.min(1, dt * (closedT > a.closed ? 22 : 10));
    // --- idle life
    a.nextIdle -= dt;
    if (a.nextIdle <= 0 && !petting && !a.sleepy) {
      a.nextIdle = 2.2 + Math.random() * 3;
      const roll = Math.random();
      if (roll < 0.3) this.react('ear'); else if (roll < 0.55) this.react('tail'); else if (roll < 0.8) this.react('quirk'); else { this.react('hop'); a.hopDur = 0.35; }
    }
    a.giggleCd -= dt;
    // --- look at the finger / cursor (or wander when idle)
    const fresh = t - this.ptr.seen < 2.5;
    const hs = this.screenOf(r.head.localToWorld(new THREE.Vector3()));
    let ly = 0, lp = 0;
    if (fresh) {
      const px = (this.ndc.x * 0.5 + 0.5) * innerWidth, py = (-this.ndc.y * 0.5 + 0.5) * innerHeight;
      ly = THREE.MathUtils.clamp((px - hs.x) / (innerWidth * 0.35), -0.75, 0.75) - (r.root.rotation.y - (BASE_YAW[sp] ?? 0)) * 0;
      lp = THREE.MathUtils.clamp((py - hs.y) / (innerHeight * 0.4), -0.45, 0.5);
      if (Math.abs(ly) > 0.05) this.stats.look++;
    } else { ly = Math.sin(t * 0.4) * 0.25 - (BASE_YAW[sp] ?? 0) * 0.8; lp = Math.sin(t * 0.27) * 0.08; }
    if (a.sleepy) { ly = 0; lp = 0.35; }
    a.yawL += (ly - a.yawL) * Math.min(1, dt * 7);
    a.pitchL += (lp - a.pitchL) * Math.min(1, dt * 7);
    // --- timers
    const dec = (k: keyof typeof a) => { (a[k] as number) = Math.max(0, (a[k] as number) - dt); };
    for (const k of ['quirk', 'wiggle', 'headShake', 'ear', 'tail', 'flap', 'click', 'yawn'] as const) dec(k);
    if (a.eat > 0) a.eat = Math.max(0, a.eat - dt);
    if (a.dance > 0) a.dance = Math.max(0, a.dance - dt);
    if (a.shakeOff > 0) a.shakeOff = Math.max(0, a.shakeOff - dt * 1.1);
    let hopY = 0;
    if (a.hop > 0) { a.hop = Math.max(0, a.hop - dt / a.hopDur); const k = 1 - a.hop; hopY = Math.sin(k * Math.PI) * 0.22 * (r.height / 1.5); }
    if (a.dance > 0) { const k = a.dance * 6; hopY = Math.max(hopY, Math.abs(Math.sin(k * Math.PI / 2)) * 0.15); }
    let spinA = 0;
    if (a.spin > 0) { a.spin = Math.max(0, a.spin - dt / 0.8); const k = 1 - a.spin; spinA = easeInOut(k) * Math.PI * 2; if (a.spin === 0) spinA = 0; }
    // --- pose
    const breathe = Math.sin(t * (a.sleepy ? 1.3 : 2.4)) * (a.sleepy ? 0.035 : 0.018);
    r.root.position.y = hopY;
    r.root.rotation.y = (BASE_YAW[sp] ?? 0) + spinA + (a.dance > 0 ? Math.sin(a.dance * 9) * 0.5 : 0);
    const shakeZ = a.shakeOff > 0 ? Math.sin(a.shakeOff * 60) * 0.22 * a.shakeOff : 0;
    r.body.rotation.z = a.lean + shakeZ + (a.dance > 0 ? Math.sin(a.dance * 9) * 0.12 : 0);
    r.body.rotation.y = a.wiggle > 0 ? Math.sin(t * 30) * 0.1 * Math.min(1, a.wiggle * 3) : 0;
    r.body.scale.set(1 - breathe * 0.5, 1 + breathe, 1 - breathe * 0.5);
    const nod = a.eat > 0 ? Math.max(0, Math.sin((1.3 - a.eat) * Math.PI * 2.3)) * 0.45 : 0;
    const shakeH = a.headShake > 0 ? Math.sin(a.headShake * 34) * 0.45 * Math.min(1, a.headShake * 2) : 0;
    const yawn = a.yawn > 0 ? -Math.sin(a.yawn * Math.PI) * 0.4 : 0;
    r.head.rotation.set(a.pitchL + nod + yawn + (a.sleepy ? 0.25 : 0), a.yawL + shakeH, a.tilt + (a.shakeOff > 0 ? shakeZ * 1.5 : 0));
    const eyeY = 1 - a.closed * 0.86;
    for (const e of r.eyes) e.scale.y = eyeY;
    // ears: wiggle / flick / droop when sleepy
    r.ears.forEach((e, i) => {
      const r0 = e.userData.r0 as THREE.Euler; if (!r0) return;
      let wz = Math.sin(t * 1.7 + i) * 0.04;
      if (a.ear > 0 && (sp !== 'deer' || i === a.earSide)) wz += Math.sin(a.ear * (sp === 'deer' ? 50 : 28)) * (sp === 'deer' ? 0.5 : 0.25) * Math.min(1, a.ear * 3);
      if (a.quirk > 0 && sp === 'bunny') wz += Math.sin(a.quirk * 30 + i) * 0.15;
      const droop = a.sleepy || petting ? (sp === 'bunny' ? 0.5 : 0.25) : 0;
      e.rotation.set(r0.x + droop * 0.6, r0.y, r0.z + wz * (i ? -1 : 1) + (i ? -1 : 1) * droop * (sp === 'bunny' ? -0.4 : 0.3));
    });
    if (r.tail) { const r0 = r.tail.userData.r0 as THREE.Euler; const wag = (a.tail > 0 ? Math.sin(t * 22) * 0.45 * Math.min(1, a.tail * 2) : 0) + (petting ? Math.sin(t * 16) * 0.3 : 0) + Math.sin(t * 2) * 0.05; r.tail.rotation.set(r0.x, r0.y + wag, r0.z); }
    r.wings.forEach((w, i) => { const r0 = w.userData.r0 as THREE.Euler; const s = i ? -1 : 1; const f = a.flap > 0 ? Math.abs(Math.sin(a.flap * 26)) * 0.9 * Math.min(1, a.flap * 2) : 0; w.rotation.set(r0.x, r0.y, r0.z + s * f); });
    r.claws.forEach((c) => { const r0 = c.userData.r0 as THREE.Euler; const o = a.click > 0 ? Math.abs(Math.sin(a.click * 20)) * 0.7 : Math.sin(t * 1.3) * 0.08; c.rotation.set(r0.x - o, r0.y, r0.z); });
    if (r.nose) { const tw = sp === 'bunny' ? (Math.sin(t * 24) > 0.6 ? 1.12 : 1) * (a.quirk > 0 ? 1 + Math.abs(Math.sin(a.quirk * 40)) * 0.25 : 1) : a.eat > 0 || a.quirk > 0 ? 1 + Math.abs(Math.sin(t * 30)) * 0.15 : 1; r.nose.scale.setScalar(tw); }
    // dirt blobs
    for (const q of this.dirt) { const k = q.dirt > 0.02 ? q.r * (0.35 + 0.65 * q.dirt) : 0; q.mesh.scale.set(k, k * 0.8, k * 0.35); q.mesh.visible = k > 0; }
    // shadow + bokeh drift
    const ss = (r.height * 0.45) * (1 - hopY * 0.8);
    this.shadow.scale.set(ss * 1.3, ss, 1);
    for (const b of this.bokeh) { const u = b.userData; b.position.y = u.y + Math.sin(t * 0.3 + u.ph) * 0.6; b.position.x = u.x + Math.cos(t * 0.2 + u.ph) * 0.8; b.lookAt(this.g.camera.position); }
    // cursor follows; meters refresh slowly
    this.frame();
    if (Math.floor(t * 4) !== Math.floor((t - dt) * 4)) this.refresh();
  }

  // ---------------- care over time (called by Gameplay while you play) ----------------
  care(dt: number, friends: FriendRef[], swimming: boolean) {
    const d = this.host.save(), w = new Float32Array(BIOME_COUNT);
    for (const f of friends) {
      const p = ensurePet(d, this.g.fauna.keyOf(f), f.species);
      biomeWeights(f.a.x, f.a.z, w);
      let rate = 1 / 600;
      if (f.species !== 'duck' && f.species !== 'bird') rate += w[Biome.Marsh] / 90;
      if (swimming) rate += 1 / 200;
      if (f.species === 'bird') rate *= 0.5;
      p.clean = Math.max(0, p.clean - rate * dt);
      p.hunger = f.a.hunger;
    }
  }
  /** a dig sprays mud on friends nearby */
  dirtyNear(x: number, z: number, amt: number) {
    const d = this.host.save();
    for (const f of this.g.fauna.friends()) if (Math.hypot(f.a.x - x, f.a.z - z) < 4.5) { const p = ensurePet(d, this.g.fauna.keyOf(f), f.species); p.clean = Math.max(0, p.clean - amt); }
  }
}

function easeInOut(k: number) { return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; }
function esc(s: string) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!); }
function radialTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d')!, gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
