// Terrain streaming (Order 39b) + memory cap (Order 39c): with a small test radius, tiles load near the
// camera and unload when it moves away; the cap bounds loaded tiles; default radius keeps the whole island.
// Usage: node tests/terrain-stream.mjs [baseUrl]
import { chromium, devices } from 'playwright';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const kill = setTimeout(() => { console.error('TIMEOUT 700s'); browser.close().finally(() => process.exit(1)); }, 700_000);
let pass = true;
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n} ${x}`); if (!c) pass = false; };
async function load(q) {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], deviceScaleFactor: 1, viewport: { width: 1024, height: 768 } });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${base}?webgl&q=low&nonews&nosw&${q}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.game?.ready === true, undefined, { timeout: 240_000 });
  return { ctx, page, errors };
}
try {
  const d = await load('');
  const s0 = await d.page.evaluate(() => ({ ...window.game.terrain.stats, total: window.game.terrain.chunks.length }));
  console.log('default', JSON.stringify(s0));
  ok('default: whole island loaded', s0.loaded === s0.total && s0.unloads === 0);
  ok('no errors (default)', d.errors.length === 0, d.errors.slice(0, 3).join(' | '));
  await d.ctx.close();

  const t = await load('stream=20&tilecap=3');
  const r = await t.page.evaluate(() => {
    const g = window.game, T = g.terrain; const out = {};
    out.start = { ...T.stats };
    // fly the stream point to each corner (budget 1/frame → step several times)
    const visit = (x, z) => { for (let k = 0; k < 12; k++) T.stream(x, z); return T.chunks.filter((c) => c.loaded).map((c) => c.mesh.name); };
    out.ne = visit(90, -90); out.sw = visit(-90, 90); out.c = visit(0, 0);
    out.end = { ...T.stats };
    out.maxLoaded = T.stats.peak;
    return out;
  });
  console.log('stream', JSON.stringify(r));
  ok('small radius: only near tiles at spawn', r.start.loaded < 9, `loaded=${r.start.loaded}`);
  ok('NE corner tile streams in', r.ne.includes('terrain-2-0'), r.ne.join(','));
  ok('SW corner: NE tile unloaded', !r.sw.includes('terrain-2-0') && r.sw.includes('terrain-0-2'), r.sw.join(','));
  ok('memory cap holds (peak <= cap)', r.maxLoaded <= 3 && r.end.loaded <= 3, `peak=${r.maxLoaded}`);
  ok('loads + unloads happened', r.end.loads > r.start.loads && r.end.unloads > 0, `loads=${r.end.loads} unloads=${r.end.unloads} evict=${r.end.evictions}`);
  // touch still works with streaming: tap walks
  const p = t.page;
  await p.evaluate(() => { const g = window.game; g.player.teleport(1.5, 8, 2.4); g.play.walk.cancel(); g.rig.pitch = 0.5; for (let i = 0; i < 20; i++) g.step(1 / 30); g.play.walk.cancel(); });
  await p.waitForTimeout(300);
  const done0 = await p.evaluate(() => window.game.play.walk.stats.done);
  await p.touchscreen.tap(1024 * 0.42, 768 * 0.3);
  const tap = await p.evaluate((d0) => { const g = window.game; g.step(1 / 30); return { walking: !!g.play.walk.goal || g.play.walk.stats.done > d0, outcome: g.play.lastTap, ground: g.terrain.chunks.filter((c) => c.loaded).length }; }, done0);
  ok('ipad: tap walks with streamed terrain', tap.walking, JSON.stringify(tap));
  ok('no errors (stream)', t.errors.length === 0, t.errors.slice(0, 3).join(' | '));
  await t.ctx.close();

  // cap pressure: cap 1, crossing a tile border → the tile under the camera wins, the other is evicted, no thrash
  const c = await load('stream=20&tilecap=1');
  const cr = await c.page.evaluate(() => {
    const T = window.game.terrain; const names = () => T.chunks.filter((ch) => ch.loaded).map((ch) => ch.mesh.name);
    for (let k = 0; k < 6; k++) T.stream(0, 0); const a = names();
    for (let k = 0; k < 6; k++) T.stream(45, 0); const b = names(); const ev = T.stats.evictions;
    for (let k = 0; k < 20; k++) T.stream(45, 0); const loadsAfter = T.stats.loads;
    for (let k = 0; k < 20; k++) T.stream(45, 0);
    return { a, b, ev, stable: T.stats.loads === loadsAfter, peak: T.stats.peak };
  });
  console.log('cap', JSON.stringify(cr));
  ok('cap: centre tile at origin', cr.a.length === 1 && cr.a[0] === 'terrain-1-1', cr.a.join(','));
  ok('cap: tile under camera wins after crossing', cr.b.length === 1 && cr.b[0] === 'terrain-2-1' && cr.ev >= 1, `${cr.b.join(',')} evictions=${cr.ev}`);
  ok('cap: no thrash', cr.stable && cr.peak <= 1, `peak=${cr.peak}`);
  ok('no errors (cap)', c.errors.length === 0, c.errors.slice(0, 3).join(' | '));
  await c.ctx.close();
} catch (e) { console.error(e); pass = false; }
clearTimeout(kill); await browser.close();
console.log(pass ? 'ALL PASS' : 'SOME FAILED'); process.exit(pass ? 0 : 1);
