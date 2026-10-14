// Theme system (mirrors 2D Master's cozy-game src/theme.ts: Theme / THEMES / THEME_ORDER / theme / setTheme /
// themeEvents). A theme describes the whole look and feel. The renderer grade, sky + fog, HUD skin, music,
// decorations ("dress"), critters, collectibles and build pieces all read the active theme and listen for
// changes, so a switch happens live. New for 3D: each theme can carry a date window, and the active theme is
// resolved as  URL ?theme=  >  saved setting  >  date window  >  classic.

export type ThemeId = 'classic' | 'halloween';
export type ThemeSetting = 'auto' | ThemeId;

export interface Theme {
  id: ThemeId;
  name: string;
  icon: string;
  /** auto-activation window, inclusive, as [month (1-12), day]; wraps the new year if from > to */
  window: { from: [number, number]; to: [number, number] } | null;
  /** post grade (High quality pipeline): multiply tint, saturation, vignette tint */
  grade: { tint: string; sat: number; vignette: string };
  /** sky dome + light rig. blend 0 = biome atmosphere untouched, 1 = fully the theme's */
  sky: {
    blend: number; zenith: string; mid: string; low: string; horizon: string; fog: string; fogNear: number; fogFar: number;
    sun: string; sunI: number; hemiSky: string; hemiGround: string; hemiI: number; sunGlow: number; moon: number; stars: number;
  } | null;
  /** HUD skin: CSS custom properties + a body class (hud.css: body.theme-<id>) */
  ui: { accent: string; accentDark: string; panel: string; ink: string };
  music: 'classic' | 'spooky';
  /** extra ambience: owl hoots, wind boost (0..1) */
  ambience: { owls: number; wind: number };
  /** decorations module ("dress") to build for this theme */
  dress: 'halloween' | null;
  critters: { bats: boolean; ghosts: boolean };
  /** themed pickups + wearables that drop while the theme is on */
  collectibles: { candy: boolean; wear: string[] };
  /** extra build pieces shown in build mode */
  build: string[];
}

const classic: Theme = {
  id: 'classic', name: 'Classic', icon: '🌿', window: null,
  grade: { tint: '#ffffff', sat: 1.12, vignette: '#ffeedb' },
  sky: null,
  ui: { accent: '#f2a93b', accentDark: '#c9802a', panel: 'rgba(255,250,240,.88)', ink: '#4a3b2f' },
  music: 'classic', ambience: { owls: 0, wind: 0 }, dress: null,
  critters: { bats: false, ghosts: false }, collectibles: { candy: false, wear: [] }, build: [],
};

export const HALLOWEEN_WEAR = ['witchhat', 'pumpkinhead', 'ghostsheet', 'catears', 'vampirecape', 'nightwings'];

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
};

export const THEMES: Record<ThemeId, Theme> = { classic, halloween };
export const THEME_ORDER: ThemeId[] = ['classic', 'halloween'];
const SETTING_KEY = 'cozyIsland.theme.v1';

/** which theme's date window contains this date (first match in THEME_ORDER), else classic */
export function themeForDate(d: Date = new Date()): ThemeId {
  const md = (d.getMonth() + 1) * 100 + d.getDate();
  for (const id of THEME_ORDER) {
    const w = THEMES[id].window; if (!w) continue;
    const a = w.from[0] * 100 + w.from[1], b = w.to[0] * 100 + w.to[1];
    if (a <= b ? md >= a && md <= b : md >= a || md <= b) return id;
  }
  return 'classic';
}
const isId = (v: unknown): v is ThemeId => typeof v === 'string' && v in THEMES;
export function loadSetting(): ThemeSetting {
  try { const v = localStorage.getItem(SETTING_KEY); if (v === 'auto' || isId(v)) return v; } catch { /* private mode */ }
  return 'auto';
}
/** URL override (?theme=halloween | classic | auto) wins, then the saved setting, then the date */
export function resolveTheme(now: Date = new Date()): { id: ThemeId; source: 'url' | 'setting' | 'date' } {
  const q = new URLSearchParams(location.search).get('theme');
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

/** switch live (and remember the choice unless it's 'auto') */
export function setTheme(s: ThemeSetting) {
  themeSetting = s;
  try { localStorage.setItem(SETTING_KEY, s); } catch { /* ignore */ }
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
