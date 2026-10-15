// The "What's new" card. Shown once per VERSION after load. Plain DOM over the canvas.
import type { AudioEngine } from '../audio/Audio';
import { VERSION, ITEMS, type WhatsNewItem } from './whatsnew';

const KEY = 'cozyIsland.whatsnew.seen';

const ICONS: Record<WhatsNewItem['icon'], string> = {
  wood: '<svg viewBox="0 0 40 40"><rect x="5" y="13" width="28" height="14" rx="7" fill="#b87a45" stroke="#6e4524" stroke-width="2.5"/><ellipse cx="31" cy="20" rx="5" ry="7" fill="#e9c08a" stroke="#6e4524" stroke-width="2.5"/><circle cx="31" cy="20" r="2" fill="#b87a45"/></svg>',
  fruit: '<svg viewBox="0 0 40 40"><path d="M20 12 C20 8 22 5 25 4" stroke="#5a7d2e" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M22 9 C27 5 32 7 33 10 C29 12 25 12 22 9Z" fill="#79b84a"/><circle cx="20" cy="24" r="12" fill="#e2453c" stroke="#9e2a24" stroke-width="2.5"/><ellipse cx="15" cy="20" rx="3" ry="2" fill="#fff" opacity=".6"/></svg>',
  star: '<svg viewBox="0 0 40 40"><path d="M20 4 L25 15 L37 16 L28 24 L31 36 L20 30 L9 36 L12 24 L3 16 L15 15Z" fill="#ffd34d" stroke="#c9902a" stroke-width="2.5" stroke-linejoin="round"/></svg>',
  heart: '<svg viewBox="0 0 40 40"><path d="M20 35 C8 26 4 20 4 13 C4 8 8 5 12 5 C16 5 18 8 20 11 C22 8 24 5 28 5 C32 5 36 8 36 13 C36 20 32 26 20 35Z" fill="#ff6f91" stroke="#b83a5c" stroke-width="2.5" stroke-linejoin="round"/></svg>',
};
const CHECK = '<svg viewBox="0 0 40 40"><path d="M8 21 L17 30 L33 11" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const CSS = `
#whatsnew{position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;color:#4a3b2f;
  background:rgba(0,0,0,.32);touch-action:manipulation;transition:opacity .35s ease;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);box-sizing:border-box}
#whatsnew.out{opacity:0;pointer-events:none}
#whatsnew *{box-sizing:border-box}
#whatsnew .w-card{width:min(560px,92vw);max-height:92%;overflow:auto;background:#fffaf0;border:3px solid #e8d5b8;border-radius:28px;
  box-shadow:0 12px 0 rgba(0,0,0,.12),0 22px 50px rgba(0,0,0,.28);padding:clamp(18px,3vh,28px) clamp(18px,3vw,30px);display:flex;flex-direction:column;gap:clamp(12px,2vh,16px);
  animation:w-in .45s cubic-bezier(.2,1.4,.4,1)}
@keyframes w-in{from{transform:translateY(24px) scale(.94);opacity:0}to{transform:none;opacity:1}}
#whatsnew h2{margin:0;text-align:center;font-weight:900;font-size:clamp(28px,4.5vw,42px);line-height:1.1;color:#c96a1a}
#whatsnew ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
#whatsnew li{display:flex;align-items:center;gap:14px;background:#fff6e8;border:2px solid #e8d5b8;border-radius:18px;padding:12px 14px;font-size:clamp(16px,2.4vw,20px);font-weight:700;line-height:1.25}
#whatsnew li svg{flex:0 0 auto;width:40px;height:40px}
#whatsnew .w-ok{min-height:72px;border:0;border-radius:24px;background:#ff9f43;color:#fffaf0;font-family:inherit;font-size:32px;font-weight:900;box-shadow:0 6px 0 #d97a2a;
  display:flex;align-items:center;justify-content:center;gap:12px;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;user-select:none}
#whatsnew .w-ok:active{transform:translateY(3px) scale(.97)}
#whatsnew .w-ok svg{width:32px;height:32px}
@media (prefers-reduced-motion:reduce){#whatsnew *{animation:none!important}}
`;

function seenVersion(): string | null { try { return localStorage.getItem(KEY); } catch { return null; } }
function markSeen() { try { localStorage.setItem(KEY, VERSION); } catch { /* ignore */ } }

/** Show once per VERSION. Tests skip unless ?whatsnew=1. */
export function showWhatsNew(audio?: AudioEngine) {
  const q = new URLSearchParams(location.search).get('whatsnew');
  if (q === '0' || ((navigator as Navigator & { webdriver?: boolean }).webdriver && q !== '1' && q !== 'empty')) return;
  const items = q === 'empty' ? [] : ITEMS;
  const api = { open: false, shown: 0, version: VERSION };
  (window as unknown as { __whatsnew: typeof api }).__whatsnew = api;
  if (!items.length || seenVersion() === VERSION || document.getElementById('whatsnew')) return;

  if (!document.getElementById('whatsnew-css')) {
    const st = document.createElement('style'); st.id = 'whatsnew-css'; st.textContent = CSS; document.head.appendChild(st);
  }
  const el = document.createElement('div');
  el.id = 'whatsnew';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', "What's new");
  el.innerHTML = `<div class="w-card"><h2>What's new!</h2><ul></ul><button class="w-ok" aria-label="OK, close">${CHECK}OK!</button></div>`;
  const ul = el.querySelector('ul')!;
  for (const it of items) {
    const li = document.createElement('li');
    li.innerHTML = ICONS[it.icon] ?? ICONS.star;
    const span = document.createElement('span'); span.textContent = it.text; li.appendChild(span);
    ul.appendChild(li);
  }
  for (const ev of ['touchstart', 'touchend', 'touchcancel', 'mousedown', 'mouseup', 'keydown', 'keyup', 'keypress', 'pointerdown']) {
    el.addEventListener(ev, (x) => x.stopPropagation());
  }
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    audio?.ui();
    markSeen();
    api.open = false;
    el.classList.add('out');
    window.removeEventListener('keydown', onKey, true);
    setTimeout(() => el.remove(), 380);
  };
  const onKey = (k: KeyboardEvent) => { if (k.key === 'Escape' || k.key === 'Enter') { k.stopPropagation(); close(); } };
  window.addEventListener('keydown', onKey, true);
  el.querySelector('.w-ok')!.addEventListener('click', close);
  el.addEventListener('click', (x) => { if (x.target === el) close(); });
  document.body.appendChild(el);
  api.open = true;
  api.shown++;
}
