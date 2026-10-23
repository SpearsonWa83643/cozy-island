// World config + bounds check (Order 29, Big island 1/7): terrain/water/shore/map all read one config, no regression.
// Usage: node tests/world-config.mjs [baseUrl]   (default http://localhost:4181/cozy-island/)
import { chromium, devices } from 'playwright';

const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const kill = setTimeout(() => { console.error('TIMEOUT 175s'); browser.close().finally(() => process.exit(1)); }, 175_000);
let code = 1;
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n} ${x}`); return !!c; };
try {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], deviceScaleFactor: 1, viewport: { width: 1024, height: 768 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}?webgl&q=low&nonews&nosw`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.game?.ready === true, undefined, { timeout: 150_000 });
  await page.waitForTimeout(1200);
  const r = await page.evaluate(() => {
    const g = window.game;
    const tb = g.terrain.mesh.geometry.boundingBox ?? (g.terrain.mesh.geometry.computeBoundingBox(), g.terrain.mesh.geometry.boundingBox);
    const wb = g.water.geometry.boundingBox ?? (g.water.geometry.computeBoundingBox(), g.water.geometry.boundingBox);
    const shore = [0, 1.5, 3, 4.5].map((a) => g.coast.shoreRadius(a));
    const p = g.player.position;
    return { terrainW: tb.max.x - tb.min.x, waterW: wb.max.x - wb.min.x, shore, px: p.x, pz: p.z, py: p.y, shadow: g.sun.shadow.camera.right };
  });
  console.log(JSON.stringify(r));
  await page.screenshot({ path: 'screenshots/order29-world-config.png' });
  const res = [
    ok('terrain extent = 196 m (unchanged)', Math.abs(r.terrainW - 196) < 0.01, `(${r.terrainW})`),
    ok('ocean extent = 1200 m (unchanged)', Math.abs(r.waterW - 1200) < 0.01, `(${r.waterW})`),
    ok('shoreline inside world bounds', r.shore.every((s) => s > 40 && s < 96), `(${r.shore.map((s) => s.toFixed(1)).join(', ')})`),
    ok('shadow frustum from config (low q)', r.shadow === 26, `(${r.shadow})`),
    ok('player spawned on island', Math.hypot(r.px, r.pz) < 60 && r.py > 0),
    ok('no pageerror', errors.length === 0, errors.slice(0, 2).join('; ')),
  ];
  code = res.every(Boolean) ? 0 : 1;
} catch (e) { console.error(e); } finally {
  clearTimeout(kill);
  try { await browser.close(); } catch { /* */ }
  process.exit(code);
}
