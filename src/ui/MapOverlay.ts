import { heightAt, biomeWeights } from '../world/Terrain';
import { BIOME_CENTERS, BIOME_COUNT, POND } from '../world/Biomes';
import { mulberry32 } from '../world/noise';
import { MAP_EXTENT, ISLETS, ISLET_SIZE } from '../world/config';
import { isletGrid } from '../world/isletGrid';
import type { Flora } from '../world/Flora';

const EXTENT = MAP_EXTENT; // world half-size shown on the map (from world config)
const N = 720;     // canvas resolution
const INK = '#5a3a22';
const HAND = "'Segoe Print', 'Bradley Hand', 'Chalkboard SE', 'Comic Sans MS', cursive";
const LAND = ['#b8c98a', '#d9d6cf', '#dba46a', '#e9d39c', '#d99e6e', '#9fb59c'];
const LABELS = ['Meadow', 'Snowy Peak', 'Autumn Grove', 'Palm Beach', 'Mesa', 'Misty Marsh'];

const toPx = (w: number) => ((w + EXTENT) / (2 * EXTENT)) * N;
// Islet insets (Order 42b, list-driven since 45b): every islet in config ISLETS lies off the main map, so each gets a
// round inset on the map rim in the direction it really lies, joined to the main coast by a dashed sea route.
// Scales to the archipelago (Order 48): insets shrink as the list grows and are nudged apart along the rim.
type Inset = { cx: number; cy: number; r: number; half: number };
const INSETS: Inset[] = (() => {
  const n = ISLETS.length, r = n <= 2 ? 92 : n <= 4 ? 74 : 60;
  const lo = { x: r + 20, y: r + 36 }, hi = { x: N - r - 20, y: N - r - 40 };
  const out = ISLETS.map((d) => {
    const m = Math.max(Math.abs(d.x), Math.abs(d.z)) || 1; // push out to the square rim along the bearing
    const cx = Math.min(hi.x, Math.max(lo.x, N / 2 + (d.x / m) * N)), cy = Math.min(hi.y, Math.max(lo.y, N / 2 + (d.z / m) * N));
    return { cx, cy, r, half: d.r * 1.25 };
  });
  // separate overlapping insets (a few relaxation passes, clamped to the rim box)
  for (let it = 0; it < 24; it++) for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = out[i], b = out[j], dx = b.cx - a.cx, dy = b.cy - a.cy, d = Math.hypot(dx, dy) || 1, need = 2 * r + 34;
    if (d >= need) continue;
    const push = (need - d) / 2, ux = dx / d, uy = dy / d;
    a.cx = Math.min(hi.x, Math.max(lo.x, a.cx - ux * push)); a.cy = Math.min(hi.y, Math.max(lo.y, a.cy - uy * push));
    b.cx = Math.min(hi.x, Math.max(lo.x, b.cx + ux * push)); b.cy = Math.min(hi.y, Math.max(lo.y, b.cy + uy * push));
  }
  return out;
})();
const insetPx = (k: number, x: number, z: number) => { const I = INSETS[k], d = ISLETS[k]; return { x: I.cx + ((x - d.x) / I.half) * I.r, y: I.cy + ((z - d.z) / I.half) * I.r }; };
/** index of the islet inset that shows (x, z), or -1 for the main map */
export const insetOf = (x: number, z: number) => ISLETS.findIndex((d) => Math.abs(x - d.x) < ISLET_SIZE / 2 && Math.abs(z - d.z) < ISLET_SIZE / 2);
/** true if (x, z) is shown in an islet inset rather than the main map */
export const inInset = (x: number, z: number) => insetOf(x, z) >= 0;
/** map canvas pixel for a world point, on whichever map (main or inset) shows it */
export const mapPx = (x: number, z: number) => { const k = insetOf(x, z); return k >= 0 ? insetPx(k, x, z) : { x: toPx(x), y: toPx(z) }; };
/** inset layout (for tests) */
export const insetLayout = () => INSETS.map((I, k) => ({ id: ISLETS[k].id, ...I }));

