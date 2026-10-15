// What's-new note: shows once per VERSION, OK dismisses, stays dismissed after reload. iPad touch.
// Usage: node tests/whatsnew.mjs [baseUrl]
import { chromium, devices } from 'playwright';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const outDir = new URL('../screenshots/', import.meta.url).pathname;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const __closeBrowser = async (code) => { try { await browser.close(); } catch { /* ignore */ } process.exit(code); };
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => __closeBrowser(130));
process.on('uncaughtException', (e) => { console.error(e); __closeBrowser(1); });
const results = []; const ok = (n, c, x = '') => { results.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
try {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11'], hasTouch: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(300000);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const url = base + '?webgl&q=low&touch=1&whatsnew=1';
  await page.goto(url); await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForFunction(() => window.game?.ready);
  await page.waitForSelector('#whatsnew', { timeout: 20000 }).catch(() => {});
  const shown = await page.evaluate(() => ({ el: !!document.getElementById('whatsnew'), items: document.querySelectorAll('#whatsnew li').length, api: window.__whatsnew }));
  ok('note shows on first load', shown.el && shown.items >= 3, JSON.stringify(shown));
  const sz = await page.evaluate(() => { const r = document.querySelector('#whatsnew .w-ok').getBoundingClientRect(); return [r.width, r.height]; });
  ok('OK is a big tap target', sz[1] >= 64 && sz[0] >= 200, sz.join('x'));
  await page.waitForTimeout(600); await page.screenshot({ path: outDir + '71-whatsnew.png' });
  await page.tap('#whatsnew .w-ok'); await page.waitForTimeout(600);
  ok('OK dismisses', await page.evaluate(() => !document.getElementById('whatsnew')));
  ok('seen version stored', (await page.evaluate(() => localStorage.getItem('cozyIsland.whatsnew.seen'))) === shown.api?.version);
  await page.reload(); await page.waitForFunction(() => window.game?.ready); await page.waitForTimeout(1500);
  ok('not shown again after reload', await page.evaluate(() => !document.getElementById('whatsnew')));
  ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
} finally { await browser.close(); }
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
