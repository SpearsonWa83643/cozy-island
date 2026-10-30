import * as THREE from 'three/webgpu';

/**
 * Day/night cycle (Order 49). One clock in game hours (0..24): the sun rises at 6:00 and sets at 18:00 on an arc
 * centred on the island's classic sun direction; the moon rides the opposite arc. Everything else (sky, light, fog,
 * haze, water, grade, stars, frogs, lighthouse) reads `night` / `twilight` / `sunUp` from here and layers on top of
 * the active theme's look.
 * Pace: a game hour lasts 50 s by day and 25 s by night (day ~10 min, night ~5 min, one full cycle ~15 min).
 * A new visit starts at 9:00. Overrides (tests / curious players): ?time=dawn|morning|day|noon|afternoon|dusk|
 * evening|night|midnight|<hours>|<HH:MM> freezes the clock there; ?timespeed=<x> scales the pace (cycle keeps going).
 */
export const TIME_PRESETS: Record<string, number> = {
  dawn: 6.1, sunrise: 6.3, morning: 9, day: 11, noon: 12, afternoon: 15, dusk: 17.9, sunset: 17.9, evening: 19.5, night: 22.5, midnight: 0,
};
export const START_HOUR = 9;
const DAY_SEC_PER_HOUR = 50, NIGHT_SEC_PER_HOUR = 25;
/** classic sun direction (noon azimuth) */
const AZ0 = Math.atan2(-0.6, -0.5);
const SUN_MAX_EL = 55 * Math.PI / 180, MOON_MAX_EL = 42 * Math.PI / 180;

export function parseTime(v: string | null | undefined): number | null {
  if (v == null || v === '' || v === 'auto') return null;
  const s = v.toLowerCase().trim();
  if (s in TIME_PRESETS) return TIME_PRESETS[s];
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(s) ?? /^(\d{1,2}(?:\.\d+)?)$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]) + (m[2] ? Number(m[2]) / 60 : 0);
  return Number.isFinite(h) ? ((h % 24) + 24) % 24 : null;
}

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** direction toward a body on an arc: rises at hour `rise`, peaks 6 h later, sets 12 h after rising */
function arc(out: THREE.Vector3, hour: number, rise: number, az0: number, maxEl: number) {
  let h = hour - rise; h = ((h % 24) + 24) % 24; // 0..24 since rising
  const th = (h / 12) * Math.PI; // 0..pi above the horizon, pi..2pi below
  const sinEl = Math.sin(th) * Math.sin(maxEl);
  const el = Math.asin(sinEl);
  const az = az0 + ((h - 6) / 6) * (Math.PI / 2) * 0.9;
  return out.set(Math.cos(az) * Math.cos(el), sinEl, Math.sin(az) * Math.cos(el));
}

export class TimeOfDay {
  hour = START_HOUR;
  /** frozen by ?time= (or settings) */
  frozen = false;
  speed = 1;
  readonly sunDir = new THREE.Vector3();
  readonly moonDir = new THREE.Vector3();
  /** direction the key light shines from (sun by day, moon by night, kept above ~12 deg for sane shadows) */
  readonly lightDir = new THREE.Vector3();
  /** 0 = full day .. 1 = full night */
  night = 0;
  /** 0..1 warm golden-hour / twilight band around sunrise and sunset */
  twilight = 0;
  /** 0..1 how much sunlight reaches the ground */
  sunUp = 1;
  /** 0..1 moonlight strength */
  moonUp = 0;
  /** what set the clock: the cycle, the URL or the settings */
  source: 'cycle' | 'url' | 'setting' = 'cycle';

  constructor(search = typeof location !== 'undefined' ? location.search : '') {
    const q = new URLSearchParams(search);
    const t = parseTime(q.get('time'));
    if (t != null) { this.hour = t; this.frozen = true; this.source = 'url'; }
    const sp = Number(q.get('timespeed'));
    if (sp > 0) this.speed = sp;
    this.compute();
  }

  /** jump to a time (hours or preset); `freeze` stops the clock there */
  set(v: number | string, freeze = this.frozen) {
    const h = typeof v === 'number' ? ((v % 24) + 24) % 24 : parseTime(v);
    if (h == null) return;
    this.hour = h; this.frozen = freeze; this.compute();
  }
  /** let the clock run again */
  resume() { this.frozen = false; this.source = 'cycle'; }

  update(dt: number) {
    if (!this.frozen) {
      const perHour = this.night > 0.5 ? NIGHT_SEC_PER_HOUR : DAY_SEC_PER_HOUR;
      this.hour = (this.hour + (dt * this.speed) / perHour) % 24;
    }
    this.compute();
  }

  private compute() {
    arc(this.sunDir, this.hour, 6, AZ0, SUN_MAX_EL);
    arc(this.moonDir, this.hour, 18, AZ0 + Math.PI, MOON_MAX_EL);
    const s = this.sunDir.y, m = this.moonDir.y;
    this.night = 1 - smooth(-0.16, 0.06, s);
    this.twilight = smooth(-0.2, -0.02, s) * (1 - smooth(0.06, 0.34, s));
    this.sunUp = smooth(-0.03, 0.22, s);
    this.moonUp = smooth(-0.03, 0.15, m) * this.night;
    const src = s > -0.02 || m < 0 ? this.sunDir : this.moonDir;
    this.lightDir.copy(src);
    if (this.lightDir.y < 0.21) { this.lightDir.y = 0.21; this.lightDir.normalize(); }
  }

  /** clock text, e.g. "21:30" */
  get clock() { const h = Math.floor(this.hour), mm = Math.floor((this.hour - h) * 60); return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; }
  get phase(): 'dawn' | 'day' | 'dusk' | 'night' {
    if (this.night > 0.6) return 'night';
    if (this.twilight > 0.35) return this.hour < 12 ? 'dawn' : 'dusk';
    return 'day';
  }
  get debug() {
    return { hour: +this.hour.toFixed(3), clock: this.clock, phase: this.phase, frozen: this.frozen, source: this.source, night: +this.night.toFixed(3), twilight: +this.twilight.toFixed(3), sunUp: +this.sunUp.toFixed(3), moonUp: +this.moonUp.toFixed(3), sunEl: +this.sunDir.y.toFixed(3), moonEl: +this.moonDir.y.toFixed(3) };
  }
}
