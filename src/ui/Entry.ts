// Entry screen: themed "who's playing?" card over the canvas on first load (and reopenable from gear).
// Name + birthday are optional and stay on this device (localStorage only). Plain DOM so the iPad
// keyboard works. Colours / drift come from the active theme. Adapted from 2D Master's entry.ts.
import type { AudioEngine } from '../audio/Audio';
import { theme, themeEvents, type Theme, type ThemeId } from '../theme/theme';
import {
  NAME_MAX, MONTHS, cleanName, finalName, daysIn, iso, loadPlayer, savePlayer,
  ageOn, isBirthday, type Player,
} from './entryPlayer';

export { cleanName, finalName, loadPlayer, savePlayer, ageOn, isBirthday, NAME_MAX };
export type { Player };

type EntryShape = 'leaf' | 'petal' | 'snow' | 'bat' | 'heart';
type EntryLook = {
  sky: [string, string, string];
  title: string; titleEdge: string;
  card: string; cardEdge: string;
  ink: string; soft: string;
  accent: string; accentDark: string; field: string;
  drift: { shape: EntryShape; colors: string[]; count: number };
  glow: { colors: string[]; count: number };
};

/** Derive entry colours / decorations from the live 3D theme (no Theme.entry field needed). */
export function entryLook(t: Theme = theme): EntryLook {
  const ui = t.ui;
  const darkInk = isDarkPanel(ui.panel);
  const soft = darkInk ? softFrom(ui.ink, 0.55) : softFrom(ui.ink, 0.45);
  const sky = t.sky
    ? ([hexA(t.sky.zenith, 0.88), hexA(t.sky.mid, 0.82), hexA(t.sky.horizon ?? t.sky.low, 0.9)] as [string, string, string])
    : (['rgba(126,178,196,0.78)', 'rgba(150,196,120,0.72)', 'rgba(52,86,48,0.86)'] as [string, string, string]);
  const drift = driftFor(t.id);
  return {
    sky,
    title: darkInk ? '#fff6dc' : '#fff6dc',
    titleEdge: darkInk ? '#2a1838' : '#5b3d24',
    card: darkInk ? 'rgba(255,248,240,0.96)' : (ui.panel.includes('rgba') ? ui.panel.replace(/[\d.]+\)$/, '0.96)') : 'rgba(251,241,220,0.96)'),
    cardEdge: darkInk ? softFrom(ui.accent, 0.55) : '#d9b98f',
    ink: darkInk ? '#3d2c20' : ui.ink,
    soft,
    accent: ui.accent,
    accentDark: ui.accentDark,
    field: '#fffaf0',
    drift,
    glow: { colors: [ui.accent, '#fff07a', ui.accentDark], count: drift.shape === 'bat' ? 18 : 14 },
  };
}

