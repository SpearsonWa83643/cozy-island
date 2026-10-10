import { BUILDABLES } from '../build/BuildMode';
import type { Quality } from '../render/Renderer';

export class Hud {
  private fpsEl: HTMLElement;
  private hotbar: HTMLElement;
  private modeEl: HTMLElement;
  private slots: HTMLElement[] = [];
  private qBtns: Record<Quality, HTMLButtonElement>;
  private frames = 0;
  private last = performance.now();
  fps = 0;
  onQuality: (q: Quality) => void = () => {};
  onSelect: (i: number) => void = () => {};

  constructor(backend: string) {
    const el = (html: string) => { const d = document.createElement('div'); d.innerHTML = html.trim(); const c = d.firstElementChild as HTMLElement; document.body.appendChild(c); return c; };
    el(`<div class="hud panel title"><h1>🏝️ Cozy Island</h1><div class="keys">
      <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk &nbsp; <kbd>Shift</kbd> run &nbsp; <kbd>Space</kbd> jump<br>
      <kbd>Drag</kbd> orbit &nbsp; <kbd>Wheel</kbd> zoom &nbsp; <kbd>Q</kbd><kbd>E</kbd> rotate<br>
      <kbd>B</kbd> build mode &nbsp; <kbd>1</kbd>-<kbd>5</kbd> pick &nbsp; <kbd>R</kbd> rotate piece<br>
      <kbd>Click</kbd> place &nbsp; <kbd>Right-click</kbd>/<kbd>X</kbd> remove</div></div>`);
    const stats = el(`<div class="hud panel stats"><div class="fps">-- FPS</div>
      <div><button class="qbtn" data-q="low">Low</button> <button class="qbtn" data-q="high">High</button></div>
      <div class="backend">Renderer: ${backend}</div></div>`);
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

  setQuality(q: Quality) {
    this.qBtns.low.classList.toggle('on', q === 'low');
    this.qBtns.high.classList.toggle('on', q === 'high');
  }

  setBuild(active: boolean, selected: number, count: number) {
    this.hotbar.classList.toggle('off', !active);
    this.modeEl.classList.toggle('off', !active);
    this.modeEl.textContent = `🔨 Build mode · ${BUILDABLES[selected].label} · ${count} placed`;
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
