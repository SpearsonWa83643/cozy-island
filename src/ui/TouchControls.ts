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
  private mountBtn: HTMLElement | null = null;
  private mountState = '';

  constructor(private input: Input, private getBuild: () => BuildMode | null) {
    document.body.classList.add('touch');
    this.root = document.createElement('div');
    this.root.className = 'touch-ui';
    this.root.innerHTML = `
      <div class="stick"><div class="knob"></div></div>
      <button class="eye-btn" aria-label="Look around (hold and drag)"><span class="eye-ball"><span class="eye-pupil"></span></span></button>
      <button class="mount-btn" aria-label="Call Mount"><span class="mi">🦅</span><span class="ml">Call Mount</span></button>
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

    // Eye (free look): press the eye, then drag anywhere to orbit the camera; release ends it.
    // It owns its own pointer (captured), so it works alongside the joystick thumb and never becomes a tap/pinch.
    const eye = this.root.querySelector<HTMLElement>('.eye-btn')!;
    const pupil = eye.querySelector<HTMLElement>('.eye-pupil')!;
    let eyeId = -1, ex = 0, ey = 0, sx = 0, sy = 0;
    const EYE_GAIN = 1.25;
    eye.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (eyeId !== -1) return;
      eyeId = e.pointerId; ex = sx = e.clientX; ey = sy = e.clientY;
      try { eye.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      eye.classList.add('down');
      this.input.eyeLook = true;
    });
    eye.addEventListener('pointermove', (e) => {
      if (e.pointerId !== eyeId) return;
      e.preventDefault();
      this.input.dragDX += (e.clientX - ex) * EYE_GAIN;
      this.input.dragDY += (e.clientY - ey) * EYE_GAIN;
      ex = e.clientX; ey = e.clientY;
      // the pupil glances the way you're looking
      const dx = e.clientX - sx, dy = e.clientY - sy, d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 40) * 7;
      pupil.style.transform = `translate(calc(-50% + ${(dx / d) * k}px), calc(-50% + ${(dy / d) * k}px))`;
    });
    const eyeUp = (e: PointerEvent) => {
      if (e.pointerId !== eyeId) return;
      eyeId = -1; eye.classList.remove('down'); this.input.eyeLook = false;
      pupil.style.transform = '';
    };
    eye.addEventListener('pointerup', eyeUp); eye.addEventListener('pointercancel', eyeUp); eye.addEventListener('lostpointercapture', eyeUp);

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
    tap(this.removeBtn, () => { const b = this.getBuild(); if (b) b.setRemoveMode(!b.removeMode); });
    this.mountBtn = this.root.querySelector('.mount-btn');
    this.sync();
  }

  /** Call Mount sits above Dig/Build (dominant-hand side, mirrors the eye button). */
  bindMount(press: () => boolean | void, state: () => string, icon: () => string = () => '🦅') {
    const btn = this.mountBtn; if (!btn) return;
    const doTap = (el: HTMLElement, fn: () => void) => el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      el.classList.add('down'); fn();
    });
    doTap(btn, () => { press(); this.refreshMount(state(), icon()); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) btn.addEventListener(ev, () => btn.classList.remove('down'));
    // keep label in sync every frame via rAF (cheap)
    const tick = () => { this.refreshMount(state(), icon()); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
  private refreshMount(st: string, icon: string) {
    const btn = this.mountBtn; if (!btn || st + icon === this.mountState) return;
    this.mountState = st + icon;
    const ml = btn.querySelector('.ml')!, mi = btn.querySelector('.mi')!;
    btn.classList.toggle('busy', st === 'busy');
    btn.classList.toggle('blocked', st === 'blocked');
    btn.classList.toggle('on', st === 'hop' || st === 'land');
    mi.innerHTML = st === 'land' ? '🛬' : icon;
    if (st === 'land') { ml.textContent = 'Land'; btn.setAttribute('aria-label', 'Land'); }
    else if (st === 'hop') { ml.textContent = 'Hop on'; btn.setAttribute('aria-label', 'Hop on'); }
    else if (st === 'busy') { ml.textContent = '…'; btn.setAttribute('aria-label', 'Mount busy'); }
    else { ml.textContent = 'Call Mount'; btn.setAttribute('aria-label', 'Call Mount'); }
  }

  /** Reflect build-mode state on the buttons. */
  sync() {
    const b = this.getBuild();
    const on = !!b?.active;
    this.root.classList.toggle('building', on);
    this.buildBtn.classList.toggle('on', on);
    this.removeBtn.classList.toggle('on', !!b?.removeMode);
    this.mountBtn?.classList.toggle('hide', on);
  }
}
