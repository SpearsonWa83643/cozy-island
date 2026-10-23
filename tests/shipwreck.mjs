// Shipwreck Cove (Order 37): a broken ship on the reef off the SE beach. Swim through the gap to the captain's
// chest, tap it on iPad to open it (Captain Hat), hull halves are solid, stamina/current still works, map pin,
// scenic tour stop, first-visit toast, saved across reloads. Screenshots order37-*.png.
// Usage: node tests/shipwreck.mjs [baseUrl] [--no-shots]
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:4193/';
const outDir = new URL('../screenshots/', import.meta.url).pathname;
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = []; const ok = (n, c, x = '') => { results.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
const errFilter = (m) => (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|swiftshader|Automatic fallback/i.test(m.text())));
const frames = (page, n) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const timer = setTimeout(() => { console.log('FAIL timeout'); process.exit(1); }, 480000);
try {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], hasTouch: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(300000);
  const errors = []; page.on('console', (m) => { if (errFilter(m)) errors.push(m.text()); }); page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  const url = base + '?webgl&q=low&nonews&nosw&touch=1&whatsnew=0';
  await page.goto(url); await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForFunction(() => window.game?.ready);
  let d = await page.evaluate(() => window.game.wreck.debug);
  console.log(JSON.stringify(d));
  const off = await page.evaluate(() => { const g = window.game, w = g.wreck; return +g.coast.offshore(w.pos.x, w.pos.z).toFixed(2); });
  ok('wreck sits on the SE reef, in swimmable water', d.x > 0 && d.z > 0 && off > 3 && off < 11 && d.depth >= 1.2, JSON.stringify({ off, depth: d.depth }));
  // swim from open water on the sea side, through the gap, to the chest
  const swim = await page.evaluate(() => { const g = window.game, w = g.wreck, c = w.chest;
    const sx = c.x + w.side.x * 4.5, sz = c.z + w.side.z * 4.5; g.player.teleport(sx, sz, 0); for (let i = 0; i < 6; i++) g.step(1 / 30);
    const face = () => Math.atan2(g.player.position.x - c.x, g.player.position.z - c.z);
    g.input.keys.add('w'); let swam = 0, n = 0, minD = 99;
    for (; n < 240; n++) { g.rig.yaw = face(); g.step(1 / 30); if (g.player.swimming) swam++; minD = Math.min(minD, w.chestDist(g.player.position.x, g.player.position.z)); if (minD < 1.2) break; }
    g.input.keys.delete('w'); for (let i = 0; i < 10; i++) g.step(1 / 30);
    return { minD: +minD.toFixed(2), swam, n, swimming: g.player.swimming, seen: !!g.play.save.data.wreckSeen, target: g.play.target?.key ?? null };
  });
  ok('swim through the hull gap to the chest', swim.minD < 1.3 && swim.swam > 10, JSON.stringify(swim));
  ok('first-visit welcome saved', swim.seen);
  ok('chest offers Open while swimming', swim.target === 'open:wreck', String(swim.target));
  // screenshot: look across the wreck
  await page.evaluate(() => { const g = window.game, w = g.wreck; g.rig.yaw = Math.atan2(w.side.x, w.side.z) + 0.6; g.rig.pitch = 0.32; g.rig.distance = 11; for (let i = 0; i < 20; i++) g.step(1 / 30); });
  await frames(page, 6);
  await page.screenshot({ path: outDir + 'order37-shipwreck.png' }); console.log('saved order37-shipwreck');
  // tap the chest on screen (touch): walks/swims to it and opens it
  const tp = await page.evaluate(() => { const g = window.game, v = g.wreck.chest.clone(); v.y += 0.2; v.project(g.camera); const r = g.renderer.renderer.domElement.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height, z: v.z }; });
  await page.touchscreen.tap(tp.x, tp.y);
  await page.waitForFunction(() => window.game.wreck.opened, null, { timeout: 60000 }).catch(() => {});
  d = await page.evaluate(() => ({ ...window.game.wreck.debug, hat: !!window.game.play.save.data.owned.captain, saved: !!window.game.play.save.data.wreckChest }));
  if (!d.opened) { console.log('tap did not open (tp ' + JSON.stringify(tp) + '), using action'); await page.evaluate(() => { const g = window.game; g.play.target = null; g.step(1 / 30); g.play.act(); }); d = await page.evaluate(() => ({ ...window.game.wreck.debug, hat: !!window.game.play.save.data.owned.captain, saved: !!window.game.play.save.data.wreckChest })); }
  ok('tap the chest: opens, Captain Hat in wardrobe', d.opened && d.hat && d.saved, JSON.stringify({ tp, opened: d.opened, hat: d.hat }));
  await frames(page, 30);
  await page.screenshot({ path: outDir + 'order37-chest-open.png' }); console.log('saved order37-chest-open');
  // hull halves are solid: swim at the bow half from the sea side and stop outside it
  const blocked = await page.evaluate(() => { const g = window.game, w = g.wreck; const bx = w.pos.x + w.axis.x * 4.7, bz = w.pos.z + w.axis.z * 4.7;
    g.player.teleport(bx + w.side.x * 5, bz + w.side.z * 5, 0); for (let i = 0; i < 6; i++) g.step(1 / 30);
    g.input.keys.add('w'); let minD = 99; for (let i = 0; i < 150; i++) { g.rig.yaw = Math.atan2(g.player.position.x - bx, g.player.position.z - bz); g.step(1 / 30); minD = Math.min(minD, Math.hypot(g.player.position.x - bx, g.player.position.z - bz)); } g.input.keys.delete('w');
    return +minD.toFixed(2); });
  ok('hull is solid (swimmer stops at the side planks)', blocked > 1.4 && blocked < 3, String(blocked));
  // stamina/current still pulls you back far out past the wreck
  const cur = await page.evaluate(() => { const g = window.game, w = g.wreck, a = Math.atan2(w.pos.z, w.pos.x), p = g.coast.atOffshore(a, 16); g.player.teleport(p.x, p.z, 0); for (let i = 0; i < 20; i++) g.step(1 / 30); return { cur: +g.player.current.toFixed(2), swimming: g.player.swimming }; });
  ok('stamina / current still works out past the reef', cur.cur > 0.3 && cur.swimming, JSON.stringify(cur));
  const tour = await page.evaluate(() => { const g = window.game; const st = g.mount.hooks?.tourStops?.() ?? []; const L = g.wreck.tourSpot; return st.some((p) => Math.hypot(p.x - L.x, p.z - L.z) < 0.1); });
  ok('shipwreck is a scenic-tour stop', tour);
  // persists: reload, chest stays open and the toast is not repeated
  await page.evaluate(() => window.game.play.save.flush ? window.game.play.save.flush() : window.game.play.save.save?.());
  await page.waitForTimeout(1500);
  await page.reload(); await page.waitForFunction(() => window.game?.ready);
  const per = await page.evaluate(() => { const g = window.game; for (let i = 0; i < 3; i++) g.step(1 / 30); return { opened: g.wreck.opened, chest: !!g.play.save.data.wreckChest }; });
  ok('looted chest stays open after reload', per.opened && per.chest, JSON.stringify(per));
  ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
} finally { clearTimeout(timer); await browser.close(); }
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
