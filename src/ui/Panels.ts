import { DYES, FOODS, FOOD_ORDER, RARITY, SLOTS, TASTES, WEARABLES, type Slot, type Species } from '../game/Items';
import type { SaveData } from '../game/Save';

export interface PanelApi {
  save: () => SaveData;
  equip: (slot: Slot, id: string | null) => void;
  buyDye: (id: string) => boolean;
  setDye: (id: string) => void;
  friends: () => { species: string; hunger: number }[];
  dismiss: (i: number) => void;
  sheet: (kind: 'bag' | 'wardrobe' | null) => void;
  map: () => void;
  ui: () => void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** Top buttons (Map / Bag / Wardrobe), the contextual action button and the two sheets. */
export class Panels {
  bar: HTMLDivElement;
  mapBtn: HTMLButtonElement; bagBtn: HTMLButtonElement; wardBtn: HTMLButtonElement;
  action: HTMLButtonElement;
  open: 'bag' | 'wardrobe' | null = null;
  private bag: HTMLDivElement; private ward: HTMLDivElement;
  private tab: Slot = 'hat';
  onAction: () => void = () => {};

  constructor(parent: HTMLElement, private api: PanelApi, touch: boolean) {
    this.bar = document.createElement('div');
    this.bar.className = 'game-bar';
    this.bar.innerHTML = `
      <button class="gbtn map" aria-label="Map"><span class="gi">🗺️</span><span class="gl">Map${touch ? '' : ' <kbd>M</kbd>'}</span><span class="badge dot"></span></button>
      <button class="gbtn bag" aria-label="Bag"><span class="gi">🎒</span><span class="gl">Bag${touch ? '' : ' <kbd>I</kbd>'}</span><span class="badge count"></span></button>
      <button class="gbtn ward" aria-label="Wardrobe"><span class="gi">👕</span><span class="gl">Wardrobe${touch ? '' : ' <kbd>O</kbd>'}</span><span class="badge count"></span></button>`;
    parent.appendChild(this.bar);
    this.mapBtn = this.bar.querySelector('.map')!; this.bagBtn = this.bar.querySelector('.bag')!; this.wardBtn = this.bar.querySelector('.ward')!;
    this.mapBtn.addEventListener('click', () => { api.ui(); api.map(); });
    this.bagBtn.addEventListener('click', () => this.toggle('bag'));
    this.wardBtn.addEventListener('click', () => this.toggle('wardrobe'));

    this.action = document.createElement('button');
    this.action.className = 'action-btn' + (touch ? ' touch' : '');
    this.action.innerHTML = '<span class="ai">✋</span><span class="al">Pick</span>';
    this.action.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); this.action.classList.add('press'); this.onAction(); });
    const rel = () => this.action.classList.remove('press');
    this.action.addEventListener('pointerup', rel); this.action.addEventListener('pointerleave', rel);
    parent.appendChild(this.action);

    this.bag = this.makeSheet('bag', '🎒 Bag');
    this.ward = this.makeSheet('wardrobe', '👕 Wardrobe');
    parent.appendChild(this.bag); parent.appendChild(this.ward);
    this.refreshBadges();
  }

  private makeSheet(kind: 'bag' | 'wardrobe', title: string) {
    const el = document.createElement('div');
    el.className = `sheet sheet-${kind}`;
    el.innerHTML = `<div class="sheet-handle"><span></span></div><div class="sheet-head"><h2>${title}</h2><div class="sheet-meta"></div><button class="sheet-close" aria-label="Close">✕</button></div><div class="sheet-body"></div>`;
    el.querySelector('.sheet-close')!.addEventListener('click', () => this.toggle(null));
    // swipe the handle down to close
    const h = el.querySelector('.sheet-handle') as HTMLDivElement;
    let y0 = -1;
    h.addEventListener('pointerdown', (e) => { y0 = e.clientY; h.setPointerCapture(e.pointerId); });
    h.addEventListener('pointermove', (e) => { if (y0 >= 0) el.style.transform = `translateY(${Math.max(0, e.clientY - y0)}px)`; });
    h.addEventListener('pointerup', (e) => { el.style.transform = ''; if (y0 >= 0 && e.clientY - y0 > 60) this.toggle(null); y0 = -1; });
    for (const ev of ['pointerdown', 'wheel', 'touchstart']) el.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
    return el;
  }

  toggle(kind: 'bag' | 'wardrobe' | null) {
    if (kind && this.open === kind) kind = null;
    this.open = kind;
    this.bag.classList.toggle('open', kind === 'bag');
    this.ward.classList.toggle('open', kind === 'wardrobe');
    this.bagBtn.classList.toggle('on', kind === 'bag'); this.wardBtn.classList.toggle('on', kind === 'wardrobe');
    if (kind === 'bag') this.renderBag();
    if (kind === 'wardrobe') this.renderWardrobe();
    this.api.ui();
    this.api.sheet(kind);
  }

  setAction(icon: string | null, label = '') {
    if (!icon) { this.action.classList.remove('show'); return; }
    const ai = this.action.querySelector('.ai')!, al = this.action.querySelector('.al')!;
    if (al.textContent !== label) { ai.textContent = icon; al.textContent = label; this.action.classList.remove('swap'); void this.action.offsetWidth; this.action.classList.add('swap'); }
    this.action.classList.add('show');
  }

  setMapPulse(on: boolean, hasMap: boolean) {
    this.mapBtn.classList.toggle('pulse', on);
    (this.mapBtn.querySelector('.badge') as HTMLElement).style.display = hasMap ? '' : 'none';
  }

  refreshBadges() {
    const s = this.api.save();
    const food = FOOD_ORDER.reduce((a, f) => a + (s.food[f] ?? 0), 0);
    const nb = this.bagBtn.querySelector('.badge') as HTMLElement; nb.textContent = food ? String(food) : ''; nb.style.display = food ? '' : 'none';
    const fresh = Object.keys(s.owned).filter((id) => !s.seen.includes(id)).length;
    const wb = this.wardBtn.querySelector('.badge') as HTMLElement; wb.textContent = fresh ? 'NEW' : ''; wb.style.display = fresh ? '' : 'none';
    if (this.open === 'bag') this.renderBag();
  }

  renderBag() {
    const s = this.api.save();
    this.bag.querySelector('.sheet-meta')!.innerHTML = `<span class="shells">🐚 ${s.shells}</span>`;
    const foods = FOOD_ORDER.map((id) => {
      const n = s.food[id] ?? 0, f = FOODS[id];
      const fans = (Object.keys(TASTES) as Species[]).filter((sp) => TASTES[sp].fav.includes(id) || TASTES[sp].likes.includes(id)).map((sp) => TASTES[sp].icon + (TASTES[sp].fav.includes(id) ? '<b>♥</b>' : '')).join(' ');
      return `<div class="food-card ${n ? '' : 'empty'}"><div class="fi">${f.icon}</div><div class="fn">${esc(f.name)}</div><div class="fc">×${n}</div><div class="ff">${fans}</div></div>`;
    }).join('');
    const fr = this.api.friends();
    const friends = fr.length ? fr.map((f, i) => {
      const t = TASTES[f.species as Species];
      const pct = Math.max(0, Math.min(1, f.hunger / 300));
      return `<div class="friend-row"><span class="fri">${t.icon}</span><span class="frn">${t.name}${f.hunger <= 0 ? ' <i>is hungry!</i>' : ''}</span>
        <span class="hb"><span style="width:${pct * 100}%"></span></span><button class="bye" data-i="${i}">👋 Bye</button></div>`;
    }).join('') : `<div class="hint">No followers yet. Carry a food an animal likes, walk up gently and press <b>Feed</b>. Favourite foods (♥) win them over right away.</div>`;
    this.bag.querySelector('.sheet-body')!.innerHTML = `<div class="food-grid">${foods}</div><h3>Friends <small>${fr.length}/6</small></h3><div class="friends">${friends}</div>`;
    this.bag.querySelectorAll('.bye').forEach((b) => b.addEventListener('click', () => { this.api.dismiss(Number((b as HTMLElement).dataset.i)); this.renderBag(); }));
  }

  renderWardrobe() {
    const s = this.api.save();
    const ownedN = WEARABLES.filter((w) => s.owned[w.id]).length;
    this.ward.querySelector('.sheet-meta')!.innerHTML = `<span class="coll">${ownedN}/${WEARABLES.length}</span><span class="shells">🐚 ${s.shells}</span>`;
    const tabs = SLOTS.map((sl) => {
      const fresh = WEARABLES.some((w) => w.slot === sl.id && s.owned[w.id] && !s.seen.includes(w.id));
      return `<button class="tab ${sl.id === this.tab ? 'on' : ''}" data-slot="${sl.id}">${sl.icon}<span>${sl.name}</span>${fresh ? '<i class="nb"></i>' : ''}</button>`;
    }).join('');
    const items = WEARABLES.filter((w) => w.slot === this.tab).map((w) => {
      const own = !!s.owned[w.id], r = RARITY[w.rarity], eq = s.equipped[w.slot] === w.id, fresh = own && !s.seen.includes(w.id);
      return own
        ? `<button class="wcard ${eq ? 'eq' : ''}" data-id="${w.id}" style="--rc:${r.color}"><span class="wi">${w.icon}</span><span class="wn">${esc(w.name)}</span><span class="wr">${r.name}</span>${fresh ? '<span class="new">NEW</span>' : ''}${eq ? '<span class="chk">✓</span>' : ''}</button>`
        : `<div class="wcard locked" style="--rc:${r.color}"><span class="wi">?</span><span class="wn">???</span><span class="wr">${r.name}</span></div>`;
    }).join('');
    const dyes = this.tab === 'body' ? `<h3>Dyes <small>tint your outfit</small></h3><div class="dyes">${DYES.map((d) => {
      const has = s.dyes.includes(d.id);
      return `<button class="dye ${s.dye === d.id ? 'on' : ''} ${has ? '' : 'buy'}" data-dye="${d.id}" style="--dc:${d.color}" title="${d.name}"><span></span>${has ? '' : `<em>🐚${d.cost}</em>`}</button>`;
    }).join('')}</div><div class="hint">Duplicate finds turn into 🐚 shells. Spend them on dyes.</div>` : '';
    this.ward.querySelector('.sheet-body')!.innerHTML = `<div class="tabs">${tabs}</div><div class="wgrid">${items}</div>${dyes}
      <div class="hint drag-hint">Drag the island view to spin around and admire your look ✨</div>`;
    this.ward.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => { this.tab = (b as HTMLElement).dataset.slot as Slot; this.api.ui(); this.renderWardrobe(); }));
    this.ward.querySelectorAll('.wcard[data-id]').forEach((b) => b.addEventListener('click', () => {
      const id = (b as HTMLElement).dataset.id!, w = WEARABLES.find((x) => x.id === id)!;
      const cur = this.api.save().equipped[w.slot];
      this.api.equip(w.slot, cur === id && w.slot !== 'body' ? null : id);
      this.renderWardrobe(); this.refreshBadges();
    }));
    this.ward.querySelectorAll('.dye').forEach((b) => b.addEventListener('click', () => {
      const id = (b as HTMLElement).dataset.dye!;
      if (!this.api.save().dyes.includes(id)) { if (!this.api.buyDye(id)) { b.classList.remove('shake'); void (b as HTMLElement).offsetWidth; b.classList.add('shake'); return; } }
      this.api.setDye(id); this.renderWardrobe();
    }));
    // mark everything in this tab as seen
    const sv = this.api.save();
    for (const w of WEARABLES) if (w.slot === this.tab && sv.owned[w.id] && !sv.seen.includes(w.id)) sv.seen.push(w.id);
  }
}
