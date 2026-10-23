// World generation in Web Workers (Order 39a, Big island 5/7): worker path is used, matches the
// main-thread fallback exactly, and the game still loads + plays on an iPad touch viewport.
// Usage: node tests/gen-worker.mjs [baseUrl]
import { chromium, devices } from 'playwright';

const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const kill = setTimeout(() => { console.error('TIMEOUT 540s'); browser.close().finally(() => process.exit(1)); }, 540_000);
let pass = true;
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n} ${x}`); if (!c) pass = false; return !!c; };
async function load(q) {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], deviceScaleFactor: 1, viewport: { width: 1024, height: 768 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const t0 = Date.now();
  await page.goto(`${base}?webgl&q=low&nonews&nosw&${q}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.game?.ready === true, undefined, { timeout: 240_000 });
  const loadMs = Date.now() - t0;
  const r = await page.evaluate(() => ({ gen: window.game.genStats, workerScripts: performance.getEntriesByType('resource').filter((e) => /gen\.worker/.test(e.name)).length }));
  // sample terrain heights through the mesh attribute (independent of module internals)
  const heights = await page.evaluate(() => Array.from(window.game.terrain.heights.filter((_, i) => i % 997 === 0)));
  return { ctx, page, errors, loadMs, ...r, heights };
}
try {
  const v = await load('gen=verify');
  console.log('verify', JSON.stringify({ gen: v.gen, loadMs: v.loadMs, workerScripts: v.workerScripts }));
  ok('worker path used', v.gen?.mode === 'worker' && v.gen.workers >= 1, `workers=${v.gen?.workers}`);
  ok('worker == main-thread heights (exact)', v.gen?.verify?.heightDiff === 0, `diff=${v.gen?.verify?.heightDiff}`);
  ok('worker == main-thread biomes (exact)', v.gen?.verify?.biomeDiff === 0, `diff=${v.gen?.verify?.biomeDiff}`);
  ok('no errors (verify)', v.errors.length === 0, v.errors.slice(0, 3).join(' | '));
  await v.ctx.close();

  const m = await load('gen=main');
  ok('main-thread fallback flag', m.gen?.mode === 'main');
  ok('terrain identical worker vs main', m.heights.length === v.heights.length && m.heights.every((h, i) => h === v.heights[i]), `n=${m.heights.length}`);
  await m.ctx.close();

  const d = await load('');
  console.log('default', JSON.stringify({ gen: d.gen, loadMs: d.loadMs }));
  ok('default uses worker', d.gen?.mode === 'worker');
  // touch: tap to walk still works on the iPad viewport
  const p = d.page;
  await p.evaluate(() => { const g = window.game; g.player.teleport(1.5, 8, 2.4); g.play.walk.cancel(); g.rig.pitch = 0.5; for (let i = 0; i < 20; i++) g.step(1 / 30); g.play.walk.cancel(); });
  await p.waitForTimeout(300);
  const done0 = await p.evaluate(() => window.game.play.walk.stats.done);
  await p.touchscreen.tap(1024 * 0.42, 768 * 0.3);
  const tap = await p.evaluate((d0) => { const g = window.game; g.step(1 / 30); return { walking: !!g.play.walk.goal || g.play.walk.stats.done > d0, outcome: g.play.lastTap }; }, done0);
  ok('ipad: tap on the ground walks', tap.walking, JSON.stringify(tap));
  await p.waitForTimeout(1500);
  await p.screenshot({ path: 'screenshots/order39a-gen-worker.png', timeout: 90_000 }).catch((e) => console.log('screenshot skipped (slow box):', e.message.split('\n')[0]));
  ok('no errors (default)', d.errors.length === 0, d.errors.slice(0, 3).join(' | '));
  await d.ctx.close();
} catch (e) { console.error(e); pass = false; }
clearTimeout(kill);
await browser.close();
console.log(pass ? 'ALL PASS' : 'SOME FAILED');
process.exit(pass ? 0 : 1);
