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
  private float: HTMLElement;
  private fknob: HTMLElement;
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
        <button class="tbtn dig" aria-label="Dig (hold to keep digging)">🪏<span>Dig</span></button>
        <button class="tbtn build" aria-label="Build mode">🔨<span>Build</span></button>
        <button class="tbtn jump big" aria-label="Jump">⤒<span>Jump</span></button>
      </div>`;
    document.body.appendChild(this.root);
    this.base = this.root.querySelector('.stick')!;
    this.buildBtn = this.root.querySelector('.build')!;
    this.removeBtn = this.root.querySelector('.remove')!;
    this.rotateBtn = this.root.querySelector('.rotate')!;

    // Floating joystick: Input owns the logic (canvas touches), we just draw it. The fixed ring is an idle hint.
    this.input.floatingStick = true;
    this.float = document.createElement('div');
    this.float.className = 'fstick';
    this.float.innerHTML = '<div class="knob"></div>';
    this.root.appendChild(this.float);
    this.fknob = this.float.querySelector('.knob')!;
    const draw = () => {
      const u = this.input.stickUi;
      this.float.classList.toggle('show', u.active);
      this.base.classList.toggle('idle-hide', u.active);
      if (u.active) {
        this.float.style.transform = `translate(${u.ox}px, ${u.oy}px)`;
        this.fknob.style.transform = `translate(calc(-50% + ${u.kx - u.ox}px), calc(-50% + ${u.ky - u.oy}px))`;
      }
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);

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
    // Dig: hold to keep digging
    const dig = this.root.querySelector<HTMLElement>('.dig')!;
    tap(dig, () => { this.input.pressed.add('f'); this.input.keys.add('f'); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) dig.addEventListener(ev, () => this.input.keys.delete('f'));
    tap(this.rotateBtn, () => this.input.pressed.add('r'));
    tap(this.removeBtn, () => this.build.setRemoveMode(!this.build.removeMode));
    this.sync();
  }

  /** Reflect build-mode state on the buttons. */
  sync() {
    const on = this.build.active;
    this.root.classList.toggle('building', on);
    this.buildBtn.classList.toggle('on', on);
    this.removeBtn.classList.toggle('on', this.build.removeMode);
  }
}
