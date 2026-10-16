import { MOUNTS, isMountUnlocked, type MountDef, type MountId } from '../player/MountDefs';
import type { SaveData } from '../game/Save';

/**
 * "Pick a mount!" — big touch tiles for every mount (mirrors 2D Master's picker). Unlocked tiles call
 * that mount; locked ones are greyed with a 🔒 and say which treasure unlocks them. Tap outside / ✕ /
 * Esc closes; 1–4 pick on desktop, Enter / V re-calls the last mount.
 */
export class MountPicker {
  open = false;
  private el: HTMLElement | null = null;
  private onKey = (e: KeyboardEvent) => this.key(e);
  /** the touch that opened the picker (pointerdown on Call Mount) ends with a click under the finger: ignore it */
  private openedAt = 0;
  private get fresh() { return performance.now() - this.openedAt < 450; }
  constructor(private save: () => SaveData, private hooks: { pick: (id: MountId) => void; ui: () => void; deny: () => void }) {}

  show() {
    if (this.open) return;
    this.open = true; this.openedAt = performance.now();
    const d = this.save();
    const el = document.createElement('div');
    el.className = 'mount-picker'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Pick a mount');
    el.innerHTML = `<div class="mp-card"><button class="mp-x" aria-label="Close">✕</button><h2>Pick a mount!</h2><div class="mp-grid"></div><div class="mp-msg" aria-live="polite"></div></div>`;
    const grid = el.querySelector('.mp-grid')!;
    MOUNTS.forEach((m, i) => grid.appendChild(this.tile(m, i, d)));
    for (const ev of ['touchstart', 'touchend', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'click', 'wheel']) el.addEventListener(ev, (x) => x.stopPropagation());
    el.addEventListener('click', (x) => { if (x.target === el && !this.fresh) this.close(); });
    el.querySelector('.mp-x')!.addEventListener('click', () => { if (!this.fresh) this.close(); });
    document.body.appendChild(el); document.body.classList.add('mount-picking');
    requestAnimationFrame(() => el.classList.add('show'));
    window.addEventListener('keydown', this.onKey, true);
    this.el = el;
    this.hooks.ui();
  }

  private tile(m: MountDef, i: number, d: SaveData) {
    const ok = isMountUnlocked(m, d), last = (d.mountId ?? 'eagle') === m.id;
    const b = document.createElement('button');
    b.className = `mp-tile${ok ? '' : ' locked'}${last && ok ? ' last' : ''}`;
    b.dataset.mount = m.id; b.type = 'button';
    b.setAttribute('aria-label', ok ? `Ride the ${m.name}` : `${m.name} (locked): ${m.hint}`);
    b.innerHTML = `<span class="mp-ic">${m.icon}</span><span class="mp-name">${m.name}</span>`
      + `<span class="mp-sub">${ok ? (last ? 'Last ride ✓' : m.blurb) : `🔒 ${m.hint}`}</span><kbd class="mp-k">${i + 1}</kbd>`;
    b.addEventListener('click', () => { if (!this.fresh) this.choose(m); });
    return b;
  }

  private choose(m: MountDef) {
    if (!isMountUnlocked(m, this.save())) {
      const t = this.el?.querySelector<HTMLElement>(`[data-mount="${m.id}"]`);
      t?.classList.remove('wiggle'); void t?.offsetWidth; t?.classList.add('wiggle');
      this.hooks.deny();
      const msg = this.el?.querySelector<HTMLElement>('.mp-msg');
      if (msg) { msg.innerHTML = `🔒 ${m.hint} to ride the <b>${m.name}</b>!`; msg.classList.remove('pop'); void msg.offsetWidth; msg.classList.add('pop'); }
      return;
    }
    this.close(true);
    this.hooks.pick(m.id);
  }

  private key(e: KeyboardEvent) {
    if (!this.open) return;
    const k = e.key.toLowerCase();
    const n = Number(k);
    if (k === 'escape') this.close();
    else if (n >= 1 && n <= MOUNTS.length) this.choose(MOUNTS[n - 1]);
    else if (k === 'enter' || k === 'v' || k === ' ') { const d = this.save(); const m = MOUNTS.find((x) => x.id === d.mountId) ?? MOUNTS[0]; this.choose(isMountUnlocked(m, d) ? m : MOUNTS[0]); }
    else return;
    e.preventDefault(); e.stopPropagation();
  }

  close(quiet = false) {
    if (!this.open) return;
    this.open = false;
    window.removeEventListener('keydown', this.onKey, true);
    document.body.classList.remove('mount-picking');
    const el = this.el; this.el = null;
    if (!quiet) this.hooks.ui();
    if (el) { el.classList.remove('show'); setTimeout(() => el.remove(), 220); }
  }
}
