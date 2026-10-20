import { setTheme, themeSetting, themeForDate, THEMES, VISIBLE_THEMES, type ThemeSetting } from '../theme/theme';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtWin = (w: { from: [number, number]; to: [number, number] }) => `${MON[w.from[0] - 1]} ${w.from[1]} – ${MON[w.to[0] - 1]} ${w.to[1]}`;
import type { Input, Handedness } from '../core/Input';
import { BUILD_CATALOG } from '../build/catalog';
import type { Quality } from '../render/Renderer';
import type { AudioEngine } from '../audio/Audio';

export class Hud {
  private fpsEl: HTMLElement;
  private titleEl: HTMLElement;
  private hotbar: HTMLElement;
  private modeEl: HTMLElement;
  private slots: HTMLElement[] = [];
  private qBtns: Record<Quality, HTMLButtonElement>;
  private frames = 0;
  private last = performance.now();
  fps = 0;
  private stats!: HTMLElement;
  onQuality: (q: Quality) => void = () => {};
  onSelect: (i: number) => void = () => {};

  constructor(backend: string) {
    const el = (html: string) => { const d = document.createElement('div'); d.innerHTML = html.trim(); const c = d.firstElementChild as HTMLElement; document.body.appendChild(c); return c; };
    this.titleEl = el(`<div class="hud panel title corner"><h1>🏝️ Cozy Island</h1><div class="keys">
      <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk &nbsp; <kbd>Shift</kbd> run &nbsp; <kbd>Space</kbd> jump<br>
      <kbd>Drag</kbd> orbit &nbsp; <kbd>Wheel</kbd> zoom &nbsp; <kbd>Z</kbd><kbd>C</kbd> rotate<br>
      <kbd>E</kbd> pick · feed · open &nbsp; <kbd>F</kbd> dig &nbsp; <kbd>V</kbd> Call Mount &nbsp; <kbd>Click</kbd> walk / use<br> <kbd>M</kbd> map &nbsp; <kbd>G</kbd> trail &nbsp; <kbd>I</kbd> bag &nbsp; <kbd>O</kbd> wardrobe<br>
      <kbd>B</kbd> build mode &nbsp; <kbd>1</kbd>-<kbd>5</kbd> pick &nbsp; <kbd>R</kbd> rotate piece<br>
      <kbd>Click</kbd> place &nbsp; <kbd>Right-click</kbd>/<kbd>X</kbd> remove &nbsp; <kbd>U</kbd> mute</div>
      <div class="touch-hint">🕹️ Thumb-drag to walk · drag elsewhere to look · pinch to zoom<br>👆 Tap the ground or a thing to walk there · 🔨 Build, tap to place</div></div>`);
    const stats = el(`<div class="hud panel stats corner"><div class="fps">-- FPS</div>
      <div><button class="qbtn" data-q="low">Low</button> <button class="qbtn" data-q="high">High</button></div>
      <div class="audio-row"><button class="qbtn mute" title="Mute (U)">🔊</button>
        <label title="Music volume">🎵<input type="range" class="vol music" min="0" max="1" step="0.01"></label>
        <label title="Ambience volume">🌿<input type="range" class="vol amb" min="0" max="1" step="0.01"></label></div>
      <div class="hand-row" title="Which thumb drives the floating joystick">🕹️ <button class="qbtn hand" data-h="auto">Auto</button><button class="qbtn hand" data-h="left">Left</button><button class="qbtn hand" data-h="right">Right</button></div>
      <div class="who-row"><button class="qbtn who" type="button" title="Who's playing?" aria-label="Who's playing?">👤 Who's playing?</button></div>
      <div class="sound-hint">🔈 Tap or press any key for sound</div>
      <div class="biome-name">📍 Meadow</div>
      <div class="backend">Renderer: ${backend}</div></div>`);
    this.stats = stats;
    this.fpsEl = stats.querySelector('.fps')!;
    this.qBtns = {
      low: stats.querySelector('[data-q=low]') as HTMLButtonElement,
      high: stats.querySelector('[data-q=high]') as HTMLButtonElement,
    };
    for (const q of ['low', 'high'] as Quality[]) this.qBtns[q].addEventListener('click', (e) => { e.stopPropagation(); this.onQuality(q); (e.target as HTMLElement).blur(); });
    this.modeEl = el(`<div class="hud mode off">🔨 Build mode</div>`);
    this.hotbar = el(`<div class="hud hotbar off"></div>`);
    BUILD_CATALOG.forEach((b, i) => {
      const s = document.createElement('div');
      s.className = 'slot';
      s.innerHTML = `<b>${i + 1}</b>${b.icon}<span>${b.label}</span>`;
      s.addEventListener('click', () => this.onSelect(i));
      this.hotbar.appendChild(s);
      this.slots.push(s);
    });
  }

