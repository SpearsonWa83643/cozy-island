// Theme system (mirrors 2D Master's cozy-game src/theme.ts: Theme / THEMES / THEME_ORDER / theme / setTheme /
// themeEvents). A theme describes the whole look and feel. The renderer grade, sky + fog, HUD skin, music,
// decorations ("dress"), critters, collectibles and build pieces all read the active theme and listen for
// changes, so a switch happens live. New for 3D: each theme can carry a date window, and the active theme is
// resolved as  URL ?theme=  >  saved setting  >  date window  >  season of the month.
// Legacy URL/localStorage value 'classic' migrates to 'spring'.
// Oct 20 2026 (Walker): only the 4 seasons + Halloween are enabled. The other holidays stay fully built but hidden:
// not in the picker, never picked by Auto, a saved hidden choice reads as Auto. ?theme=<hidden> still works (dev).
// To re-enable a holiday, add its id to ENABLED_THEMES.

export type ThemeId = 'spring' | 'summer' | 'autumn' | 'winter' | 'halloween' | 'thanksgiving' | 'christmas' | 'newyear' | 'valentine' | 'easter';
export type ThemeSetting = 'auto' | ThemeId;
import { NO_SEASON, type SeasonLook } from './Season';
import type { SoundscapeId } from '../audio/soundscapes';
export type DressId = 'spring' | 'summer' | 'autumn' | 'winter' | 'halloween' | 'thanksgiving' | 'christmas' | 'newyear' | 'valentine' | 'easter' | null;
export type MusicMode = 'classic' | 'spooky' | 'festive';

export interface Theme {
  id: ThemeId;
  name: string;
  icon: string;
  /** auto-activation window, inclusive, as [month (1-12), day]; wraps the new year if from > to */
  window: { from: [number, number]; to: [number, number] } | null;
  /** movable feasts (Easter): window computed per year, used instead of window */
  windowFn?: (year: number) => { from: [number, number]; to: [number, number] };
  /** post grade (High quality pipeline): multiply tint, saturation, vignette tint */
  grade: { tint: string; sat: number; vignette: string };
  /** sky dome + light rig. blend 0 = biome atmosphere untouched, 1 = fully the theme's */
  sky: {
    blend: number; zenith: string; mid: string; low: string; horizon: string; fog: string; fogNear: number; fogFar: number;
    sun: string; sunI: number; hemiSky: string; hemiGround: string; hemiI: number; sunGlow: number; moon: number; stars: number;
  } | null;
  /** HUD skin: CSS custom properties + a body class (hud.css: body.theme-<id>) */
  ui: { accent: string; accentDark: string; panel: string; ink: string };
  /** legacy music flavour (used when the theme has no dedicated soundscape yet) */
  music: MusicMode;
  /** the theme's own soundscape (src/audio/soundscapes.ts); crossfades on theme switch */
  soundscape?: SoundscapeId;
  /** extra ambience: owl hoots, wind boost (0..1) */
  ambience: { owls: number; wind: number };
  /** decorations module ("dress") to build for this theme */
  dress: DressId;
  critters: { bats: boolean; ghosts: boolean };
  /** themed pickups + wearables that drop while the theme is on */
  collectibles: { candy: boolean; wear: string[] };
  /** extra build pieces shown in build mode */
  build: string[];
  /** the island's own seasonal colouring (leaves, snow, grass, ground) */
  season: SeasonLook;
}

export const HALLOWEEN_WEAR = ['witchhat', 'pumpkinhead', 'ghostsheet', 'catears', 'vampirecape', 'nightwings'];

const spring: Theme = {
  id: 'spring', name: 'Spring', icon: '🌸', window: { from: [3, 1], to: [5, 31] },
  grade: { tint: '#ffffff', sat: 1.12, vignette: '#ffeedb' },
  sky: null,
  ui: { accent: '#f2a93b', accentDark: '#c9802a', panel: 'rgba(255,250,240,.88)', ink: '#4a3b2f' },
  music: 'classic', soundscape: 'spring', ambience: { owls: 0, wind: 0 }, dress: 'spring',
  critters: { bats: false, ghosts: false }, collectibles: { candy: false, wear: [] }, build: ['flowerbox'],
  season: { leaf: ['#6cc24a', '#8ad05a', '#ffc0d8'], leafK: 0.12, snow: 0, grass: '#f4ffe8', ground: null, groundK: 0 },
};

