// PWA / service worker smoke (iPad viewport): registers after ready, repeat visit serves hashed assets from cache.
// Usage: node tests/pwa.mjs [baseUrl]   (default http://localhost:4181/cozy-island/)
import { chromium, devices } from 'playwright';

const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const kill = setTimeout(() => { console.error('TIMEOUT 170s'); browser.close().finally(() => process.exit(1)); }, 170_000);
let code = 1;
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n} ${x}`); return !!c; };
try {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], deviceScaleFactor: 1, viewport: { width: 1024, height: 768 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}?webgl&q=low&nonews`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.game?.ready === true, undefined, { timeout: 150_000 });
  const active = await page.evaluate(() => Promise.race([
    navigator.serviceWorker.ready.then((r) => r.active?.state === 'activated' || new Promise((res) => r.active.addEventListener('statechange', () => res(true)))),
    new Promise((res) => setTimeout(() => res(false), 20_000)),
  ]));
  await page.waitForTimeout(2500); // let the worker copy first-visit assets
  const firstCached = await page.evaluate(async () => (await (await caches.open('cozy-assets-v1')).keys()).length);
  const manifest = await page.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).ok);
  // repeat visit: don't wait for the full game, just count hashed assets served by the worker
  const fromSW = [], fromNet = [];
  page.on('response', (r) => {
    if (!r.url().includes('/assets/')) return;
    (r.fromServiceWorker() ? fromSW : fromNet).push(r.url().split('/').pop());
  });
  const st = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return { scope: r?.scope, state: r?.active?.state, ctl: !!navigator.serviceWorker.controller }; });
  console.log('sw', st);
  await page.reload({ waitUntil: 'domcontentloaded' });
  const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  await page.waitForFunction(() => document.getElementById('ld-stage')?.textContent?.length > 0, undefined, { timeout: 20_000 });
  await page.waitForTimeout(3000);
  const cached = await page.evaluate(async () => { let n = 0; for (const k of await caches.keys()) n += (await (await caches.open(k)).keys()).length; return n; });
  const res = [
    ok('sw active after ready', active),
    ok('first-visit assets handed to cache', firstCached >= 5, `(${firstCached})`),
    ok('manifest served', manifest),
    ok('repeat visit controlled by sw', controlled),
    ok('hashed assets served from sw cache', fromSW.length >= 2 && fromSW.some((u) => u.endsWith('.js')), `(sw ${fromSW.length}, net ${fromNet.length}, cached ${cached})`),
    ok('no pageerror', errors.length === 0, errors.slice(0, 2).join('; ')),
  ];
  code = res.every(Boolean) ? 0 : 1;
} catch (e) { console.error(e); } finally {
  clearTimeout(kill);
  try { await browser.close(); } catch { /* */ }
  process.exit(code);
}
