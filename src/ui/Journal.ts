/**
 * Collection journal (Order 52b/52c): pages for fish, creatures and treasures.
 * Silhouettes until unlocked; page completion grants cosmetics (52c).
 */
import { FISH, WATER_NAME, TIME_HINT, type FishDef } from '../game/FishDefs';
import { TASTES, type Species } from '../game/Items';
import type { SaveData, PetData } from '../game/Save';
import { MOUNTS, type MountTreasure } from '../player/MountDefs';
import {
  JOURNAL_REWARDS, nextJournalReward, pageComplete, pageClaimed,
  type JournalPage,
} from './journalRewards';

export type { JournalPage } from './journalRewards';
export { JOURNAL_REWARDS, nextJournalReward, pageComplete, pageClaimed, pageKnown } from './journalRewards';

export interface JournalApi {
  save: () => SaveData;
  ui: () => void;
  /** soft paper flip / open sound */
  paper?: () => void;
}

const SPECIES = Object.keys(TASTES) as Species[];
const TREASURES: MountTreasure[] = MOUNTS.filter((m) => m.treasure).map((m) => m.treasure!);

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function banner(page: JournalPage, d: SaveData): string {
  if (!pageComplete(page, d)) return '';
  const r = JOURNAL_REWARDS[page];
  if (pageClaimed(page, d)) {
    return `<div class="journal-done claimed" data-page="${page}">✅ ${esc(r.title)} · reward claimed</div>`;
  }
  return `<div class="journal-done ready" data-page="${page}">🎁 ${esc(r.title)} · collecting reward…</div>`;
}

export class Journal {
  open = false;
  page: JournalPage = 'fish';
  el: HTMLDivElement;
  private body: HTMLDivElement;
  private meta: HTMLElement;
  private tabs: HTMLDivElement;

  constructor(parent: HTMLElement, private api: JournalApi) {
    const el = this.el = document.createElement('div');
    el.className = 'journal-overlay';
    el.innerHTML = `
      <div class="journal-card" role="dialog" aria-label="Collection journal">
        <div class="journal-head">
          <h2>📖 Journal</h2>
          <div class="journal-meta"></div>
          <button class="journal-close" aria-label="Close journal">✕</button>
        </div>
        <div class="journal-tabs" role="tablist">
          <button class="journal-tab on" data-page="fish" role="tab" aria-selected="true">🐟 Fish</button>
          <button class="journal-tab" data-page="creatures" role="tab" aria-selected="false">🐾 Friends</button>
          <button class="journal-tab" data-page="treasures" role="tab" aria-selected="false">💎 Treasures</button>
        </div>
        <div class="journal-body" role="tabpanel"></div>
      </div>`;
    parent.appendChild(el);
    this.body = el.querySelector('.journal-body')!;
    this.meta = el.querySelector('.journal-meta')!;
    this.tabs = el.querySelector('.journal-tabs')!;
    el.querySelector('.journal-close')!.addEventListener('click', (e) => { e.stopPropagation(); this.hide(); });
    el.addEventListener('click', (e) => { if (e.target === el) this.hide(); });
    for (const b of this.tabs.querySelectorAll<HTMLButtonElement>('.journal-tab')) {
      b.addEventListener('click', (e) => { e.stopPropagation(); this.setPage(b.dataset.page as JournalPage); });
    }
    for (const ev of ['pointerdown', 'wheel', 'touchstart'] as const) {
      el.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
    }
    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      if (e.key === 'Escape') { e.preventDefault(); this.hide(); }
    });
  }

  toggle() { if (this.open) this.hide(); else this.show(); }

  show(page?: JournalPage) {
    if (page) this.page = page;
    this.open = true;
    this.el.classList.add('open');
    document.body.classList.add('journal-open');
    this.render();
    this.api.paper?.();
    this.api.ui();
  }

  hide() {
    if (!this.open) return;
    this.open = false;
    this.el.classList.remove('open');
    document.body.classList.remove('journal-open');
    this.api.paper?.();
    this.api.ui();
  }

  setPage(page: JournalPage) {
    if (this.page === page) return;
    this.page = page;
    this.api.ui();
    this.render();
  }

  /** re-paint if open (after a catch / reward claim) */
  refresh() { if (this.open) this.render(); }

  /** test / debug snapshot */
  snapshot() {
    const d = this.api.save();
    const fish = FISH.map((f) => entryFish(f, d));
    const creatures = SPECIES.map((sp) => entryCreature(sp, d));
    const treasures = TREASURES.map((t) => entryTreasure(t, d));
    return {
      open: this.open,
      page: this.page,
      fish: { known: fish.filter((x) => x.known).length, total: fish.length, entries: fish },
      creatures: { known: creatures.filter((x) => x.known).length, total: creatures.length, entries: creatures },
      treasures: { known: treasures.filter((x) => x.known).length, total: treasures.length, entries: treasures },
      rewards: {
        fish: { complete: pageComplete('fish', d), claimed: pageClaimed('fish', d) },
        creatures: { complete: pageComplete('creatures', d), claimed: pageClaimed('creatures', d) },
        treasures: { complete: pageComplete('treasures', d), claimed: pageClaimed('treasures', d) },
        next: nextJournalReward(d),
      },
    };
  }

  private render() {
    for (const b of this.tabs.querySelectorAll<HTMLButtonElement>('.journal-tab')) {
      const on = b.dataset.page === this.page;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    }
    if (this.page === 'fish') this.renderFish();
    else if (this.page === 'creatures') this.renderCreatures();
    else this.renderTreasures();
  }

  private renderFish() {
    const d = this.api.save();
    const entries = FISH.map((f) => entryFish(f, d));
    const known = entries.filter((e) => e.known).length;
    this.meta.innerHTML = `<span>${known}/${FISH.length}</span>`;
    // group by water
    const groups: { water: FishDef['water']; title: string; list: typeof entries }[] = [
      { water: 'pond', title: WATER_NAME.pond, list: [] },
      { water: 'sea', title: WATER_NAME.sea, list: [] },
      { water: 'deep', title: WATER_NAME.deep, list: [] },
    ];
    for (const e of entries) groups.find((g) => g.water === e.water)!.list.push(e);
    this.body.innerHTML = banner('fish', d) + groups.map((g) => {
      const k = g.list.filter((e) => e.known).length;
      return `<h3>${esc(g.title)} <small>${k}/${g.list.length}</small></h3>
        <div class="journal-grid">${g.list.map(cardFish).join('')}</div>`;
    }).join('');
  }

  private renderCreatures() {
    const d = this.api.save();
    const entries = SPECIES.map((sp) => entryCreature(sp, d));
    const known = entries.filter((e) => e.known).length;
    this.meta.innerHTML = `<span>${known}/${SPECIES.length}</span>`;
    this.body.innerHTML = banner('creatures', d) + `<div class="hint">Animals you have befriended. Silhouettes wait until you win one over with a favourite snack.</div>
      <div class="journal-grid">${entries.map(cardCreature).join('')}</div>`;
  }

  private renderTreasures() {
    const d = this.api.save();
    const entries = TREASURES.map((t) => entryTreasure(t, d));
    const known = entries.filter((e) => e.known).length;
    this.meta.innerHTML = `<span>${known}/${TREASURES.length}</span>`;
    this.body.innerHTML = banner('treasures', d) + `<div class="hint">Special finds that unlock mounts. Dig treasure maps, and check Shipwreck Cove for the Sea Pearl.</div>
      <div class="journal-grid">${entries.map(cardTreasure).join('')}</div>`;
  }
}

