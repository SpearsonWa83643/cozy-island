// Clean HUD: corner panels hidden by default, ⚙️ toggles them (animated, persisted); 🎨 theme picker lists Auto +
// every theme in THEME_ORDER, choice persists, Auto returns to date; seasonal build pieces follow the theme.
// Desktop + iPad (?touch=1). Screenshots 54-56. Usage: node tests/dock.mjs [baseUrl] [--skip-desktop] [--skip-ipad]
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const outDir = new URL('../screenshots/', import.meta.url).pathname;
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const __closeBrowser = async (code) => { try { await browser.close(); } catch { /* ignore */ } process.exit(code); };
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => __closeBrowser(130));
process.on('uncaughtException', (e) => { console.error(e); __closeBrowser(1); });
process.on('unhandledRejection', (e) => { console.error(e); __closeBrowser(1); });
const results = []; const ok = (n, c, x = '') => { results.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
const errFilter = (m) => (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|swiftshader|Automatic fallback/i.test(m.text())));
const frames = (page, n) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const shot = async (page, n) => { await frames(page, 4); await page.screenshot({ path: outDir + n + '.png' }); console.log('saved', n); };
const vis = (page) => page.evaluate(() => { const v = (s) => { const e = document.querySelector(s); if (!e) return null; const c = getComputedStyle(e); return c.visibility !== 'hidden' && +c.opacity > 0.5; }; return { stats: v('.panel.stats'), title: v('.panel.title'), gear: v('.dock .gear'), theme: v('.dock .theme-btn'), picker: v('.theme-picker'), bar: v('.game-bar') }; });
const settle = (page, open) => page.waitForFunction((o) => { const c = getComputedStyle(document.querySelector('.panel.stats')); return o ? +c.opacity > 0.98 : c.visibility === 'hidden'; }, open, { timeout: 15000 }).catch(() => {});
const overlap = (page) => page.evaluate(() => { const d = document.querySelector('.dock').getBoundingClientRect(); const hits = []; for (const s of ['.eye-btn', '.action-btn', '.game-bar', '.tbtn']) for (const e of document.querySelectorAll(s)) { const r = e.getBoundingClientRect(); if (r.width && !(r.right < d.left || r.left > d.right || r.bottom < d.top || r.top > d.bottom)) hits.push(s); } return hits; });

async function run(label, dev, query) {
  const ctx = await browser.newContext(dev);
  const page = await ctx.newPage(); page.setDefaultTimeout(300000);
  const errors = []; page.on('console', (m) => { if (errFilter(m)) errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + query); await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForFunction(() => window.game?.ready);
  await page.waitForTimeout(500);
  const click = (s) => (label === 'ipad' ? page.tap(s) : page.click(s));
  let v = await vis(page);
  ok(`${label}: corner panels hidden by default, dock visible`, !v.stats && !v.title && v.gear && v.theme && !v.picker, JSON.stringify(v));
  const ov = await overlap(page); ok(`${label}: dock overlaps no play controls`, ov.length === 0, ov.join());
  const sz = await page.evaluate(() => { const r = document.querySelector('.dock .gear').getBoundingClientRect(); return [r.width, r.height]; });
  ok(`${label}: big touch target`, sz[0] >= (label === 'ipad' ? 60 : 52) && sz[1] >= 52, sz.join('x'));
  await shot(page, label === 'ipad' ? '54-ipad-clean-hud' : '54-clean-hud');
  await click('.dock .gear'); await settle(page, true);
  v = await vis(page); ok(`${label}: ⚙️ opens panels`, v.stats && v.title, JSON.stringify(v));
  if (label === 'desktop') await shot(page, '55-gear-open');
  else await shot(page, '55-ipad-gear-open');
  await page.reload(); await page.waitForFunction(() => window.game?.ready); await page.waitForTimeout(500);
  v = await vis(page); ok(`${label}: open state remembered after reload`, v.stats && v.title, JSON.stringify(v));
  await click('.dock .gear'); await settle(page, false);
  v = await vis(page); ok(`${label}: ⚙️ closes panels`, !v.stats && !v.title, JSON.stringify(v));
  // theme picker
  await click('.dock .theme-btn'); await page.waitForFunction(() => +getComputedStyle(document.querySelector('.theme-picker')).opacity > 0.98, null, { timeout: 15000 }).catch(() => {});
  const items = await page.evaluate(() => [...document.querySelectorAll('.tp-item')].map((b) => b.dataset.t).join());
  ok(`${label}: picker lists Auto + all themes`, items === 'auto,halloween,thanksgiving,christmas,newyear,valentine,easter,spring,summer,autumn,winter', items);
  ok(`${label}: old stats-panel theme buttons removed`, (await page.evaluate(() => document.querySelectorAll('.stats .th').length)) === 0);
  if (label === 'ipad') await shot(page, '56-ipad-theme-picker');
  await click('.tp-item[data-t="spring"]'); await page.waitForTimeout(500);
  let s = await page.evaluate(() => ({ id: window.game.themes.current().id, src: window.game.themes.source(), pick: getComputedStyle(document.querySelector('.theme-picker')).opacity, hot: [...document.querySelectorAll('.hotbar .slot')].filter((e) => e.style.display !== 'none').length }));
  ok(`${label}: choose Spring even in October`, s.id === 'spring' && s.src === 'setting', JSON.stringify(s));
  ok(`${label}: Halloween build pieces hidden in Spring`, s.hot === 6, JSON.stringify(s));
  await page.reload(); await page.waitForFunction(() => window.game?.ready);
  s = await page.evaluate(() => ({ id: window.game.themes.current().id }));
  ok(`${label}: choice persists`, s.id === 'spring', JSON.stringify(s));
  await click('.dock .theme-btn'); await page.waitForTimeout(450); await click('.tp-item[data-t="auto"]'); await page.waitForTimeout(500);
  s = await page.evaluate(() => ({ id: window.game.themes.current().id, src: window.game.themes.source(), want: window.game.themes.forDate(new Date().toISOString().slice(0, 10)), hot: [...document.querySelectorAll('.hotbar .slot')].filter((e) => e.style.display !== 'none').length }));
  ok(`${label}: Auto returns to date theme`, s.id === s.want && s.src === 'date', JSON.stringify(s));
  ok(`${label}: Halloween pieces back with Halloween`, s.want !== 'halloween' || s.hot === 7, JSON.stringify(s));
  ok(`${label}: no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}
try {
  if (!process.argv.includes('--skip-desktop')) await run('desktop', { viewport: { width: 1280, height: 800 } }, '?webgl&q=high');
  if (!process.argv.includes('--skip-ipad')) await run('ipad', { ...devices['iPad Pro 11'], hasTouch: true }, '?webgl&q=low&touch=1');
} finally { await browser.close(); }
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