  /** corner dock: ⚙️ toggles the corner panels (hidden by default, persisted), 🎨 opens the theme picker */
  private dock!: HTMLElement;
  private picker!: HTMLElement;
  bindDock(load: () => boolean, save: (open: boolean) => void) {
    const el = (html: string) => { const d = document.createElement('div'); d.innerHTML = html.trim(); const c = d.firstElementChild as HTMLElement; document.body.appendChild(c); return c; };
    this.dock = el(`<div class="hud dock"><button class="dbtn theme-btn" title="Theme" aria-label="Theme">🎨</button><button class="dbtn gear" title="Settings & help" aria-label="Settings">⚙️</button></div>`);
    const gear = this.dock.querySelector('.gear') as HTMLButtonElement, tb = this.dock.querySelector('.theme-btn') as HTMLButtonElement;
    const setOpen = (o: boolean) => { document.body.classList.toggle('panels-open', o); gear.classList.toggle('on', o); gear.setAttribute('aria-expanded', String(o)); };
    setOpen(load());
    const stop = (e: Event) => e.stopPropagation();
    for (const ev of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'mouseup'] as const) this.dock.addEventListener(ev, stop);
    gear.addEventListener('click', (e) => { e.stopPropagation(); const o = !document.body.classList.contains('panels-open'); setOpen(o); save(o); this.closePicker(); gear.blur(); });
    // picker: Auto + every enabled theme (VISIBLE_THEMES; hidden holidays stay out)
    this.picker = el(`<div class="hud theme-picker" role="menu"><div class="tp-title">🎨 Theme</div>${
      [`<button class="tp-item" data-t="auto"><span class="tpi">📅</span><span><b>Auto</b><small>by date · now ${THEMES[themeForDate()].name}</small></span></button>`,
        ...VISIBLE_THEMES.map((id) => `<button class="tp-item" data-t="${id}"><span class="tpi">${THEMES[id].icon}</span><span><b>${THEMES[id].name}</b>${THEMES[id].window ? `<small>${fmtWin(THEMES[id].window!)}</small>` : '<small>all year</small>'}</span></button>`)].join('')}</div>`);
    for (const ev of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'mouseup'] as const) this.picker.addEventListener(ev, stop);
    const sync = () => { for (const b of this.picker.querySelectorAll<HTMLButtonElement>('.tp-item')) b.classList.toggle('on', b.dataset.t === themeSetting); tb.textContent = themeSetting === 'auto' ? '🎨' : THEMES[themeSetting].icon; };
    for (const b of this.picker.querySelectorAll<HTMLButtonElement>('.tp-item')) b.addEventListener('click', (e) => { e.stopPropagation(); setTheme(b.dataset.t as ThemeSetting); sync(); setTimeout(() => this.closePicker(), 180); });
    tb.addEventListener('click', (e) => { e.stopPropagation(); const o = !this.picker.classList.contains('open'); this.picker.classList.toggle('open', o); tb.classList.toggle('on', o); tb.blur(); });
    window.addEventListener('pointerdown', (e) => { if (this.picker.classList.contains('open') && !this.picker.contains(e.target as Node) && !this.dock.contains(e.target as Node)) this.closePicker(); }, { capture: true });
    sync();
  }
  closePicker() { this.picker?.classList.remove('open'); this.dock?.querySelector('.theme-btn')?.classList.remove('on'); }
  /** hotbar shows only pieces the active theme allows */
  syncBuildables(avail: (i: number) => boolean) { this.slots.forEach((s, i) => { s.style.display = avail(i) ? '' : 'none'; }); }
  /** handedness for the floating joystick (touch only) */
  bindHand(input: Input) {
    const btns = [...this.stats.querySelectorAll<HTMLButtonElement>('.hand')];
    const sync = () => { for (const b of btns) b.classList.toggle('on', b.dataset.h === input.hand); document.body.dataset.hand = input.hand; };
    for (const b of btns) b.addEventListener('click', () => { input.setHand(b.dataset.h as Handedness); sync(); });
    sync();
  }
  bindAudio(a: AudioEngine) {
    const s = this.stats;
    const mute = s.querySelector('.mute') as HTMLButtonElement;
    const music = s.querySelector('.music') as HTMLInputElement, amb = s.querySelector('.amb') as HTMLInputElement;
    const hint = s.querySelector('.sound-hint') as HTMLElement;
    const sync = () => { mute.textContent = a.settings.muted ? '🔇' : '🔊'; mute.classList.toggle('on', !a.settings.muted); music.value = String(a.settings.music); amb.value = String(a.settings.ambience); };
    sync();
    const stop = (e: Event) => e.stopPropagation();
    for (const el of [mute, music, amb]) { el.addEventListener('pointerdown', stop); el.addEventListener('keydown', stop); }
    mute.addEventListener('click', (e) => { e.stopPropagation(); a.unlock(); a.settings.muted = !a.settings.muted; a.save(); sync(); mute.blur(); });
    window.addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 'u' && (e.target as HTMLElement)?.tagName !== 'INPUT') { a.settings.muted = !a.settings.muted; a.save(); sync(); } });
    music.addEventListener('input', () => { a.settings.music = +music.value; a.save(); });
    amb.addEventListener('input', () => { a.settings.ambience = +amb.value; a.save(); });
    const showHint = () => hint.classList.toggle('hidden', a.started);
    a.onUnlock = () => setTimeout(showHint, 300);
    showHint();
  }


  /** show the saved player name in the corner title when set */
  setPlayerName(name: string) {
    const h = this.titleEl.querySelector('h1');
    if (!h) return;
    const n = (name || '').trim();
    h.textContent = n ? `🏝️ ${n}'s Island` : '🏝️ Cozy Island';
  }

  /** ⚙️ panel: reopen the entry / who's-playing card */
  bindPlayer(open: () => void) {
    const b = this.stats.querySelector('.who') as HTMLButtonElement | null;
    if (!b) return;
    b.addEventListener('click', (e) => { e.stopPropagation(); open(); b.blur(); });
  }

  setBiome(name: string) {
    const el = this.stats.querySelector('.biome-name') as HTMLElement;
    const txt = `📍 ${name}`;
    if (el.textContent !== txt) el.textContent = txt;
  }

  setQuality(q: Quality) {
    this.qBtns.low.classList.toggle('on', q === 'low');
    this.qBtns.high.classList.toggle('on', q === 'high');
  }

  setBuild(active: boolean, selected: number, count: number, removing = false) {
    this.hotbar.classList.toggle('off', !active);
    this.modeEl.classList.toggle('off', !active);
    this.modeEl.style.background = removing ? '#ff7b7b' : '';
    this.modeEl.textContent = removing
      ? `✖ Remove mode · tap a piece to remove · ${count} placed`
      : `🔨 Build mode · ${BUILD_CATALOG[selected].label} · ${count} placed`;
    this.slots.forEach((s, i) => s.classList.toggle('sel', i === selected));
  }

  /** Real wall-clock FPS (not the clamped sim dt). */
  tick() {
    this.frames++;
    const now = performance.now();
    const el = (now - this.last) / 1000;
    if (el >= 0.5) {
      this.fps = this.frames / el;
      this.fpsEl.textContent = `${this.fps < 10 ? this.fps.toFixed(1) : this.fps.toFixed(0)} FPS`;
      this.frames = 0; this.last = now;
    }
  }
}