const summer: Theme = {
  id: 'summer', name: 'Summer', icon: '☀️', window: { from: [6, 1], to: [8, 31] },
  grade: { tint: '#fff8e8', sat: 1.18, vignette: '#ffe0a0' },
  sky: {
    blend: 0.55, zenith: '#4aa8ff', mid: '#7ec8ff', low: '#c8e8ff', horizon: '#ffe8b0', fog: '#d0e8f8', fogNear: 40, fogFar: 200,
    sun: '#fff0c0', sunI: 1.55, hemiSky: '#a8d8ff', hemiGround: '#c8b080', hemiI: 1.05, sunGlow: 0.7, moon: 0.15, stars: 0.1,
  },
  ui: { accent: '#f0b429', accentDark: '#d4880a', panel: 'rgba(255,252,240,.9)', ink: '#4a3a20' },
  music: 'classic', soundscape: 'summer', ambience: { owls: 0, wind: 0.15 }, dress: 'summer',
  critters: { bats: false, ghosts: false }, collectibles: { candy: false, wear: [] }, build: ['sunflower'],
  season: { leaf: ['#3f9e34', '#58b23c', '#7cc23e'], leafK: 0.25, snow: 0, grass: '#f6f8dc', ground: '#8cc04a', groundK: 0.15, water: ['#6ff2da', '#1ab0c8', '#0a4a8a'], waterK: 0.4 },
};

const autumn: Theme = {
  id: 'autumn', name: 'Autumn', icon: '🍂', window: { from: [9, 1], to: [11, 30] },
  grade: { tint: '#fff0e0', sat: 1.14, vignette: '#e8a060' },
  sky: {
    blend: 0.4, zenith: '#5a7098', mid: '#c08050', low: '#e8a060', horizon: '#ffc080', fog: '#d0a878', fogNear: 35, fogFar: 180,
    sun: '#ffb070', sunI: 1.2, hemiSky: '#e8c090', hemiGround: '#8a6040', hemiI: 0.9, sunGlow: 0.45, moon: 0.35, stars: 0.25,
  },
  ui: { accent: '#e07030', accentDark: '#a05020', panel: 'rgba(255,246,232,.9)', ink: '#4a3020' },
  music: 'classic', ambience: { owls: 0.3, wind: 0.35 }, dress: 'autumn',
  critters: { bats: false, ghosts: false }, collectibles: { candy: false, wear: [] }, build: ['haybale'],
  season: { leaf: ['#ea8a2a', '#d24a26', '#f0c040'], leafK: 0.85, snow: 0, grass: '#f2d29a', ground: '#b8a055', groundK: 0.45, water: ['#8fe0c8', '#2a9ab0', '#0e4a78'], waterK: 0.55 },
};

const winter: Theme = {
  id: 'winter', name: 'Winter', icon: '❄️', window: { from: [12, 1], to: [2, 29] }, // Christmas/New Year/Valentine's win inside this when enabled
  grade: { tint: '#e8f4ff', sat: 0.95, vignette: '#a0c8e8' },
  sky: {
    blend: 0.7, zenith: '#6080b0', mid: '#a0b8d8', low: '#d0e0f0', horizon: '#f0f4f8', fog: '#c8d8e8', fogNear: 28, fogFar: 160,
    sun: '#e8f0ff', sunI: 0.95, hemiSky: '#c0d8f0', hemiGround: '#e8eef4', hemiI: 0.85, sunGlow: 0.25, moon: 0.7, stars: 0.9,
  },
  ui: { accent: '#6a9fd8', accentDark: '#3a6aa0', panel: 'rgba(240,248,255,.9)', ink: '#2a3a50' },
  music: 'classic', ambience: { owls: 0.2, wind: 0.4 }, dress: 'winter',
  critters: { bats: false, ghosts: false }, collectibles: { candy: false, wear: [] }, build: ['snowman'],
  season: { leaf: ['#4e7a62', '#5c8670', '#6a8e7c'], leafK: 0.5, snow: 0.9, grass: '#d8f0e8', ground: '#eef3fa', groundK: 0.9, water: ['#b8e8f0', '#4aa0c8', '#1a4a7a'], waterK: 0.85 },
};

