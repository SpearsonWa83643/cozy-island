/** ?debug load-timing overlay + performance marks. Console + on-screen. */
export type LoadMarks = Record<string, number>;

const CSS = `
#load-timing{position:fixed;top:8px;left:8px;z-index:9999;pointer-events:none;
  font:600 13px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  color:#e8fff0;background:rgba(0,12,8,.82);border:1px solid #3dff9a;
  border-radius:10px;padding:10px 12px;max-width:min(420px,92vw);
  text-shadow:0 1px 2px #000;box-shadow:0 4px 18px rgba(0,0,0,.45);
  white-space:pre;letter-spacing:.02em}
@media (pointer:coarse){#load-timing{font-size:15px;padding:12px 14px;top:max(8px,env(safe-area-inset-top));left:max(8px,env(safe-area-inset-left))}}
`;

function navDownloadMs(): number | null {
  try {
    const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (!n || !Number.isFinite(n.responseEnd) || n.responseEnd <= 0) return null;
    return Math.max(0, n.responseEnd - n.fetchStart);
  } catch { return null; }
}

let shared: LoadTiming | null = null;
/** a frame this long is a visible hitch (below 20 fps); the 30 fps floor is 33 ms */
export const LONG_MS = 50;
const WINDOW_MS = 10_000;

export class LoadTiming {
  readonly enabled: boolean;
  readonly t0: number;
  readonly marks: LoadMarks = {};
  private el: HTMLPreElement | null = null;
  private firstFrameDone = false;
  /** first-10 s frame stats after the world appears (Order 30.5): long = over LONG_MS */
  readonly frames = { n: 0, long: 0, max: 0, sum: 0, done: false, deltas: [] as number[] };
  private fStart = 0; private fLast = 0; private fPaintT = 0;

  constructor(enabled: boolean, t0 = performance.now()) {
    this.enabled = enabled;
    this.t0 = t0;
    if (enabled) this.mount();
    const dl = navDownloadMs();
    if (dl != null) this.marks.download = dl;
    this.expose();
  }

  /** Wall-clock ms since t0; always records; console + overlay only when enabled. */
  mark(name: string) {
    const ms = performance.now() - this.t0;
    this.marks[name] = ms;
    try { performance.mark(`cozy-load:${name}`); } catch { /* */ }
    if (this.enabled) {
      console.info(`[startup] ${name}: ${ms.toFixed(0)} ms`);
      this.paint();
    }
    this.expose();
  }

  firstFrame() {
    if (this.firstFrameDone) { this.trackFrame(); return; }
    this.firstFrameDone = true;
    this.mark('firstFrame');
    this.mark('interactive');
    this.fStart = this.fLast = performance.now();
  }

  /** Per-frame: record frame times for the first WINDOW_MS after the first visible frame. */
  private trackFrame() {
    const f = this.frames;
    if (f.done) return;
    const now = performance.now();
    const d = now - this.fLast;
    this.fLast = now;
    f.n++; f.sum += d; if (d > f.max) f.max = d; if (d > LONG_MS) f.long++;
    if (f.deltas.length < 2000) f.deltas.push(Math.round(d * 10) / 10);
    if (now - this.fStart >= WINDOW_MS) {
      f.done = true;
      if (this.enabled) console.info(`[startup] first 10 s: ${f.n} frames, ${f.long} long (>${LONG_MS} ms), max ${f.max.toFixed(0)} ms`);
      this.paint();
    } else if (this.enabled && now - this.fPaintT > 500) { this.fPaintT = now; this.paint(); }
  }

  private mount() {
    const existing = document.getElementById('load-timing') as HTMLPreElement | null;
    if (existing) { this.el = existing; this.paint(); return; }
    if (!document.getElementById('load-timing-css')) {
      const st = document.createElement('style');
      st.id = 'load-timing-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const el = document.createElement('pre');
    el.id = 'load-timing';
    el.setAttribute('aria-label', 'Load timing');
    document.body.appendChild(el);
    this.el = el;
    this.paint();
  }

  private paint() {
    if (!this.el) return;
    const lines = ['load timing (?debug)'];
    const order = [
      'module', 'download', 'physics', 'terrain', 'water', 'flora', 'cave', 'fauna', 'reef',
      'renderer', 'gameplay', 'dress', 'compile', 'settle', 'firstFrame', 'interactive',
    ];
    const seen = new Set<string>();
    for (const k of order) {
      if (k in this.marks) { lines.push(`${k.padEnd(12)} ${this.marks[k]!.toFixed(0)} ms`); seen.add(k); }
    }
    for (const k of Object.keys(this.marks)) {
      if (!seen.has(k)) lines.push(`${k.padEnd(12)} ${this.marks[k]!.toFixed(0)} ms`);
    }
    const f = this.frames;
    if (f.n > 0) {
      lines.push(`${(f.done ? 'first 10 s' : 'frames…').padEnd(12)} ${f.long} long >${LONG_MS} ms, max ${f.max.toFixed(0)} ms, avg ${(f.sum / f.n).toFixed(1)} ms`);
    }
    this.el.textContent = lines.join('\n');
  }

  private expose() {
    const api = { t0: this.t0, marks: this.marks, enabled: this.enabled, frames: this.frames };
    (window as unknown as { __loadTiming: typeof api }).__loadTiming = api;
  }
}

export function debugEnabled(search = location.search): boolean {
  const p = new URLSearchParams(search);
  if (!p.has('debug')) return false;
  const v = p.get('debug');
  return v === null || v === '' || v === '1' || v === 'true';
}

/** One shared instance: call from main (module mark) and Game.start. */
export function beginLoadTiming(): LoadTiming {
  if (!shared) {
    shared = new LoadTiming(debugEnabled());
    shared.mark('module');
  }
  return shared;
}