function isDarkPanel(p: string) {
  const m = p.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return false;
  return (+m[1] + +m[2] + +m[3]) / 3 < 90;
}
function softFrom(hex: string, k: number) {
  const h = hex.replace('#', '');
  if (h.length < 6) return hex;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * k);
  return `#${[mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
function hexA(hex: string, a: number) {
  const h = hex.replace('#', '');
  if (h.length < 6) return hex;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
function driftFor(id: ThemeId): EntryLook['drift'] {
  switch (id) {
    case 'halloween':
      return { shape: 'bat', colors: ['#2a1f36', '#3d2c52', '#1e1628'], count: 9 };
    case 'winter': case 'christmas': case 'newyear':
      return { shape: 'snow', colors: ['#ffffff', '#e8f4ff', '#c8e0f8'], count: 18 };
    case 'valentine':
      return { shape: 'heart', colors: ['#ff6a9a', '#ff8ab0', '#e04070'], count: 12 };
    case 'easter': case 'spring':
      return { shape: 'petal', colors: ['#ffc0d8', '#ffd0e0', '#c9e8a0', '#fff0a8'], count: 14 };
    case 'autumn': case 'thanksgiving':
      return { shape: 'leaf', colors: ['#ea8a2a', '#d24a26', '#f0c040', '#8a6040'], count: 14 };
    default:
      return { shape: 'leaf', colors: ['#8fc45a', '#c9d65a', '#6fae4f', '#f2b84b'], count: 14 };
  }
}

const SHAPES: Record<EntryShape, (c: string) => string> = {
  leaf: (c) => `<svg viewBox="0 0 40 40"><path d="M6 34 C6 14 20 5 35 5 C35 22 26 34 6 34Z" fill="${c}"/><path d="M7 33 L27 13" stroke="rgba(0,0,0,0.22)" stroke-width="2" stroke-linecap="round"/></svg>`,
  petal: (c) => `<svg viewBox="0 0 40 40"><ellipse cx="20" cy="20" rx="9" ry="16" fill="${c}"/></svg>`,
  snow: (c) => `<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="9" fill="${c}"/></svg>`,
  heart: (c) => `<svg viewBox="0 0 40 40"><path d="M20 34 C8 24 4 18 4 12 C4 7 8 4 12 4 C16 4 18 7 20 10 C22 7 24 4 28 4 C32 4 36 7 36 12 C36 18 32 24 20 34Z" fill="${c}"/></svg>`,
  bat: (c) => `<svg viewBox="0 0 60 30"><path d="M30 12 C27 6 22 6 20 10 C16 4 8 4 2 10 C8 12 10 18 12 22 C16 18 22 18 26 22 L30 18 L34 22 C38 18 44 18 48 22 C50 18 52 12 58 10 C52 4 44 4 40 10 C38 6 33 6 30 12Z" fill="${c}"/><circle cx="27.5" cy="12" r="1.3" fill="#ffcf7a"/><circle cx="32.5" cy="12" r="1.3" fill="#ffcf7a"/></svg>`,
};

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]!;

const CSS = `
#entry{position:fixed;inset:0;z-index:40;font-family:system-ui,-apple-system,sans-serif;color:var(--e-ink);display:flex;align-items:center;justify-content:center;
  overflow:hidden;touch-action:manipulation;transition:opacity .45s ease;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);box-sizing:border-box}
#entry.out{opacity:0;pointer-events:none}
#entry *{box-sizing:border-box}
#entry .e-sky{position:absolute;inset:0;background:linear-gradient(180deg,var(--e-sky1),var(--e-sky2) 55%,var(--e-sky3));transition:background .6s}
#entry .e-fx{position:absolute;inset:0;pointer-events:none;overflow:hidden}
#entry .e-d{position:absolute;top:-60px;width:var(--s);height:var(--s);animation:e-fall var(--t) linear var(--dl) infinite;opacity:.9}
#entry .e-d>i{display:block;width:100%;height:100%;animation:e-sway calc(var(--t)/4) ease-in-out var(--dl) infinite alternate}
#entry .e-d svg{width:100%;height:100%;display:block}
#entry .e-d.bat{top:var(--y);left:-90px;width:calc(var(--s)*1.6);animation:e-fly var(--t) linear var(--dl) infinite}
#entry .e-d.bat>i{animation:e-flap .32s ease-in-out infinite alternate}
#entry .e-g{position:absolute;width:var(--s);height:var(--s);border-radius:50%;background:var(--c);box-shadow:0 0 10px 4px var(--c);left:var(--x);top:var(--y);
  animation:e-float var(--t) ease-in-out var(--dl) infinite alternate,e-blink calc(var(--t)/2.5) ease-in-out var(--dl) infinite alternate}
@keyframes e-fall{from{transform:translate3d(var(--x),0,0) rotate(0)}to{transform:translate3d(calc(var(--x) + var(--dx)),calc(100vh + 120px),0) rotate(var(--r))}}
@keyframes e-sway{from{transform:translateX(-18px) rotate(-14deg)}to{transform:translateX(18px) rotate(14deg)}}
@keyframes e-fly{from{transform:translate3d(0,0,0)}50%{transform:translate3d(55vw,var(--dy),0)}to{transform:translate3d(calc(100vw + 180px),0,0)}}
@keyframes e-flap{from{transform:scaleY(1)}to{transform:scaleY(.45)}}
@keyframes e-float{from{transform:translate(0,0)}to{transform:translate(var(--dx),var(--dy))}}
@keyframes e-blink{from{opacity:.15}to{opacity:1}}
#entry .e-wrap{position:relative;display:flex;flex-direction:column;align-items:center;gap:min(2.2vh,18px);width:min(780px,94vw);max-height:100%;padding:12px 0;overflow:auto}
#entry .e-title{margin:0;font-weight:900;font-size:clamp(36px,min(8vw,9vh),72px);line-height:1.05;color:var(--e-title);white-space:nowrap;text-align:center;
  -webkit-text-stroke:3px var(--e-titleEdge);paint-order:stroke fill;text-shadow:0 6px 0 var(--e-titleEdge),0 10px 24px rgba(0,0,0,.35);animation:e-swing 5s ease-in-out infinite alternate;transform-origin:50% 0}