const halloween: Theme = {
  id: 'halloween', name: 'Halloween', icon: '🎃', window: { from: [10, 1], to: [11, 1] },
  // warm orange highlights, purple shadows: a gentle dusk grade (cozy, not scary)
  grade: { tint: '#ffe6d2', sat: 1.08, vignette: '#b48ad8' },
  sky: {
    blend: 0.82, zenith: '#2a2458', mid: '#5b3f8c', low: '#c46a9a', horizon: '#ffa25e', fog: '#8a6aa8', fogNear: 30, fogFar: 175,
    sun: '#ffb070', sunI: 1.15, hemiSky: '#a58ad8', hemiGround: '#5a3a4a', hemiI: 0.95, sunGlow: 0.35, moon: 1, stars: 0.8,
  },
  ui: { accent: '#ff8a2a', accentDark: '#7a4ab8', panel: 'rgba(42,30,64,.86)', ink: '#fff1e0' },
  music: 'spooky', ambience: { owls: 1, wind: 0.6 }, dress: 'halloween',
  critters: { bats: true, ghosts: true },
  collectibles: { candy: true, wear: HALLOWEEN_WEAR },
  build: ['jackolantern', 'spookylamp'],
  season: NO_SEASON,
};

const thanksgiving: Theme = {
  id: 'thanksgiving', name: 'Thanksgiving', icon: '🦃', window: { from: [11, 20], to: [11, 28] },
  grade: { tint: '#fff4e4', sat: 1.1, vignette: '#d4884a' },
  sky: {
    blend: 0.5, zenith: '#6a7898', mid: '#c89860', low: '#e8b878', horizon: '#ffd0a0', fog: '#d8b888', fogNear: 35, fogFar: 175,
    sun: '#ffc080', sunI: 1.15, hemiSky: '#f0d0a0', hemiGround: '#8a6040', hemiI: 0.95, sunGlow: 0.4, moon: 0.3, stars: 0.2,
  },
  ui: { accent: '#c86828', accentDark: '#8a4018', panel: 'rgba(255,248,236,.92)', ink: '#4a3018' },
  music: 'classic', ambience: { owls: 0.2, wind: 0.25 }, dress: 'thanksgiving',
  critters: { bats: false, ghosts: false }, collectibles: { candy: false, wear: [] }, build: ['cornucopia'],
  season: { leaf: ['#d8802a', '#b8442a', '#e0a83a'], leafK: 0.75, snow: 0, grass: '#eed09a', ground: '#b09450', groundK: 0.4 },
};

const christmas: Theme = {
  id: 'christmas', name: 'Christmas', icon: '🎄', window: { from: [12, 1], to: [12, 26] },
  grade: { tint: '#e8f0ff', sat: 1.05, vignette: '#c04050' },
  sky: {
    blend: 0.75, zenith: '#1a2850', mid: '#3a5080', low: '#6a7898', horizon: '#c8a080', fog: '#607090', fogNear: 30, fogFar: 170,
    sun: '#ffd0a0', sunI: 0.85, hemiSky: '#8090b0', hemiGround: '#405060', hemiI: 0.8, sunGlow: 0.3, moon: 0.9, stars: 1,
  },
  ui: { accent: '#e04050', accentDark: '#2a8a50', panel: 'rgba(30,40,64,.88)', ink: '#fff4e8' },
  music: 'festive', ambience: { owls: 0.1, wind: 0.3 }, dress: 'christmas',
  critters: { bats: false, ghosts: false }, collectibles: { candy: false, wear: [] }, build: ['xmastree', 'gift'],
  season: { leaf: ['#3a7050', '#447a58', '#4e8460'], leafK: 0.35, snow: 0.8, grass: '#d8f0e8', ground: '#eaf0fa', groundK: 0.85, water: ['#c0e8f4', '#508eb8', '#1a4068'], waterK: 0.8 },
};

/** Easter Sunday (anonymous Gregorian algorithm) as [month, day] */
export function easterDate(y: number): [number, number] {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  return [Math.floor((h + l - 7 * m + 114) / 31), ((h + l - 7 * m + 114) % 31) + 1];
}
const shiftMD = (y: number, md: [number, number], days: number): [number, number] => {
  const t = new Date(y, md[0] - 1, md[1] + days); return [t.getMonth() + 1, t.getDate()];
};

