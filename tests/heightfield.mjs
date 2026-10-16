// Terrain heightfield collider check (Order 19): Rapier ground matches the visual terrain, player stands on it.
// Usage: node tests/heightfield.mjs [baseUrl]   (default http://localhost:4181/cozy-island/)
import { chromium, devices } from 'playwright';

const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const kill = setTimeout(() => { console.error('TIMEOUT 175s'); browser.close().finally(() => process.exit(1)); }, 175_000);
let code = 1;
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n} ${x}`); return !!c; };
const probe = () => {
  const g = window.game, R = g.physics.R, w = g.physics.world;
  let maxErr = 0, n = 0, miss = 0;
  for (let i = 0; i < 60; i++) {
    const x = Math.sin(i * 12.9898) * 70, z = Math.cos(i * 78.233) * 70 + (i % 7) * 1.37;
    const o = g.player.position.clone().set(x, 40, z);
    const vis = g.terrain.raycast(o, o.clone().set(0, -1, 0), 120);
    const hit = w.castRay(new R.Ray({ x, y: 40, z }, { x: 0, y: -1, z: 0 }), 120, true, undefined, undefined, undefined, g.player.body);
    if (!vis) continue;
    if (!hit) { miss++; continue; }
    const y = 40 - hit.timeOfImpact;
    if (y > vis.y + 0.05) continue; // hit a tree/rock/building above ground: not terrain
    maxErr = Math.max(maxErr, Math.abs(y - vis.y)); n++;
  }
  const p = g.player.position;
  return { maxErr, n, miss, feet: p.y, ground: g.terrain.raycast(p.clone().setY(p.y + 5), p.clone().set(0, -1, 0), 20)?.y ?? null, marks: window.__loadTiming?.marks ?? {} };
};
try {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], deviceScaleFactor: 1, viewport: { width: 1024, height: 768 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}?webgl&q=low&nonews&nosw&debug`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.game?.ready === true, undefined, { timeout: 150_000 });
  await page.waitForTimeout(1500); // let the player settle
  const r = await page.evaluate(probe);
  const shape = await page.evaluate(() => { let t = null; window.game.physics.world.forEachCollider((c) => { if (c.shape.type === 17 || c.heightfieldNRows?.() > 0) t = c.heightfieldNRows(); }); return t; });
  console.log(JSON.stringify({ ...r, marks: undefined, terrainToWater: (r.marks.water - r.marks.terrain).toFixed(0) + 'ms', hfRows: shape }));
  const res = [
    ok('heightfield collider present', shape === 200, `(${shape})`),
    ok('collider matches visual terrain', r.n >= 20 && r.maxErr < 0.15 && r.miss === 0, `(max ${r.maxErr.toFixed(3)} m over ${r.n} pts, miss ${r.miss})`),
    ok('player stands on the ground', r.ground !== null && Math.abs(r.feet - r.ground) < 0.6, `(feet ${r.feet.toFixed(2)} ground ${r.ground?.toFixed(2)})`),
    ok('no pageerror', errors.length === 0, errors.slice(0, 2).join('; ')),
  ];
  code = res.every(Boolean) ? 0 : 1;
} catch (e) { console.error(e); } finally {
  clearTimeout(kill);
  try { await browser.close(); } catch { /* */ }
  process.exit(code);
}