#entry .e-title span{display:inline-block;animation:e-bob 2.4s ease-in-out infinite;animation-delay:calc(var(--i)*-0.16s)}
#entry .e-title .sp{white-space:pre}
@keyframes e-swing{from{transform:rotate(-1.6deg)}to{transform:rotate(1.6deg)}}
@keyframes e-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-.09em)}}
#entry .e-card{width:100%;background:var(--e-card);border:3px solid var(--e-cardEdge);border-radius:30px;box-shadow:0 12px 0 rgba(0,0,0,.14),0 22px 50px rgba(0,0,0,.3);
  padding:clamp(16px,2.6vh,26px) clamp(18px,3vw,32px);display:flex;flex-direction:column;gap:clamp(10px,1.8vh,16px);animation:e-in .5s cubic-bezier(.2,1.4,.4,1)}
@keyframes e-in{from{transform:translateY(24px) scale(.96);opacity:0}to{transform:none;opacity:1}}
#entry .e-lab{font-size:22px;font-weight:900;color:var(--e-soft);display:flex;align-items:center;justify-content:space-between;min-height:30px}
#entry .e-namebox{position:relative}
#entry input.e-name{width:100%;height:84px;border-radius:22px;border:3px solid var(--e-cardEdge);background:var(--e-field);color:var(--e-ink);font:900 42px system-ui,sans-serif;
  padding:0 84px 0 24px;outline:none;-webkit-user-select:text;user-select:text;touch-action:manipulation;letter-spacing:.02em}
#entry input.e-name:focus{border-color:var(--e-accent);box-shadow:0 0 0 5px color-mix(in srgb,var(--e-accent) 30%,transparent)}
#entry input.e-name::placeholder{color:var(--e-soft);opacity:.55;font-weight:800}
#entry button{font-family:inherit;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;border:0;color:inherit;user-select:none;-webkit-user-select:none}
#entry button:active{transform:translateY(3px) scale(.97)}
#entry .e-x{position:absolute;right:12px;top:12px;width:60px;height:60px;border-radius:50%;background:rgba(0,0,0,.08);font-size:34px;font-weight:900;color:var(--e-soft);line-height:1}
#entry .e-x[hidden]{display:none}
#entry .e-pill{min-height:48px;padding:0 20px;border-radius:24px;background:rgba(0,0,0,.07);font-size:18px;font-weight:800;color:var(--e-soft)}
#entry .e-dob{display:grid;grid-template-columns:1fr 1fr 1.2fr;gap:12px}
#entry .e-step{display:flex;flex-direction:column;align-items:center;gap:6px}
#entry .e-steplab{font-size:17px;font-weight:800;color:var(--e-soft)}
#entry .e-row{display:flex;align-items:center;gap:6px;width:100%}
#entry .e-pm{flex:0 0 auto;width:64px;height:76px;border-radius:20px;background:var(--e-accent);color:#fffaf0;font-size:44px;font-weight:900;line-height:1;box-shadow:0 5px 0 var(--e-accentDark)}
#entry .e-val{flex:1;min-width:0;height:76px;border-radius:18px;background:var(--e-field);border:3px solid var(--e-cardEdge);display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1}
#entry .e-val b{font-size:34px;font-weight:900;color:var(--e-ink)}
#entry .e-val small{font-size:15px;font-weight:800;color:var(--e-soft);margin-top:2px}
#entry .e-val.unset b{color:var(--e-soft);opacity:.5}
#entry .e-age{text-align:center;font-size:22px;font-weight:900;color:var(--e-accentDark);min-height:28px}
#entry .e-btns{display:flex;gap:16px;align-items:stretch}
#entry .e-play{flex:1;min-height:92px;border-radius:28px;background:var(--e-accent);color:#fffaf0;font-size:40px;font-weight:900;box-shadow:0 7px 0 var(--e-accentDark);display:flex;align-items:center;justify-content:center;gap:14px;
  animation:e-pulse 1.8s ease-in-out infinite}
