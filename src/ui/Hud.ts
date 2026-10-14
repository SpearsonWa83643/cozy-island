import { setTheme, themeSetting, type ThemeSetting } from '../theme/theme';
import type { Input, Handedness } from '../core/Input';
import { BUILDABLES } from '../build/BuildMode';
import type { Quality } from '../render/Renderer';
import type { AudioEngine } from '../audio/Audio';

export class Hud {
  private fpsEl: HTMLElement;
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
    el(`<div class="hud panel title"><h1>🏝️ Cozy Island</h1><div class="keys">
      <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk &nbsp; <kbd>Shift</kbd> run &nbsp; <kbd>Space</kbd> jump<br>
      <kbd>Drag</kbd> orbit &nbsp; <kbd>Wheel</kbd> zoom &nbsp; <kbd>Z</kbd><kbd>C</kbd> rotate<br>
      <kbd>E</kbd> pick · feed · open &nbsp; <kbd>F</kbd> dig &nbsp; <kbd>Click</kbd> walk / use<br> <kbd>M</kbd> map &nbsp; <kbd>G</kbd> trail &nbsp; <kbd>I</kbd> bag &nbsp; <kbd>O</kbd> wardrobe<br>
      <kbd>B</kbd> build mode &nbsp; <kbd>1</kbd>-<kbd>5</kbd> pick &nbsp; <kbd>R</kbd> rotate piece<br>
      <kbd>Click</kbd> place &nbsp; <kbd>Right-click</kbd>/<kbd>X</kbd> remove &nbsp; <kbd>U</kbd> mute</div>
      <div class="touch-hint">🕹️ Thumb-drag to walk · drag elsewhere to look · pinch to zoom<br>👆 Tap the ground or a thing to walk there · 🔨 Build, tap to place</div></div>`);
    const stats = el(`<div class="hud panel stats"><div class="fps">-- FPS</div>
      <div><button class="qbtn" data-q="low">Low</button> <button class="qbtn" data-q="high">High</button></div>
      <div class="audio-row"><button class="qbtn mute" title="Mute (U)">🔊</button>
        <label title="Music volume">🎵<input type="range" class="vol music" min="0" max="1" step="0.01"></label>
        <label title="Ambience volume">🌿<input type="range" class="vol amb" min="0" max="1" step="0.01"></label></div>
      <div class="hand-row" title="Which thumb drives the floating joystick">🕹️ <button class="qbtn hand" data-h="auto">Auto</button><button class="qbtn hand" data-h="left">Left</button><button class="qbtn hand" data-h="right">Right</button></div>
      <div class="theme-row" title="Seasonal theme (Auto follows the calendar)">🎨 <button class="qbtn th" data-t="auto">Auto</button><button class="qbtn th" data-t="classic">🌿</button><button class="qbtn th" data-t="halloween">🎃</button></div>
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
    BUILDABLES.forEach((b, i) => {
      const s = document.createElement('div');
      s.className = 'slot';
      s.innerHTML = `<b>${i + 1}</b>${b.icon}<span>${b.label}</span>`;
      s.addEventListener('click', () => this.onSelect(i));
      this.hotbar.appendChild(s);
      this.slots.push(s);
    });
  }

  /** seasonal theme picker */
  bindTheme() {
    const btns = [...this.stats.querySelectorAll<HTMLButtonElement>('.th')];
    const sync = () => { for (const b of btns) b.classList.toggle('on', b.dataset.t === themeSetting); };
    for (const b of btns) b.addEventListener('click', (e) => { e.stopPropagation(); setTheme(b.dataset.t as ThemeSetting); sync(); });
    sync();
  }
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
      : `🔨 Build mode · ${BUILDABLES[selected].label} · ${count} placed`;
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
