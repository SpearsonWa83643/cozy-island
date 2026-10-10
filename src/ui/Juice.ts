import * as THREE from 'three/webgpu';

interface Pop { el: HTMLElement; p: THREE.Vector3; life: number; max: number; rise: number; follow?: () => THREE.Vector3 | null; }

/** Screen-space feedback anchored to world positions: hearts, emotes, prompts, fly-to-bag. */
export class Juice {
  layer: HTMLDivElement;
  private pops: Pop[] = [];
  private v = new THREE.Vector3();
  private toastEl: HTMLDivElement;
  private toastTimer = 0;
  prompt: HTMLDivElement;

  constructor(parent: HTMLElement, private camera: THREE.PerspectiveCamera) {
    this.layer = document.createElement('div'); this.layer.className = 'juice';
    parent.appendChild(this.layer);
    this.toastEl = document.createElement('div'); this.toastEl.className = 'jtoast';
    parent.appendChild(this.toastEl);
    this.prompt = document.createElement('div'); this.prompt.className = 'world-prompt';
    this.layer.appendChild(this.prompt);
  }

  project(p: THREE.Vector3): { x: number; y: number; vis: boolean } {
    this.v.copy(p).project(this.camera);
    return { x: (this.v.x * 0.5 + 0.5) * innerWidth, y: (-this.v.y * 0.5 + 0.5) * innerHeight, vis: this.v.z < 1 && Math.abs(this.v.x) < 1.2 && Math.abs(this.v.y) < 1.2 };
  }

  /** floating emoji/text that rises and fades */
  pop(p: THREE.Vector3, html: string, cls = '', life = 1.3, rise = 60, follow?: () => THREE.Vector3 | null) {
    const el = document.createElement('div');
    el.className = 'pop ' + cls; el.innerHTML = html;
    this.layer.appendChild(el);
    this.pops.push({ el, p: p.clone(), life, max: life, rise, follow });
  }

  hearts(p: THREE.Vector3, n = 5) {
    for (let i = 0; i < n; i++) {
      const q = p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, Math.random() * 0.3, (Math.random() - 0.5) * 0.6));
      setTimeout(() => this.pop(q, '❤️', 'heart', 1.2 + Math.random() * 0.4, 70 + Math.random() * 40), i * 70);
    }
  }

  /** an item icon arcs from a world position into a HUD element */
  fly(from: THREE.Vector3, icon: string, target: HTMLElement | null, onArrive?: () => void) {
    const s = this.project(from);
    const el = document.createElement('div'); el.className = 'flyer'; el.textContent = icon;
    document.body.appendChild(el);
    const r = target?.getBoundingClientRect();
    const tx = r ? r.left + r.width / 2 : innerWidth - 40, ty = r ? r.top + r.height / 2 : innerHeight - 40;
    const t0 = performance.now(), dur = 650;
    const midX = (s.x + tx) / 2, midY = Math.min(s.y, ty) - 120;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const x = (1 - e) * (1 - e) * s.x + 2 * (1 - e) * e * midX + e * e * tx;
      const y = (1 - e) * (1 - e) * s.y + 2 * (1 - e) * e * midY + e * e * ty;
      const sc = k < 0.15 ? 0.6 + k * 4 : 1.2 - e * 0.5;
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${sc})`;
      if (k < 1) requestAnimationFrame(step);
      else { el.remove(); if (target) { target.classList.remove('bump'); void target.offsetWidth; target.classList.add('bump'); } onArrive?.(); }
    };
    requestAnimationFrame(step);
  }

  toast(html: string, ms = 2600) {
    this.toastEl.innerHTML = html;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  /** big reward card after opening a chest */
  reward(icon: string, name: string, rarity: string, color: string, extra: string, onClose: () => void) {
    const el = document.createElement('div');
    el.className = 'reward';
    el.innerHTML = `<div class="reward-card" style="--rc:${color}"><div class="reward-rays"></div><div class="reward-icon">${icon}</div>
      <div class="reward-rarity">${rarity}</div><div class="reward-name">${name}</div><div class="reward-extra">${extra}</div>
      <div class="reward-btns"><button class="btn-equip">Wear it</button><button class="btn-ok">Nice!</button></div></div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    const close = (equip: boolean) => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); onClose(); if (equip) this.onEquipFromReward?.(); };
    el.querySelector('.btn-ok')!.addEventListener('click', () => close(false));
    el.querySelector('.btn-equip')!.addEventListener('click', () => close(true));
    return el;
  }
  onEquipFromReward: (() => void) | null = null;

  /** world-anchored "E  Pick 🍎" prompt for desktop */
  setPrompt(p: THREE.Vector3 | null, html: string) {
    if (!p) { this.prompt.classList.remove('show'); return; }
    const s = this.project(p);
    if (!s.vis) { this.prompt.classList.remove('show'); return; }
    if (this.prompt.innerHTML !== html) this.prompt.innerHTML = html;
    this.prompt.classList.add('show');
    this.prompt.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
  }

  update(dt: number) {
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.life -= dt;
      if (p.life <= 0) { p.el.remove(); this.pops.splice(i, 1); continue; }
      const f = p.follow?.(); if (f) p.p.copy(f);
      const k = 1 - p.life / p.max;
      const s = this.project(p.p);
      const e = 1 - Math.pow(1 - k, 3);
      const sc = k < 0.15 ? 0.4 + (k / 0.15) * 0.8 : 1.2 - Math.min(0.2, (k - 0.15) * 0.8);
      p.el.style.opacity = String(s.vis ? Math.min(1, (1 - k) * 3) : 0);
      p.el.style.transform = `translate(${s.x}px, ${s.y - e * p.rise}px) translate(-50%, -50%) scale(${sc})`;
    }
  }
}