export interface MapInfo { state: string; n: number; x: number; z: number; hint: string; bottle: { x: number; z: number }; }

/** Full-screen parchment treasure map with pinch/drag/wheel zoom. */
export class MapOverlay {
  el: HTMLDivElement;
  open = false;
  onClose: () => void = () => {};
  onGuide: () => boolean = () => true;
  private _guide = true;
  set guideOn(v: boolean) { this._guide = v; const b = this.el?.querySelector('.map-guide'); if (b) { b.textContent = `✨ Trail: ${v ? 'on' : 'off'}`; b.classList.toggle('on', v); } }
  private paper: HTMLDivElement; private canvas: HTMLCanvasElement; private me: HTMLDivElement; private x: HTMLDivElement; private caption: HTMLDivElement;
  private base: HTMLCanvasElement | null = null;
  private drawnKey = '';
  private zoom = 1; private panX = 0; private panY = 0;
  private pts = new Map<number, { x: number; y: number }>();
  private pinch0 = 0; private zoom0 = 1;

  /** islet landing pins (world xz), by ISLETS index */
  isletPins: ({ x: number; z: number } | null)[] = [];
  set isletPin(p: { x: number; z: number } | null) { this.isletPins[0] = p; }
  private baseIslet = '';
  constructor(parent: HTMLElement, private flora: Flora, private landmarks: { x: number; z: number; label: string; icon: 'lighthouse' | 'ship' }[] = []) {
    this.el = document.createElement('div');
    this.el.className = 'map-overlay';
    this.el.innerHTML = `<div class="map-stage"><div class="map-paper"><canvas></canvas><div class="map-x"></div><div class="map-me"></div></div></div>
      <div class="map-caption"></div><button class="map-guide" aria-label="Toggle treasure trail">✨ Trail: on</button><button class="map-close" aria-label="Close map">✕</button>`;
    parent.appendChild(this.el);
    this.paper = this.el.querySelector('.map-paper')!;
    this.canvas = this.el.querySelector('canvas')!; this.canvas.width = this.canvas.height = N;
    this.me = this.el.querySelector('.map-me')!; this.x = this.el.querySelector('.map-x')!;
    this.caption = this.el.querySelector('.map-caption')!;
    this.el.querySelector('.map-close')!.addEventListener('click', (e) => { e.stopPropagation(); this.hide(); });
    this.el.querySelector('.map-guide')!.addEventListener('click', (e) => { e.stopPropagation(); this.onGuide(); });
    this.guideOn = this._guide;
    const stage = this.el.querySelector('.map-stage') as HTMLDivElement;
    stage.addEventListener('pointerdown', (e) => { stage.setPointerCapture(e.pointerId); this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (this.pts.size === 2) { this.pinch0 = this.dist(); this.zoom0 = this.zoom; } });
    stage.addEventListener('pointermove', (e) => {
      const p = this.pts.get(e.pointerId); if (!p) return;
      if (this.pts.size === 1 && this.zoom > 1.01) { this.panX += e.clientX - p.x; this.panY += e.clientY - p.y; }
      p.x = e.clientX; p.y = e.clientY;
      if (this.pts.size === 2 && this.pinch0 > 0) this.zoom = Math.min(3.5, Math.max(1, this.zoom0 * this.dist() / this.pinch0));
      this.applyXform();
    });
    const up = (e: PointerEvent) => { this.pts.delete(e.pointerId); if (this.pts.size < 2) this.pinch0 = 0; };
    stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
    stage.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom = Math.min(3.5, Math.max(1, this.zoom * Math.exp(-e.deltaY * 0.0015))); this.applyXform(); }, { passive: false });
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.hide(); });
  }
  private dist() { const [a, b] = [...this.pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); }
  private applyXform() {
    if (this.zoom <= 1.01) { this.panX = this.panY = 0; }
    const lim = (this.zoom - 1) * 300;
    this.panX = Math.max(-lim, Math.min(lim, this.panX)); this.panY = Math.max(-lim, Math.min(lim, this.panY));
    this.paper.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
  }

  show(info: MapInfo) { this.draw(info); this.open = true; this.zoom = 1; this.applyXform(); this.el.classList.add('open'); }
  hide() { if (!this.open) return; this.open = false; this.el.classList.remove('open'); this.onClose(); }
  toggle(info: MapInfo) { this.open ? this.hide() : this.show(info); }

  /** per-frame: player marker + X pulse */
  update(px: number, pz: number, facing: number, closeness: number) {
    if (!this.open) return;
    const q = mapPx(px, pz); this.me.style.left = `${(q.x / N) * 100}%`; this.me.style.top = `${(q.y / N) * 100}%`;
    this.me.style.transform = `translate(-50%, -50%) rotate(${-facing + Math.PI}rad)`;
    this.x.classList.toggle('hot', closeness > 0.6);
  }

  // ---------------- drawing ----------------
  private draw(info: MapInfo) {
    const isl = ISLETS.map((_, k) => (isletGrid(k) ? 1 : 0)).join('') + '|' + this.isletPins.map((p) => (p ? 1 : 0)).join('');
    const key = `${info.state}|${info.n}|${info.x.toFixed(1)}|${isl}`;
    const g = this.canvas.getContext('2d')!;
    if (key !== this.drawnKey) {
      this.drawnKey = key;
      if (!this.base || this.baseIslet !== isl) { this.base = this.drawBase(); this.baseIslet = isl; }
      g.clearRect(0, 0, N, N);
      g.drawImage(this.base, 0, 0);
      const active = info.state === 'active' || info.state === 'dug';
      const rnd = mulberry32(info.n * 131 + 7);
      if (active) {
        // torn fragment: everything outside a ragged circle is faded back to blank parchment
        const fx = toPx(info.x + (rnd() - 0.5) * 14), fz = toPx(info.z + (rnd() - 0.5) * 14), fr = (22 / (2 * EXTENT)) * N;
        g.save();
        g.beginPath(); g.rect(0, 0, N, N);
        for (let i = 0; i <= 48; i++) { const a = -(i / 48) * Math.PI * 2, r = fr * (0.88 + rnd() * 0.24); i ? g.lineTo(fx + Math.cos(a) * r, fz + Math.sin(a) * r) : g.moveTo(fx + Math.cos(a) * r, fz + Math.sin(a) * r); }
        g.closePath();
        g.fillStyle = 'rgba(240, 226, 192, 0.78)'; g.fill('evenodd');
        g.restore();
        g.save(); g.setLineDash([3, 5]); g.strokeStyle = 'rgba(90,58,34,0.55)'; g.lineWidth = 1.5;
        g.beginPath(); g.arc(fx, fz, fr * 1.02, 0, Math.PI * 2); g.stroke(); g.restore();
        // the X, in red brush strokes
        const X = toPx(info.x), Z = toPx(info.z);
        g.save(); g.strokeStyle = '#c0392b'; g.lineCap = 'round'; g.lineWidth = 7;
        g.beginPath(); g.moveTo(X - 13, Z - 12); g.quadraticCurveTo(X, Z + 1, X + 14, Z + 13); g.moveTo(X + 12, Z - 13); g.quadraticCurveTo(X - 1, Z, X - 13, Z + 12); g.stroke(); g.restore();
        this.x.style.display = 'block';
        this.x.style.left = `${(X / N) * 100}%`; this.x.style.top = `${(Z / N) * 100}%`;
      } else this.x.style.display = 'none';
      if (info.state === 'bottle') {
        const bx = toPx(info.bottle.x), bz = toPx(info.bottle.z);
        g.font = '30px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('🍾', bx, bz);
        g.strokeStyle = '#c0392b'; g.lineWidth = 2; g.setLineDash([4, 4]); g.beginPath(); g.arc(bx, bz, 24, 0, 7); g.stroke(); g.setLineDash([]);
      }
      // title
      g.fillStyle = INK; g.font = `bold 30px ${HAND}`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      g.fillText(info.state === 'bottle' ? '~ Something washed ashore ~' : `~ Treasure Map No. ${info.n + 1} ~`, N / 2, 50);
    }
    this.caption.textContent = info.state === 'bottle' ? 'A glinting bottle lies on the beach near where you started. Go take a look!'
      : info.state === 'dug' ? 'You found it! Open the chest.' : info.hint;
  }

  /** round parchment inset per islet: its coast and meadow (Blossom Isle adds its cherry grove), landing pin, plus the sea route */
  private drawInsets(g: CanvasRenderingContext2D, rnd: () => number) { for (let k = 0; k < ISLETS.length; k++) this.drawInset(g, rnd, k); }
  private drawInset(g: CanvasRenderingContext2D, rnd: () => number, k: number) {
    const ISL = ISLETS[k], { cx, cy, r, half: INSET_HALF } = INSETS[k];
    // dashed sea route from the main island's coast (towards the islet) to the inset rim facing home
    const a = Math.atan2(ISL.z, ISL.x), sx = toPx(Math.cos(a) * EXTENT * 0.72), sz = toPx(Math.sin(a) * EXTENT * 0.72);
    const ha = Math.atan2(N / 2 - cy, N / 2 - cx), ex = cx + Math.cos(ha) * r, ey = cy + Math.sin(ha) * r;
    const mx = (sx + ex) / 2, my = (sz + ey) / 2, bend = 0.18 * Math.hypot(ex - sx, ey - sz), nx = -(ey - sz), ny = ex - sx, nl = Math.hypot(nx, ny) || 1;
    g.save(); g.strokeStyle = 'rgba(90,58,34,0.7)'; g.lineWidth = 2; g.setLineDash([6, 6]);
    g.beginPath(); g.moveTo(sx, sz); g.quadraticCurveTo(mx + (nx / nl) * bend, my + (ny / nl) * bend, ex, ey); g.stroke(); g.setLineDash([]); g.restore();
    g.save();
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = '#efe0bd'; g.fill();
    g.clip();
    g.fillStyle = 'rgba(159,203,204,0.35)'; g.fillRect(cx - r, cy - r, r * 2, r * 2);
    const ready = !!isletGrid(k);
    const cell = 3;
    for (let py = -r; py < r; py += cell) for (let px = -r; px < r; px += cell) {
      const wx = ISL.x + ((px + cell / 2) / r) * INSET_HALF, wz = ISL.z + ((py + cell / 2) / r) * INSET_HALF;
      const h = ready ? heightAt(wx, wz) : (Math.hypot(wx - ISL.x, wz - ISL.z) < ISL.r * 0.85 ? 2 : -3);
      if (h > 0.02) { g.fillStyle = h < 0.7 ? '#ead9a8' : '#b8c98a'; g.globalAlpha = 0.6 + rnd() * 0.12; g.fillRect(cx + px, cy + py, cell + 0.5, cell + 0.5); }
      else if (h > -2.5) { g.fillStyle = '#9fcbcc'; g.globalAlpha = 0.35 * (1 + h / 2.5); g.fillRect(cx + px, cy + py, cell + 0.5, cell + 0.5); }
    }
    g.globalAlpha = 1;
    // tree stamps: Blossom Isle's cherry grove (far, north-east half) in blossom pink, other islets a green wood
    const gr = mulberry32(ISL.seed), cherry = ISL.id === 'blossom';
    for (let i = 0; i < 26; i++) {
      const an = (cherry ? -Math.PI / 4 : a) + (gr() - 0.5) * 2.2, d = (0.15 + gr() * 0.55) * ISL.r;
      const q = insetPx(k, ISL.x + Math.cos(an) * d, ISL.z + Math.sin(an) * d);
      g.fillStyle = cherry ? 'rgba(240,150,180,0.85)' : 'rgba(120,160,90,0.85)'; g.beginPath(); g.arc(q.x, q.y - 2, 3.4, 0, 7); g.fill(); g.strokeStyle = INK; g.lineWidth = 0.8; g.stroke();
    }
    g.restore();
    g.save(); g.strokeStyle = INK; g.lineWidth = 2.2; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, r - 5, 0, Math.PI * 2); g.stroke();
    // landing pin
    const pin = this.isletPins[k];
    if (pin) {
      const q = insetPx(k, pin.x, pin.z);
      g.fillStyle = '#e8608e'; g.beginPath(); g.moveTo(q.x, q.y); g.arc(q.x, q.y - 14, 7, Math.PI * 0.8, Math.PI * 2.2); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#fff4f8'; g.beginPath(); g.arc(q.x, q.y - 14, 2.6, 0, 7); g.fill();
    }
    g.fillStyle = 'rgba(90,58,34,0.9)'; g.font = `bold 19px ${HAND}`; g.textAlign = 'center'; g.fillText(ISL.name, cx, cy + r + 22);
    g.restore();
  }

  private drawBase(): HTMLCanvasElement {
    const c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d')!;
    const rnd = mulberry32(42);
    // parchment
    g.fillStyle = '#f1e2bf'; g.fillRect(0, 0, N, N);
    for (let i = 0; i < 90; i++) {
      const x = rnd() * N, y = rnd() * N, r = 20 + rnd() * 90;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      const dark = rnd() < 0.5;
      gr.addColorStop(0, dark ? 'rgba(160,120,70,0.07)' : 'rgba(255,250,230,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // land / sea watercolour
    const cell = 4, M = N / cell, H = new Float32Array((M + 1) * (M + 1));
    const w = new Float32Array(BIOME_COUNT);
    const world = (p: number) => (p / N) * 2 * EXTENT - EXTENT;
    for (let j = 0; j <= M; j++) for (let i = 0; i <= M; i++) H[j * (M + 1) + i] = heightAt(world(i * cell), world(j * cell));
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      const h = H[j * (M + 1) + i];
      const wx = world(i * cell + 2), wz = world(j * cell + 2);
      if (h > 0.02) {
        biomeWeights(wx, wz, w);
        let bi = 0; for (let k = 1; k < BIOME_COUNT; k++) if (w[k] > w[bi]) bi = k;
        g.fillStyle = h < 0.45 ? '#ead9a8' : LAND[bi];
        g.globalAlpha = 0.55 + rnd() * 0.12;
        g.fillRect(i * cell, j * cell, cell + 0.6, cell + 0.6);
      } else if (h > -2.5) { g.fillStyle = '#9fcbcc'; g.globalAlpha = 0.35 * (1 + h / 2.5); g.fillRect(i * cell, j * cell, cell + 0.6, cell + 0.6); }
    }
    g.globalAlpha = 1;
    // contours (hatched hills) + coastline ink
    const iso = (lvl: number, style: string, width: number, dash: number[]) => {
      g.strokeStyle = style; g.lineWidth = width; g.setLineDash(dash); g.beginPath();
      for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
        const a = H[j * (M + 1) + i] > lvl, b = H[j * (M + 1) + i + 1] > lvl, d = H[(j + 1) * (M + 1) + i] > lvl;
        if (a !== b) { g.moveTo((i + 1) * cell + (rnd() - 0.5), j * cell); g.lineTo((i + 1) * cell + (rnd() - 0.5), (j + 1) * cell); }
        if (a !== d) { g.moveTo(i * cell, (j + 1) * cell + (rnd() - 0.5)); g.lineTo((i + 1) * cell, (j + 1) * cell + (rnd() - 0.5)); }
      }
      g.stroke(); g.setLineDash([]);
    };
    iso(-1.2, 'rgba(70,110,120,0.35)', 1, [2, 4]);
    iso(4, 'rgba(90,58,34,0.35)', 1, [3, 3]);
    iso(8, 'rgba(90,58,34,0.45)', 1, [3, 3]);
    iso(12, 'rgba(90,58,34,0.55)', 1.2, []);
    iso(0.02, INK, 2.4, []);
    // the peak
    const pk = BIOME_CENTERS[1];
    g.fillStyle = INK; g.strokeStyle = INK; g.lineWidth = 2;
    for (let i = 0; i < 3; i++) { const x = toPx(pk[0]) - 18 + i * 18, y = toPx(pk[1]) + (i === 1 ? -6 : 4); g.beginPath(); g.moveTo(x - 12, y + 10); g.lineTo(x, y - 12); g.lineTo(x + 12, y + 10); g.stroke(); g.beginPath(); g.moveTo(x - 4, y - 5); g.lineTo(x, y - 12); g.lineTo(x + 4, y - 5); g.fillStyle = '#ffffff'; g.fill(); }
    // pond
    g.fillStyle = 'rgba(110,170,200,0.6)'; g.beginPath(); g.ellipse(toPx(POND.x), toPx(POND.z), (POND.r / (2 * EXTENT)) * N, (POND.r / (2 * EXTENT)) * N * 0.8, 0, 0, 7); g.fill();
    g.strokeStyle = INK; g.lineWidth = 1.5; g.stroke();
    // tree stamps
    const glyph: Record<string, (x: number, y: number) => void> = {
      round: (x, y) => { g.fillStyle = 'rgba(80,120,60,0.75)'; g.beginPath(); g.arc(x, y - 3, 3.6, 0, 7); g.fill(); g.strokeStyle = INK; g.lineWidth = 1; g.stroke(); g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 3); g.stroke(); },
      autumn: (x, y) => { g.fillStyle = 'rgba(200,100,40,0.8)'; g.beginPath(); g.arc(x, y - 3, 3.6, 0, 7); g.fill(); g.strokeStyle = INK; g.lineWidth = 1; g.stroke(); },
      pine: (x, y) => { g.fillStyle = 'rgba(50,90,60,0.8)'; g.beginPath(); g.moveTo(x, y - 7); g.lineTo(x - 3.5, y + 2); g.lineTo(x + 3.5, y + 2); g.closePath(); g.fill(); g.strokeStyle = INK; g.lineWidth = 1; g.stroke(); },
      palm: (x, y) => { g.strokeStyle = INK; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x, y + 3); g.quadraticCurveTo(x + 1, y - 2, x, y - 5); for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + (k - 2) * 0.7; g.moveTo(x, y - 5); g.quadraticCurveTo(x + Math.cos(a) * 3, y - 5 + Math.sin(a) * 3 - 1, x + Math.cos(a) * 6, y - 5 + Math.sin(a) * 6 + 2); } g.stroke(); },
      cactus: (x, y) => { g.strokeStyle = 'rgba(60,110,60,0.9)'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y + 3); g.lineTo(x, y - 6); g.moveTo(x - 3, y - 3); g.lineTo(x - 3, y - 1); g.lineTo(x, y - 1); g.moveTo(x + 3, y - 4); g.lineTo(x + 3, y - 2); g.lineTo(x, y - 2); g.stroke(); },
    };
    const kind: Record<string, string> = { oak: 'round', blossom: 'round', birch: 'round', willow: 'round', maple: 'autumn', pine: 'pine', snowpine: 'pine', palm: 'palm', saguaro: 'cactus' };
    let k = 0;
    for (const s of this.flora.spots) { const gk = kind[s.name]; if (!gk || k++ % 3) continue; glyph[gk](toPx(s.x), toPx(s.z)); }
    // labels
    g.fillStyle = 'rgba(90,58,34,0.85)'; g.font = `20px ${HAND}`; g.textAlign = 'center';
    BIOME_CENTERS.forEach((cc, i) => g.fillText(LABELS[i], toPx(cc[0]), toPx(cc[1]) + (i === 1 ? 34 : i === 5 ? -30 : 0)));
    // landmarks (Lighthouse Point…)
    for (const lm of this.landmarks) {
      const x = toPx(lm.x), y = toPx(lm.z);
      g.save(); g.strokeStyle = INK; g.lineWidth = 1.6;
      if (lm.icon === 'ship') {
        // little sunken ship: tilted hull, mast + sail, a dotted X for the chest
        g.translate(x, y); g.rotate(-0.18);
        g.fillStyle = '#9a6634'; g.beginPath(); g.moveTo(-14, -2); g.lineTo(14, -2); g.lineTo(9, 7); g.lineTo(-10, 7); g.closePath(); g.fill(); g.stroke();
        g.beginPath(); g.moveTo(0, -2); g.lineTo(0, -22); g.stroke();
        g.fillStyle = '#f6efe0'; g.beginPath(); g.moveTo(1, -20); g.lineTo(11, -8); g.lineTo(1, -6); g.closePath(); g.fill(); g.stroke();
        g.strokeStyle = 'rgba(40,110,160,0.8)'; g.beginPath(); g.moveTo(-18, 3); g.quadraticCurveTo(-12, 0, -6, 3); g.quadraticCurveTo(0, 6, 6, 3); g.quadraticCurveTo(12, 0, 18, 3); g.stroke();
        g.rotate(0.18); g.translate(-x, -y);
        g.fillStyle = 'rgba(90,58,34,0.85)'; g.font = `18px ${HAND}`; g.textAlign = 'center'; g.fillText(lm.label, x, y + 24);
        g.restore(); continue;
      }
      g.fillStyle = 'rgba(255,240,170,0.55)'; g.beginPath(); g.moveTo(x, y - 22); g.lineTo(x + 26, y - 30); g.lineTo(x + 26, y - 14); g.closePath(); g.fill();
      g.fillStyle = '#f6efe0'; g.beginPath(); g.moveTo(x - 6, y + 6); g.lineTo(x - 4, y - 18); g.lineTo(x + 4, y - 18); g.lineTo(x + 6, y + 6); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = 'rgba(200,60,50,0.85)'; g.fillRect(x - 5.2, y - 6, 10.4, 5); g.fillRect(x - 4.4, y - 15, 8.8, 4);
      g.fillStyle = INK; g.beginPath(); g.moveTo(x - 5, y - 18); g.lineTo(x, y - 25); g.lineTo(x + 5, y - 18); g.closePath(); g.fill();
      g.fillStyle = 'rgba(90,58,34,0.85)'; g.font = `18px ${HAND}`; g.textAlign = 'center'; g.fillText(lm.label, x, y + 24);
      g.restore();
    }
    // compass rose
    this.drawInsets(g, rnd);
    const cx = 84, cy = N - 112;
    g.save(); g.translate(cx, cy); g.strokeStyle = INK; g.fillStyle = INK; g.lineWidth = 1.5;
    g.beginPath(); g.arc(0, 0, 34, 0, 7); g.stroke(); g.beginPath(); g.arc(0, 0, 28, 0, 7); g.stroke();
    for (let i = 0; i < 4; i++) { g.rotate(Math.PI / 2); g.beginPath(); g.moveTo(0, -40); g.lineTo(6, 0); g.lineTo(0, 6); g.lineTo(-6, 0); g.closePath(); i === 3 ? g.fill() : g.stroke(); }
    g.font = `bold 20px ${HAND}`; g.textAlign = 'center'; g.fillText('N', 0, -46);
    g.restore();
    // burnt edges
    const vg = g.createRadialGradient(N / 2, N / 2, N * 0.36, N / 2, N / 2, N * 0.72);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(0.8, 'rgba(150,100,50,0.25)'); vg.addColorStop(1, 'rgba(90,50,20,0.65)');
    g.fillStyle = vg; g.fillRect(0, 0, N, N);
    return c;
  }
}