function entryFish(f: FishDef, d: SaveData) {
  const rec = d.fish?.[f.id];
  return {
    id: f.id, name: f.name, icon: f.icon, hue: f.hue, water: f.water, time: f.time, rarity: f.rarity,
    known: !!rec && rec.n > 0,
    n: rec?.n ?? 0,
    best: rec?.best ?? 0,
  };
}
function cardFish(e: ReturnType<typeof entryFish>) {
  if (!e.known) {
    return `<div class="jcard locked" data-id="${e.id}" data-kind="fish"><span class="ji silhouette" style="--hue:${e.hue}">${e.icon}</span><span class="jn">???</span><span class="js">${esc(TIME_HINT[e.time])}</span></div>`;
  }
  return `<div class="jcard found" data-id="${e.id}" data-kind="fish"><span class="ji" style="filter:hue-rotate(${e.hue}deg)">${e.icon}</span><span class="jn">${esc(e.name)}</span><span class="jc">×${e.n}</span><span class="js">best ${e.best} cm</span></div>`;
}

function petsOf(d: SaveData, sp: Species): PetData[] {
  const pets = d.pets ?? {};
  return Object.values(pets).filter((p) => p.sp === sp);
}
function entryCreature(sp: Species, d: SaveData) {
  const t = TASTES[sp];
  const list = petsOf(d, sp);
  const best = list.reduce((a, p) => (p.lvl > a.lvl || (p.lvl === a.lvl && p.love > a.love) ? p : a), list[0] ?? null);
  return {
    id: sp, name: t.name, icon: t.icon,
    known: list.length > 0,
    n: list.length,
    bestLvl: best?.lvl ?? 0,
    bestName: best?.name ?? '',
  };
}
function cardCreature(e: ReturnType<typeof entryCreature>) {
  if (!e.known) {
    return `<div class="jcard locked" data-id="${e.id}" data-kind="creature"><span class="ji silhouette">${e.icon}</span><span class="jn">???</span><span class="js">not yet</span></div>`;
  }
  return `<div class="jcard found" data-id="${e.id}" data-kind="creature"><span class="ji">${e.icon}</span><span class="jn">${esc(e.name)}</span><span class="jc">×${e.n}</span><span class="js">${e.bestName ? esc(e.bestName) + ' · ' : ''}Lv ${e.bestLvl}</span></div>`;
}

function entryTreasure(t: MountTreasure, d: SaveData) {
  return { id: t.id, name: t.name, icon: t.icon, known: !!(d.treasures?.includes(t.id)) };
}
function cardTreasure(e: ReturnType<typeof entryTreasure>) {
  if (!e.known) {
    return `<div class="jcard locked" data-id="${e.id}" data-kind="treasure"><span class="ji silhouette">${e.icon}</span><span class="jn">???</span><span class="js">hidden</span></div>`;
  }
  return `<div class="jcard found" data-id="${e.id}" data-kind="treasure"><span class="ji">${e.icon}</span><span class="jn">${esc(e.name)}</span><span class="js">found!</span></div>`;
}
