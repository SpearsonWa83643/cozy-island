// Entry card is a lazy chunk (polish 2026-11-17): with ?entry=1 the "who's playing?" form is up by the time the
// world is ready, typing a name + Play sets the HUD title and saves it, the What's New card follows after it
// closes, a reload shows the welcome-back view, and the stats-panel name button reopens the editor. iPad viewport.
import { chromium, devices } from 'playwright';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const outDir = new URL('../screenshots/', import.meta.url).pathname;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = []; const ok = (n, c, d = '') => { results.push(!!c); console.log(`${c ? 'PASS' : 'FAIL'} ${n} ${c ? '' : d}`); };
try {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], hasTouch: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(Number(process.env.TEST_TIMEOUT_MS ?? 180000));
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(base + '?webgl&q=low&touch=1&entry=1&whatsnew=1');
  await page.waitForFunction(() => window.game?.ready);
  const st = await page.evaluate(() => ({ entry: !!document.querySelector('#entry'), view: window.__entry?.view, whatsnew: !!document.querySelector('#whatsnew') }));
  ok('entry form is up by ready (fresh player)', st.entry && st.view === 'form', JSON.stringify(st));
  ok('What\'s New waits for the entry card', !st.whatsnew, JSON.stringify(st));
  await page.screenshot({ path: outDir + 'entry-lazy-ipad.png' });
  await page.fill('#entry input.e-name', 'Walker');
  await page.tap('#entry .e-play');
  await page.waitForFunction(() => !document.querySelector('#entry'), null, { timeout: 10000 }).catch(() => null);
  const after = await page.evaluate(() => ({ title: document.querySelector('.title h1')?.textContent, saved: JSON.parse(localStorage.getItem('cozyIsland.player.v1') || 'null') }));
  ok('Play closes the card, names the island and saves', !(await page.$('#entry')) && /Walker/.test(after.title || '') && after.saved?.name === 'Walker' && after.saved?.seen, JSON.stringify(after));
  ok('What\'s New card follows the entry card', !!(await page.waitForSelector('#whatsnew', { timeout: 20000 }).catch(() => null)));
  await page.reload(); await page.waitForFunction(() => window.game?.ready);
  await page.waitForSelector('#entry', { timeout: 20000 }).catch(() => null);
  const v2 = await page.evaluate(() => ({ view: window.__entry?.view, title: document.querySelector('.title h1')?.textContent }));
  ok('reload: welcome-back view and HUD name from save', v2.view === 'welcome' && /Walker/.test(v2.title || ''), JSON.stringify(v2));
  await page.tap('#entry .e-play');
  await page.waitForFunction(() => !document.querySelector('#entry'), null, { timeout: 10000 }).catch(() => null);
  await page.evaluate(() => document.querySelector('#whatsnew .ok, #whatsnew button')?.click());
  await page.evaluate(() => document.querySelector('.who')?.click());
  await page.waitForSelector('#entry', { timeout: 10000 }).catch(() => null);
  ok('name button reopens the editor form', await page.evaluate(() => !!document.querySelector('#entry') && window.__entry?.view === 'form'));
  ok('no page errors', errs.length === 0, errs.join(' | '));
} finally { await browser.close(); }
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
