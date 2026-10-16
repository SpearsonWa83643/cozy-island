/** Cozy loading screen: progress bar + friendly stage text, and a yield helper so it repaints between steps. */
const STAGES: Record<string, string> = {
  start: 'Waking up the island…',
  physics: 'Shaping the hills…',
  terrain: 'Filling the lagoon…',
  water: 'Planting flowers and trees…',
  flora: 'Lighting the crystal cave…',
  cave: 'Waking the animals…',
  fauna: 'Painting the coral reef…',
  reef: 'Warming up the sunshine…',
  renderer: 'Packing your bag…',
  gameplay: 'Hanging the decorations…',
  dress: 'Mixing the colours…',
};

export class Loader {
  private fill = document.getElementById('ld-fill') as HTMLElement | null;
  private stage = document.getElementById('ld-stage') as HTMLElement | null;
  private shown = 0;

  /** p in 0..1; text optional (falls back to the stage table). */
  set(p: number, key?: string, text?: string) {
    this.shown = Math.max(this.shown, Math.min(1, p));
    if (this.fill) this.fill.style.transform = `scaleX(${this.shown.toFixed(3)})`;
    const t = text ?? (key ? STAGES[key] : undefined);
    if (t && this.stage && this.stage.textContent !== t) this.stage.textContent = t;
    document.getElementById('loading')?.setAttribute('aria-valuenow', String(Math.round(this.shown * 100)));
  }

  hide() { document.getElementById('loading')?.classList.add('hide'); }
}

/** Let the browser paint (rAF then a macrotask); falls back to a timeout when rAF is throttled. */
export function nextPaint(): Promise<void> {
  return new Promise((res) => {
    let done = false;
    const go = () => { if (!done) { done = true; res(); } };
    requestAnimationFrame(() => setTimeout(go, 0));
    setTimeout(go, 60);
  });
}