const newyear: Theme = {
  id: 'newyear', name: 'New Year', icon: '🎆', window: { from: [12, 31], to: [1, 2] },
  grade: { tint: '#eef0ff', sat: 1.1, vignette: '#6a4ab8' },
  sky: {
    blend: 0.85, zenith: '#0e1238', mid: '#24306a', low: '#4a4a88', horizon: '#c890b0', fog: '#3a4070', fogNear: 32, fogFar: 180,
    sun: '#d8d0ff', sunI: 0.75, hemiSky: '#7080c0', hemiGround: '#303850', hemiI: 0.8, sunGlow: 0.2, moon: 0.8, stars: 1,
  },
  ui: { accent: '#f4c84a', accentDark: '#7a5ad8', panel: 'rgba(24,26,60,.88)', ink: '#fff6e0' },
  music: 'festive', ambience: { owls: 0, wind: 0.2 }, dress: 'newyear',
  critters: { bats: false, ghosts: false }, collectibles: { candy: false, wear: [] }, build: ['skylantern'],
  season: { leaf: ['#3a7050', '#447a58', '#4e8460'], leafK: 0.35, snow: 0.55, grass: '#d8f0e8', ground: '#e6edf8', groundK: 0.6, water: ['#b0e0f0', '#4688b0', '#183c68'], waterK: 0.7 },
};

const valentine: Theme = {
  id: 'valentine', name: "Valentine's", icon: '💝', window: { from: [2, 10], to: [2, 14] },
  grade: { tint: '#fff0f4', sat: 1.12, vignette: '#f0a0c0' },
  sky: {
    blend: 0.5, zenith: '#7a8ad8', mid: '#d8a0d0', low: '#ffc0d0', horizon: '#ffe0d8', fog: '#f0c8d8', fogNear: 36, fogFar: 185,
    sun: '#ffd8e0', sunI: 1.15, hemiSky: '#ffd0e0', hemiGround: '#a07080', hemiI: 0.95, sunGlow: 0.55, moon: 0.2, stars: 0.2,
  },
  ui: { accent: '#ff6a9a', accentDark: '#c8406a', panel: 'rgba(255,244,248,.92)', ink: '#5a2a3a' },
  music: 'classic', ambience: { owls: 0, wind: 0.15 }, dress: 'valentine',
  critters: { bats: false, ghosts: false }, collectibles: { candy: false, wear: [] }, build: ['heartballoon'],
  season: { leaf: ['#5a9a5a', '#6aa868', '#f8b0c8'], leafK: 0.2, snow: 0, grass: '#f0f8ec', ground: '#e8f0e8', groundK: 0.15 },
};

const easter: Theme = {
  id: 'easter', name: 'Easter', icon: '🐣', window: null,
  windowFn: (y) => { const e = easterDate(y); return { from: shiftMD(y, e, -7), to: shiftMD(y, e, 1) }; },
  grade: { tint: '#fffaf0', sat: 1.14, vignette: '#f0e0a8' },
  sky: {
    blend: 0.35, zenith: '#5aa8f0', mid: '#a0d4f8', low: '#d8f0ff', horizon: '#fff0d0', fog: '#e0f0f4', fogNear: 40, fogFar: 200,
    sun: '#fff4d8', sunI: 1.4, hemiSky: '#c8e8ff', hemiGround: '#a8c080', hemiI: 1.05, sunGlow: 0.6, moon: 0.1, stars: 0,
  },
  ui: { accent: '#9a7ae0', accentDark: '#6a50b0', panel: 'rgba(252,250,255,.92)', ink: '#3a3050' },
  music: 'classic', ambience: { owls: 0, wind: 0.1 }, dress: 'easter',
  critters: { bats: false, ghosts: false }, collectibles: { candy: false, wear: [] }, build: ['chick'],
  season: { leaf: ['#6cc24a', '#8ad05a', '#ffd0e0'], leafK: 0.15, snow: 0, grass: '#f4ffe8', ground: null, groundK: 0 },
};

export const THEMES: Record<ThemeId, Theme> = { spring, summer, autumn, winter, halloween, thanksgiving, christmas, newyear, valentine, easter };
/** holidays first so first-match date windows win over seasons */
export const THEME_ORDER: ThemeId[] = ['halloween', 'thanksgiving', 'christmas', 'newyear', 'valentine', 'easter', 'spring', 'summer', 'autumn', 'winter'];
/** themes the player can see and Auto can pick (others are hidden, not deleted) */
export const ENABLED_THEMES: ReadonlySet<ThemeId> = new Set<ThemeId>(['spring', 'summer', 'autumn', 'winter', 'halloween']);
export const isEnabled = (id: ThemeId) => ENABLED_THEMES.has(id);
/** picker order: THEME_ORDER filtered to the enabled themes */
export const VISIBLE_THEMES: ThemeId[] = THEME_ORDER.filter(isEnabled);
const SETTING_KEY = 'cozyIsland.theme.v1';

