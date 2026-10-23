// Lighthouse Point (Order 31): placed on a NE headland on land, solid, path + lookout, sweeping beams brighter in
// Halloween/Winter, tap = foghorn + flash, lookout welcome, on the map + scenic tour. iPad touch viewport.
// Screenshot 80/81. Usage: node tests/lighthouse.mjs [baseUrl]
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const outDir = new URL('../screenshots/', import.meta.url).pathname;
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = []; const ok = (n, c, x = '') => { results.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
const errFilter = (m) => (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|swiftshader|Automatic fallback/i.test(m.text())));
const frames = (page, n) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
try {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11'], hasTouch: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(300000);
  const errors = []; page.on('console', (m) => { if (errFilter(m)) errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '?webgl&q=low&touch=1&theme=halloween'); await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForFunction(() => window.game?.ready);
  let d = await page.evaluate(() => window.game.lighthouse.debug);
  console.log(JSON.stringify(d));
  const r = Math.hypot(d.x, d.z);
  ok('lighthouse on NE land, above sea level', d.y > 1.5 && d.z < 0 && d.x > -10 && r > 25, JSON.stringify(d));
  ok('winding path + lookout', d.path >= 15 && Number.isFinite(d.lookout.x));
  ok('Halloween beam glows strong', d.base >= 0.4 && d.beam > 0.3, String(d.beam));
  const cleared = await page.evaluate(() => { const g = window.game, L = g.lighthouse; return g.flora.spots.filter((s) => Math.hypot(s.x - L.pos.x, s.z - L.pos.z) < 4.2).length; });
  ok('no plants on the headland', cleared === 0, String(cleared));
  // solid: walk into the tower from the inland side, player stops outside it
  const blocked = await page.evaluate(() => { const g = window.game, L = g.lighthouse, s = L.sea;
    const px = L.pos.x - s.x * 4, pz = L.pos.z - s.z * 4; g.player.teleport(px, pz, 0); for (let i = 0; i < 4; i++) g.step(1 / 30);
    g.rig.yaw = Math.atan2(px - L.pos.x, pz - L.pos.z); g.rig.apply?.();
    g.input.keys.add('w'); for (let i = 0; i < 90; i++) { g.rig.yaw = Math.atan2(g.player.position.x - L.pos.x, g.player.position.z - L.pos.z); g.step(1 / 30); } g.input.keys.delete('w');
    const p = g.player.position; return +Math.hypot(p.x - L.pos.x, p.z - L.pos.z).toFixed(2); });
  ok('tower is solid', blocked > 1.3 && blocked < 3, String(blocked));
  // lookout welcome
  const look = await page.evaluate(() => { const g = window.game, L = g.lighthouse.lookout, s = g.lighthouse.sea; g.player.teleport(L.x, L.z, Math.atan2(s.x, s.z)); for (let i = 0; i < 6; i++) g.step(1 / 30); return g.play.save.data.lookout === true; });
  ok('lookout visit saved', look);
  // frame the tower from the stepping-stone path and tap it
  await page.evaluate(() => { const g = window.game, L = g.lighthouse, st = L.path[Math.min(9, L.path.length - 1)];
    g.player.teleport(st.x, st.z, 0); for (let i = 0; i < 4; i++) g.step(1 / 30);
    const yaw = () => Math.atan2(g.player.position.x - L.pos.x, g.player.position.z - L.pos.z);
    g.rig.yaw = yaw(); g.rig.pitch = 0.2; g.rig.distance = 10; for (let i = 0; i < 20; i++) { g.rig.yaw = yaw(); g.step(1 / 30); } });
  await frames(page, 6);
  await page.screenshot({ path: outDir + '80-ipad-lighthouse-point.png' }); console.log('saved 80-ipad-lighthouse-point');
  const tp = await page.evaluate(() => { const g = window.game, L = g.lighthouse, v = L.pos.clone(); v.y += 4; v.project(g.camera); const r = g.renderer.renderer.domElement.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; });
  await page.touchscreen.tap(tp.x, tp.y); await frames(page, 10);
  d = await page.evaluate(() => window.game.lighthouse.debug);
  ok('tap the tower: foghorn + flash', d.reactions >= 1 && d.flashes >= 1 && d.beam > d.base + 0.08, JSON.stringify({ r: d.reactions, beam: d.beam, tp }));
  await page.screenshot({ path: outDir + '81-ipad-lighthouse-flash.png' }); console.log('saved 81-ipad-lighthouse-flash');
  // theme: Spring beam is subtle
  await page.evaluate(() => window.game.themes.set ? window.game.themes.set('spring') : null);
  await page.waitForTimeout(300); await frames(page, 90);
  d = await page.evaluate(() => window.game.lighthouse.debug);
  ok('Spring beam subtle', d.base <= 0.12, JSON.stringify(d.base));
  // scenic tour includes the lighthouse
  const tour = await page.evaluate(() => { const g = window.game; const st = g.mount.hooks?.tourStops?.() ?? []; const L = g.lighthouse.tourSpot; return st.some((p) => Math.hypot(p.x - L.x, p.z - L.z) < 0.1); });
  ok('lighthouse is a scenic-tour stop', tour);
  ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
} finally { await browser.close(); }
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