#entry .e-play svg{width:36px;height:36px}
@keyframes e-pulse{0%,100%{box-shadow:0 7px 0 var(--e-accentDark),0 0 0 0 color-mix(in srgb,var(--e-accent) 45%,transparent)}50%{box-shadow:0 7px 0 var(--e-accentDark),0 0 0 12px transparent}}
#entry .e-alt{flex:0 0 auto;min-width:150px;min-height:92px;border-radius:28px;background:rgba(0,0,0,.07);font-size:26px;font-weight:900;color:var(--e-soft);display:flex;align-items:center;justify-content:center;gap:10px}
#entry .e-alt svg{width:26px;height:26px}
#entry .e-hello{font-size:clamp(32px,5.5vw,52px);font-weight:900;text-align:center;line-height:1.1;padding:8px 0;color:var(--e-ink)}
#entry .e-hello span{color:var(--e-accentDark);display:inline-block;animation:e-bob 2.4s ease-in-out infinite}
#entry .e-sub{text-align:center;font-size:22px;font-weight:800;color:var(--e-soft);min-height:28px}
@media (max-height:600px){#entry .e-title{font-size:36px}#entry input.e-name{height:68px;font-size:34px}#entry .e-play,#entry .e-alt{min-height:72px}#entry .e-pm,#entry .e-val{height:64px}}
@media (prefers-reduced-motion:reduce){#entry *{animation:none!important}}
`;

const PLAY_SVG = '<svg viewBox="0 0 40 40"><path d="M11 6 L34 20 L11 34Z" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/></svg>';
const SKIP_SVG = '<svg viewBox="0 0 40 40"><path d="M8 8 L24 20 L8 32Z M22 8 L38 20 L22 32Z" fill="currentColor"/></svg>';
const EDIT_SVG = '<svg viewBox="0 0 40 40"><path d="M8 32 L10 24 L26 8 L32 14 L16 30Z" fill="currentColor"/></svg>';

export let player: Player = loadPlayer();

type View = 'form' | 'welcome';
export type EntryOpts = {
  audio?: AudioEngine;
  toast?: (html: string, ms?: number) => void;
  onChange?: (p: Player) => void;
  /** force the form even if already seen */
  edit?: boolean;
};

class EntryScreen {
  el!: HTMLDivElement;
  view: View;
  name = player.name;
  dob: { y: number; m: number; d: number } | null = null;
  private repeat = 0;
  private onTheme = () => this.paintTheme();
  private offTheme: (() => void) | null = null;

  constructor(private opts: EntryOpts) {
    this.view = opts.edit || !player.seen ? 'form' : 'welcome';
    if (player.dob) { const [y, m, d] = player.dob.split('-').map(Number); this.dob = { y, m, d }; }
  }

  open() {
    if (!document.getElementById('entry-css')) {
      const st = document.createElement('style'); st.id = 'entry-css'; st.textContent = CSS; document.head.appendChild(st);
    }
    this.el = document.createElement('div');
    this.el.id = 'entry';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Who is playing?');
    for (const ev of ['keydown', 'keyup', 'keypress'] as const) this.el.addEventListener(ev, (e) => {
      e.stopPropagation();
      if (ev === 'keydown' && (e as KeyboardEvent).key === 'Enter' && document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
    });
    for (const ev of ['touchstart', 'touchend', 'touchcancel', 'mousedown', 'mouseup', 'pointerdown'] as const) {
      this.el.addEventListener(ev, (e) => e.stopPropagation());
    }
    this.el.innerHTML = `<div class="e-sky"></div><div class="e-fx"></div>
      <div class="e-wrap"><h1 class="e-title" aria-label="Cozy Island"></h1><div class="e-card"></div></div>`;
    const title = this.el.querySelector('.e-title')!;
    [...'Cozy Island'].forEach((ch, i) => {
      const s = document.createElement('span'); s.setAttribute('aria-hidden', 'true');
      s.textContent = ch === ' ' ? ' ' : ch;
      if (ch === ' ') s.className = 'sp';
      s.style.setProperty('--i', String(i));
      title.appendChild(s);
    });
    document.body.appendChild(this.el);
    document.body.classList.add('entry-open');
    this.offTheme = themeEvents.on(this.onTheme);
    this.paintTheme();
    this.render();
  }

  paintTheme() {
    const e = entryLook(theme);
    const vars: Record<string, string> = {
      '--e-sky1': e.sky[0], '--e-sky2': e.sky[1], '--e-sky3': e.sky[2],
      '--e-title': e.title, '--e-titleEdge': e.titleEdge, '--e-card': e.card, '--e-cardEdge': e.cardEdge,
      '--e-ink': e.ink, '--e-soft': e.soft, '--e-accent': e.accent, '--e-accentDark': e.accentDark, '--e-field': e.field,
    };
    for (const [k, v] of Object.entries(vars)) this.el.style.setProperty(k, v);
    this.el.dataset.theme = theme.id;
    this.decorate(e);
  }

  decorate(e: EntryLook) {
    const fx = this.el.querySelector('.e-fx')!;
    fx.innerHTML = '';
    if (reduceMotion()) return;
    const { drift, glow } = e;
    const bat = drift.shape === 'bat';
    for (let i = 0; i < drift.count; i++) {
      const d = document.createElement('div');
      d.className = `e-d${bat ? ' bat' : ''}`;
      const t = bat ? rnd(9, 16) : rnd(10, 19);
      const st = d.style;
      st.setProperty('--s', `${Math.round(bat ? rnd(30, 52) : rnd(22, 40))}px`);
      st.setProperty('--t', `${t.toFixed(1)}s`);
      st.setProperty('--dl', `${(-rnd(0, t)).toFixed(1)}s`);
      st.setProperty('--x', `${rnd(-5, 100).toFixed(1)}vw`);
      st.setProperty('--dx', `${rnd(-12, 12).toFixed(1)}vw`);
      st.setProperty('--y', `${rnd(4, 70).toFixed(1)}vh`);
      st.setProperty('--dy', `${rnd(-12, 12).toFixed(1)}vh`);
      st.setProperty('--r', `${Math.round(rnd(-540, 540))}deg`);
      d.innerHTML = `<i>${SHAPES[drift.shape](pick(drift.colors))}</i>`;
      fx.appendChild(d);
    }
    for (let i = 0; i < glow.count; i++) {
      const g = document.createElement('div');
      g.className = 'e-g';
      const st = g.style;
      st.setProperty('--s', `${Math.round(rnd(4, 8))}px`);
      st.setProperty('--c', pick(glow.colors));
      st.setProperty('--x', `${rnd(2, 98).toFixed(1)}%`);
      st.setProperty('--y', `${rnd(30, 98).toFixed(1)}%`);
      st.setProperty('--dx', `${rnd(-60, 60).toFixed(0)}px`);
      st.setProperty('--dy', `${rnd(-70, 30).toFixed(0)}px`);
      const t = rnd(3, 7);
      st.setProperty('--t', `${t.toFixed(1)}s`);
      st.setProperty('--dl', `${(-rnd(0, t)).toFixed(1)}s`);
      fx.appendChild(g);
    }
  }

  render() {
    const card = this.el.querySelector('.e-card') as HTMLDivElement;
    card.innerHTML = '';
    card.style.animation = 'none'; void card.offsetWidth; card.style.animation = '';
    card.dataset.view = this.view;
    if (this.view === 'welcome') {
      const n = player.name;
      const bday = isBirthday(player.dob);
      card.innerHTML = `<div class="e-hello">${bday ? 'Happy birthday' : 'Welcome back'}${n ? ', <span class="e-who"></span>' : ''}!</div>
        <div class="e-sub"></div>
        <div class="e-btns"><button type="button" class="e-alt e-edit" aria-label="Edit name and birthday">${EDIT_SVG}Edit</button><button type="button" class="e-play">${PLAY_SVG}Play</button></div>`;
      if (n) card.querySelector('.e-who')!.textContent = n;
      const age = player.dob ? ageOn(player.dob) : -1;
      (card.querySelector('.e-sub') as HTMLElement).textContent =
        age >= 1 && age < 120 ? (bday ? `You are ${age} today!` : `Age ${age}`) : 'Ready for an adventure?';
      card.querySelector('.e-edit')!.addEventListener('click', () => { this.opts.audio?.ui(); this.view = 'form'; this.render(); });
      card.querySelector('.e-play')!.addEventListener('click', () => this.play(false));
      return;
    }
    card.innerHTML = `<div class="e-lab"><label for="e-name">Your name</label></div>
      <div class="e-namebox"><input id="e-name" class="e-name" type="text" inputmode="text" enterkeyhint="done" autocomplete="off" autocorrect="off"
        autocapitalize="words" spellcheck="false" maxlength="${NAME_MAX}" placeholder="Tap to type" aria-label="Your name">
        <button type="button" class="e-x" aria-label="Clear name">\u00D7</button></div>
      <div class="e-lab"><span>Birthday</span><button type="button" class="e-pill e-clear">No birthday</button></div>
      <div class="e-dob">${(['m', 'd', 'y'] as const).map((k) => `<div class="e-step" data-k="${k}"><div class="e-steplab">${k === 'm' ? 'Month' : k === 'd' ? 'Day' : 'Year'}</div>
        <div class="e-row"><button type="button" class="e-pm" data-k="${k}" data-s="-1" aria-label="${k} down">\u2212</button><div class="e-val" data-k="${k}"><b></b><small></small></div><button type="button" class="e-pm" data-k="${k}" data-s="1" aria-label="${k} up">+</button></div></div>`).join('')}</div>
      <div class="e-age"></div>
      <div class="e-btns"><button type="button" class="e-alt e-skip">${player.seen ? 'Back' : `${SKIP_SVG}Skip`}</button><button type="button" class="e-play">${PLAY_SVG}Play</button></div>`;
    const input = card.querySelector('input') as HTMLInputElement;
    const x = card.querySelector('.e-x') as HTMLButtonElement;
    input.value = this.name;
    x.hidden = !this.name;
    input.addEventListener('input', () => {
      const c = cleanName(input.value);
      if (c !== input.value) {
        const pos = Math.min(input.selectionStart ?? c.length, c.length);
        input.value = c;
        try { input.setSelectionRange(pos, pos); } catch { /* */ }
      }
      this.name = c; x.hidden = !c;
    });
    input.addEventListener('blur', () => { input.value = this.name = finalName(input.value); x.hidden = !this.name; });
    x.addEventListener('click', () => { this.name = ''; input.value = ''; x.hidden = true; this.opts.audio?.ui(); input.focus(); });
    card.querySelector('.e-clear')!.addEventListener('click', () => { this.dob = null; this.opts.audio?.ui(); this.paintDob(); });
    card.querySelectorAll<HTMLButtonElement>('.e-pm').forEach((b) => {
      const k = b.dataset.k as 'm' | 'd' | 'y', s = Number(b.dataset.s);
      const stop = () => { clearTimeout(this.repeat); clearInterval(this.repeat); this.repeat = 0; };
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
        stop();
        this.step(k, s); this.opts.audio?.ui();
        this.repeat = window.setTimeout(() => {
          this.repeat = window.setInterval(() => this.step(k, s), k === 'y' ? 70 : 110);
        }, 420);
      });
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) b.addEventListener(ev, stop);
    });
    card.querySelector('.e-skip')!.addEventListener('click', () => this.play(true));
    card.querySelector('.e-play')!.addEventListener('click', () => this.play(false));
    this.paintDob();
  }

  step(k: 'm' | 'd' | 'y', s: number) {
    const now = new Date(), ny = now.getFullYear();
    if (!this.dob) { this.dob = { y: ny - 6, m: now.getMonth() + 1, d: 1 }; this.paintDob(); return; }
    const b = this.dob;
    if (k === 'm') b.m = ((b.m - 1 + s + 12) % 12) + 1;
    else if (k === 'y') b.y = Math.max(ny - 99, Math.min(ny, b.y + s));
    else { const n = daysIn(b.y, b.m); b.d = ((b.d - 1 + s + n) % n) + 1; }
    b.d = Math.min(b.d, daysIn(b.y, b.m));
    this.paintDob();
  }

  paintDob() {
    const b = this.dob;
    for (const k of ['m', 'd', 'y'] as const) {
      const v = this.el.querySelector(`.e-val[data-k="${k}"]`);
      if (!v) continue;
      v.classList.toggle('unset', !b);
      v.querySelector('b')!.textContent = b ? String(b[k]) : '?';
      v.querySelector('small')!.textContent = b && k === 'm' ? MONTHS[b.m - 1]! : '';
    }
    const clear = this.el.querySelector('.e-clear') as HTMLButtonElement | null;
    if (clear) clear.style.visibility = b ? 'visible' : 'hidden';
    const age = this.el.querySelector('.e-age');
    if (age) {
      const a = b ? ageOn(iso(b.y, b.m, b.d)) : -1;
      age.textContent = !b ? 'Tap + to pick your birthday (you can skip it)' : a >= 1 ? `You are ${a}!` : a === 0 ? 'A brand-new baby!' : '';
      (age as HTMLElement).style.color = b ? '' : 'var(--e-soft)';
      (age as HTMLElement).style.fontSize = b ? '' : '18px';
    }
  }

  play(skip: boolean) {
    if (this.el.classList.contains('out')) return;
    this.opts.audio?.ui();
    if (!skip) {
      player.name = finalName(this.name);
      player.dob = this.dob ? iso(this.dob.y, this.dob.m, this.dob.d) : null;
    }
    player.seen = true;
    savePlayer(player);
    this.opts.onChange?.(player);
    this.close();
    const n = player.name;
    if (n && this.opts.toast) {
      const msg = isBirthday(player.dob) ? `🎂 Happy birthday, ${n}!` : `Hi, ${n}!`;
      setTimeout(() => this.opts.toast?.(msg, 2200), 450);
    }
  }

  close() {
    this.el.classList.add('out');
    this.offTheme?.(); this.offTheme = null;
    clearTimeout(this.repeat); clearInterval(this.repeat);
    document.body.classList.remove('entry-open');
    setTimeout(() => { this.el.remove(); active = null; markDone(); }, 480);
  }
}

let active: EntryScreen | null = null;
const after: (() => void)[] = [];
let done = false;
function markDone() {
  if (done) return;
  done = true;
  for (const f of after.splice(0)) { try { f(); } catch (e) { console.error(e); } }
}

/** Run cb once the entry screen has been closed (or right away if it never shows). */
export function afterEntry(cb: () => void) { if (done) cb(); else after.push(cb); }

/** Show the entry screen. Automated test browsers skip unless ?entry=1. Pass edit:true to reopen from settings. */
export function showEntry(opts: EntryOpts = {}) {
  const q = new URLSearchParams(location.search).get('entry');
  const webdriver = !!(navigator as Navigator & { webdriver?: boolean }).webdriver;
  if (!opts.edit && (q === '0' || (webdriver && q !== '1'))) { markDone(); return; }
  if (active) return;
  // Re-open after a prior close: reset the "done" gate so afterEntry still works for first load only.
  if (opts.edit) { /* keep done as-is; whatsnew already ran */ }
  else if (!player.seen) { /* first-time form */ }
  player = loadPlayer();
  active = new EntryScreen(opts);
  active.open();
  (window as unknown as { __entry: { open: boolean; view: string | null; player: Player } }).__entry = {
    get open() { return !!active && !active.el.classList.contains('out'); },
    get view() { return active?.view ?? null; },
    get player() { return { ...player }; },
  };
}

/** Re-open the entry form from settings/gear (always shows, even if already seen). */
export function openEntryEditor(opts: EntryOpts = {}) {
  if (active) return;
  player = loadPlayer();
  active = new EntryScreen({ ...opts, edit: true });
  active.open();
  (window as unknown as { __entry: { open: boolean; view: string | null; player: Player } }).__entry = {
    get open() { return !!active && !active.el.classList.contains('out'); },
    get view() { return active?.view ?? null; },
    get player() { return { ...player }; },
  };
}