/** meteorological season by month (safety net if no enabled window matches) */
export function seasonForDate(d: Date = new Date()): ThemeId {
  const m = d.getMonth() + 1;
  return m >= 3 && m <= 5 ? 'spring' : m >= 6 && m <= 8 ? 'summer' : m >= 9 && m <= 11 ? 'autumn' : 'winter';
}
/** which enabled theme's date window contains this date (first match in THEME_ORDER), else the month's season */
export function themeForDate(d: Date = new Date()): ThemeId {
  const md = (d.getMonth() + 1) * 100 + d.getDate();
  for (const id of VISIBLE_THEMES) {
    const t = THEMES[id]; const w = t.windowFn ? t.windowFn(d.getFullYear()) : t.window; if (!w) continue;
    const a = w.from[0] * 100 + w.from[1], b = w.to[0] * 100 + w.to[1];
    if (a <= b ? md >= a && md <= b : md >= a || md <= b) return id;
  }
  return seasonForDate(d);
}
const migrate = (v: string): string => (v === 'classic' ? 'spring' : v);
const isId = (v: unknown): v is ThemeId => typeof v === 'string' && v in THEMES;
export function loadSetting(): ThemeSetting {
  try {
    const raw = localStorage.getItem(SETTING_KEY);
    if (!raw) return 'auto';
    if (raw === 'auto') return 'auto';
    const v = migrate(raw);
    if (isId(v) && isEnabled(v)) {
      if (raw === 'classic') try { localStorage.setItem(SETTING_KEY, 'spring'); } catch { /* ignore */ }
      return v;
    }
  } catch { /* private mode */ }
  return 'auto';
}
/** URL override (?theme=halloween | spring | auto | classic→spring) wins, then the saved setting, then the date */
export function resolveTheme(now: Date = new Date()): { id: ThemeId; source: 'url' | 'setting' | 'date' } {
  const qRaw = new URLSearchParams(location.search).get('theme');
  const q = qRaw ? migrate(qRaw) : null;
  if (isId(q)) return { id: q, source: 'url' };
  // ?date=2026-10-31 lets tests (and curious players) preview a season
  const dq = new URLSearchParams(location.search).get('date');
  const date = dq && !Number.isNaN(Date.parse(dq)) ? new Date(dq + 'T12:00:00') : now;
  const s = loadSetting();
  if (s !== 'auto' && q !== 'auto') return { id: s, source: 'setting' };
  return { id: themeForDate(date), source: 'date' };
}

type Listener = (t: Theme) => void;
const listeners = new Set<Listener>();
export const themeEvents = {
  on(f: Listener) { listeners.add(f); return () => listeners.delete(f); },
  emit(t: Theme) { for (const f of listeners) f(t); },
};
const first = resolveTheme();
export let theme: Theme = THEMES[first.id];
export let themeSource = first.source;
export let themeSetting: ThemeSetting = loadSetting();

/** switch live and remember the choice (hidden themes switch live for dev but are not saved) */
export function setTheme(s: ThemeSetting) {
  themeSetting = s;
  if (s === 'auto' || isEnabled(s)) try { localStorage.setItem(SETTING_KEY, s); } catch { /* ignore */ }
  const id = s === 'auto' ? themeForDate() : s;
  themeSource = s === 'auto' ? 'date' : 'setting';
  if (theme.id === id) return;
  theme = THEMES[id];
  applyThemeCss(theme);
  themeEvents.emit(theme);
}
/** HUD skin: CSS variables + body.theme-<id> */
export function applyThemeCss(t: Theme = theme) {
  const b = document.body;
  for (const id of THEME_ORDER) b.classList.toggle(`theme-${id}`, id === t.id);
  const st = b.style;
  st.setProperty('--accent', t.ui.accent); st.setProperty('--accent-dark', t.ui.accentDark);
  st.setProperty('--panel', t.ui.panel); st.setProperty('--ink', t.ui.ink);
}
