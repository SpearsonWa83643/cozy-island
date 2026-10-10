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

interface Ptr { id: number; type: string; button: number; x: number; y: number; sx: number; sy: number; moved: number; }

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
  private ptrs = new Map<number, Ptr>();
  private pinchDist = 0;
  private multiTouched = false; // gesture used 2+ fingers -> never a tap

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
      if (k === ' ') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => { this.keys.clear(); this.ptrs.clear(); });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.setMouse(e.clientX, e.clientY);
      this.ptrs.set(e.pointerId, { id: e.pointerId, type: e.pointerType, button: e.button, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: 0 });
      if (this.ptrs.size === 1) this.multiTouched = false;
      if (this.ptrs.size >= 2) { this.multiTouched = true; this.pinchDist = this.twoFingerDist(); }
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    el.addEventListener('pointermove', (e) => {
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
