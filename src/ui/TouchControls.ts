import type { Input } from '../core/Input';
import type { BuildMode } from '../build/BuildMode';

/**
 * On-screen controls for touch devices: left virtual joystick, Jump / Build
 * buttons, and in build mode Rotate + Remove toggle. Camera orbit (drag) and
 * pinch zoom are handled by Input on the canvas itself.
 */
export class TouchControls {
  private root: HTMLElement;
  private base: HTMLElement;
  private knob: HTMLElement;
  private stickId: number | null = null;
  private center = { x: 0, y: 0 };
  private radius = 52;
  private buildBtn: HTMLElement;
  private removeBtn: HTMLElement;
  private rotateBtn: HTMLElement;

  constructor(private input: Input, private build: BuildMode) {
    document.body.classList.add('touch');
    this.root = document.createElement('div');
    this.root.className = 'touch-ui';
    this.root.innerHTML = `
      <div class="stick"><div class="knob"></div></div>
      <div class="tbtns">
        <button class="tbtn rotate" aria-label="Rotate piece">⟳<span>Rotate</span></button>
        <button class="tbtn remove" aria-label="Remove mode">✖<span>Remove</span></button>
        <button class="tbtn build" aria-label="Build mode">🔨<span>Build</span></button>
        <button class="tbtn jump big" aria-label="Jump">⤒<span>Jump</span></button>
      </div>`;
    document.body.appendChild(this.root);
    this.base = this.root.querySelector('.stick')!;
    this.knob = this.root.querySelector('.knob')!;
    this.buildBtn = this.root.querySelector('.build')!;
    this.removeBtn = this.root.querySelector('.remove')!;
    this.rotateBtn = this.root.querySelector('.rotate')!;

    // Joystick
    this.base.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (this.stickId !== null) return;
      this.stickId = e.pointerId;
      const r = this.base.getBoundingClientRect();
      this.center = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      this.radius = r.width * 0.4;
      this.base.setPointerCapture(e.pointerId);
      this.moveStick(e.clientX, e.clientY);
      this.base.classList.add('active');
    });
    this.base.addEventListener('pointermove', (e) => { if (e.pointerId === this.stickId) this.moveStick(e.clientX, e.clientY); });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.input.stick.x = this.input.stick.y = 0;
      this.knob.style.transform = 'translate(-50%, -50%)';
      this.base.classList.remove('active');
    };
    this.base.addEventListener('pointerup', release);
    this.base.addEventListener('pointercancel', release);

    // Buttons fire on pointerdown for responsiveness.
    const tap = (el: HTMLElement, fn: () => void) => el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      el.classList.add('down');
      fn();
    });
    for (const b of this.root.querySelectorAll<HTMLElement>('.tbtn')) {
      const up = () => b.classList.remove('down');
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
    }
    tap(this.root.querySelector('.jump')!, () => this.input.pressed.add(' '));
    tap(this.buildBtn, () => this.input.pressed.add('b'));
    tap(this.rotateBtn, () => this.input.pressed.add('r'));
    tap(this.removeBtn, () => this.build.setRemoveMode(!this.build.removeMode));
    this.sync();
  }

  private moveStick(x: number, y: number) {
    let dx = x - this.center.x, dy = y - this.center.y;
    const d = Math.hypot(dx, dy);
    if (d > this.radius) { dx *= this.radius / d; dy *= this.radius / d; }
    this.input.stick.x = dx / this.radius;
    this.input.stick.y = dy / this.radius;
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  /** Reflect build-mode state on the buttons. */
  sync() {
    const on = this.build.active;
    this.root.classList.toggle('building', on);
    this.buildBtn.classList.toggle('on', on);
    this.removeBtn.classList.toggle('on', this.build.removeMode);
  }
}
