export type MouseButtonHandler = (e: PointerEvent, wasDrag: boolean) => void;

/** Keyboard + mouse state with drag-vs-click detection. */
export class Input {
  keys = new Set<string>();
  pressed = new Set<string>(); // pressed this frame
  mouse = { x: 0, y: 0, ndcX: 0, ndcY: 0 };
  dragDX = 0;
  dragDY = 0;
  wheel = 0;
  onClick: MouseButtonHandler[] = [];
  private down: { button: number; x: number; y: number; moved: number } | null = null;

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
      if (k === ' ') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      this.down = { button: e.button, x: e.clientX, y: e.clientY, moved: 0 };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      this.setMouse(e.clientX, e.clientY);
      if (this.down) {
        this.dragDX += e.movementX;
        this.dragDY += e.movementY;
        this.down.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
      }
    });
    el.addEventListener('pointerup', (e) => {
      if (!this.down) return;
      const wasDrag = this.down.moved > 6;
      this.down = null;
      for (const h of this.onClick) h(e, wasDrag);
    });
    el.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
  }
  setMouse(x: number, y: number) {
    const r = this.el.getBoundingClientRect();
    this.mouse.x = x; this.mouse.y = y;
    this.mouse.ndcX = ((x - r.left) / r.width) * 2 - 1;
    this.mouse.ndcY = -((y - r.top) / r.height) * 2 + 1;
  }
  get dragging() { return this.down !== null && this.down.moved > 6; }
  endFrame() {
    this.pressed.clear();
    this.dragDX = this.dragDY = 0;
    this.wheel = 0;
  }
}
