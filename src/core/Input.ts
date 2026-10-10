export type MouseButtonHandler = (e: PointerEvent, wasDrag: boolean) => void;

/** True on touch-first devices (iPad/phones). Override with ?touch=1 / ?touch=0. */
export function detectTouch(): boolean {
  const p = new URLSearchParams(location.search).get('touch');
  if (p === '1') return true;
  if (p === '0') return false;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const noHover = !matchMedia('(hover: hover)').matches;
  return coarse || (navigator.maxTouchPoints > 0 && noHover);
}

interface Ptr { id: number; type: string; button: number; x: number; y: number; sx: number; sy: number; moved: number; t: number; }
export type Handedness = 'auto' | 'left' | 'right';
const HAND_KEY = 'cozyIsland.hand.v1';
/** floating joystick (matches the 2D game's feel): appears under the thumb, activates after 12 px, base follows past the rim */
export const STICK_R = 62, STICK_ACTIVATE = 12;

/**
 * Keyboard + mouse/touch state. Single-pointer drag on the canvas orbits, a
 * two-finger pinch zooms, and a short press without movement is a click/tap.
 * Touch UI writes into `stick` (virtual joystick) and `pressed` (buttons).
 */
export class Input {
  keys = new Set<string>();
  pressed = new Set<string>(); // pressed this frame
  mouse = { x: 0, y: 0, ndcX: 0, ndcY: 0 };
  stick = { x: 0, y: 0 }; // virtual joystick, -1..1, y<0 = forward
  dragDX = 0;
  dragDY = 0;
  wheel = 0;
  pinch = 1; // multiplicative zoom factor this frame (>1 = fingers apart = zoom in)
  onClick: MouseButtonHandler[] = [];
  /** called the moment the joystick takes over (cancels tap-to-walk) */
  onStickStart: (() => void)[] = [];
  /** floating stick state for the UI */
  stickUi = { on: false, active: false, ox: 0, oy: 0, kx: 0, ky: 0 };
  hand: Handedness = 'auto';
  /** touch-first: canvas touches can become the floating joystick */
  floatingStick = false;
  private stickPtr: Ptr | null = null;
  private ptrs = new Map<number, Ptr>();
  private pinchDist = 0;
  private multiTouched = false; // gesture used 2+ fingers -> never a tap

  constructor(private el: HTMLElement) {
    try { const h = localStorage.getItem(HAND_KEY); if (h === 'left' || h === 'right' || h === 'auto') this.hand = h; } catch { /* private mode */ }
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
      if (k === ' ') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => { this.keys.clear(); this.ptrs.clear(); this.stickPtr = null; this.stickUi.on = this.stickUi.active = false; this.stick.x = this.stick.y = 0; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.setMouse(e.clientX, e.clientY);
      const np: Ptr = { id: e.pointerId, type: e.pointerType, button: e.button, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: 0, t: performance.now() };
      if (this.floatingStick && e.pointerType !== 'mouse' && !this.stickPtr && this.ptrs.size === 0 && this.isStickZone(e.clientX, e.clientY)) {
        // this finger is the (not yet visible) joystick; it stays out of orbit/pinch
        this.stickPtr = np;
        Object.assign(this.stickUi, { on: true, active: false, ox: e.clientX, oy: e.clientY, kx: e.clientX, ky: e.clientY });
        try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        return;
      }
      // a second finger before the stick woke up → it was a pinch / two-finger gesture, not a stick
      const sp = this.stickPtr;
      if (sp && !this.stickUi.active) { this.stickPtr = null; this.stickUi.on = false; this.ptrs.set(sp.id, sp); }
      this.ptrs.set(e.pointerId, np);
      if (this.ptrs.size === 1) this.multiTouched = false;
      if (this.ptrs.size >= 2) { this.multiTouched = true; this.pinchDist = this.twoFingerDist(); }
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    el.addEventListener('pointermove', (e) => {
      const sp = this.stickPtr;
      if (sp && sp.id === e.pointerId) { this.moveStick(sp, e.clientX, e.clientY); return; }
      const p = this.ptrs.get(e.pointerId);
      if (!p) { this.setMouse(e.clientX, e.clientY); return; }
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      p.moved += Math.abs(dx) + Math.abs(dy);
      if (this.ptrs.size >= 2) {
        const d = this.twoFingerDist();
        if (this.pinchDist > 0 && d > 0) this.pinch *= d / this.pinchDist;
        this.pinchDist = d;
      } else {
        this.setMouse(e.clientX, e.clientY);
        this.dragDX += dx;
        this.dragDY += dy;
      }
    });
    const end = (e: PointerEvent, cancelled: boolean) => {
      const sp = this.stickPtr;
      if (sp && sp.id === e.pointerId) {
        this.stickPtr = null;
        const wasStick = this.stickUi.active;
        this.stickUi.on = false; this.stickUi.active = false;
        this.stick.x = this.stick.y = 0;
        // a short press that never became a stick is a tap (tap-to-walk / interact)
        if (!cancelled && !wasStick && performance.now() - sp.t < 400) for (const h of this.onClick) h(e, false);
        return;
      }
      const p = this.ptrs.get(e.pointerId);
      if (!p) return;
      this.ptrs.delete(e.pointerId);
      if (this.ptrs.size >= 2) this.pinchDist = this.twoFingerDist();
      if (cancelled || this.multiTouched) return;
      const wasDrag = p.moved > (p.type === 'touch' ? 12 : 6);
      for (const h of this.onClick) h(e, wasDrag);
    };
    el.addEventListener('pointerup', (e) => end(e, false));
    el.addEventListener('pointercancel', (e) => end(e, true));
    el.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
  }
  /** which touches start the joystick: left/right half for fixed handedness; auto = either side, lower 60% of the screen */
  isStickZone(x: number, y: number) {
    const w = window.innerWidth, h = window.innerHeight;
    if (this.hand === 'left') return x < w * 0.5;
    if (this.hand === 'right') return x >= w * 0.5;
    return y > h * 0.4;
  }
  setHand(h: Handedness) { this.hand = h; try { localStorage.setItem(HAND_KEY, h); } catch { /* ignore */ } }
  private moveStick(sp: Ptr, x: number, y: number) {
    const u = this.stickUi;
    sp.moved += Math.abs(x - sp.x) + Math.abs(y - sp.y); sp.x = x; sp.y = y;
    if (!u.active) {
      if (Math.hypot(x - sp.sx, y - sp.sy) <= STICK_ACTIVATE) return;
      u.active = true;
      for (const f of this.onStickStart) f();
    }
    let dx = x - u.ox, dy = y - u.oy;
    const d = Math.hypot(dx, dy);
    if (d > STICK_R) { u.ox += (dx / d) * (d - STICK_R); u.oy += (dy / d) * (d - STICK_R); dx = x - u.ox; dy = y - u.oy; }
    u.kx = u.ox + dx; u.ky = u.oy + dy;
    this.stick.x = dx / STICK_R; this.stick.y = dy / STICK_R;
  }
  private twoFingerDist() {
    const a = [...this.ptrs.values()];
    return a.length < 2 ? 0 : Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
  }
  setMouse(x: number, y: number) {
    const r = this.el.getBoundingClientRect();
    this.mouse.x = x; this.mouse.y = y;
    this.mouse.ndcX = ((x - r.left) / r.width) * 2 - 1;
    this.mouse.ndcY = -((y - r.top) / r.height) * 2 + 1;
  }
  endFrame() {
    this.pressed.clear();
    this.dragDX = this.dragDY = 0;
    this.wheel = 0;
    this.pinch = 1;
  }
}
