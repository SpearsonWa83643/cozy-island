// Bigger island + cave: walk (tap-walk) into the arch → underground, camera stays inside, collect a cave item,
// feed the mole, walk back out. iPad Low perf inside/outside. Screenshots 36-40. Usage: node tests/cave.mjs [baseUrl] [--skip-ipad]
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const outDir = new URL('../screenshots/', import.meta.url).pathname; fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const __closeBrowser = async (code) => { try { await browser.close(); } catch { /* ignore */ } process.exit(code); };
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => __closeBrowser(130));
process.on('uncaughtException', (e) => { console.error(e); __closeBrowser(1); });
process.on('unhandledRejection', (e) => { console.error(e); __closeBrowser(1); });
const results = []; const ok = (n, c, x = '') => { results.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
const errFilter = (m) => (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|swiftshader|Automatic fallback/i.test(m.text())));
async function open(opts, q) {
  const ctx = await browser.newContext(opts); const page = await ctx.newPage(); page.setDefaultTimeout(300000);
  const errors = []; page.on('console', (m) => { if (errFilter(m)) errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + `?webgl&q=${q}`); await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForFunction(() => window.game?.ready);
  return { ctx, page, errors };
}
const frames = (page, n) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const shot = async (page, n) => { await frames(page, 3); await page.screenshot({ path: outDir + n + '.png' }); console.log('saved', n); };
const sim = (page, sec) => page.evaluate((s) => { const g = window.game; for (let t = 0; t < s; t += 1 / 30) g.step(1 / 30); }, sec);
const perf = (page) => page.evaluate(() => {
  const g = window.game, r = g.renderer.renderer, ts = [];
  for (let i = 0; i < 12; i++) { const t0 = performance.now(); g.step(1 / 30); r.render(g.scene, g.camera); ts.push(performance.now() - t0); }
  ts.sort((a, b) => a - b); const info = r.info.render;
  return { medianMs: +ts[6].toFixed(1), drawCalls: Math.round((info.drawCalls ?? info.calls) / 12), triangles: Math.round(info.triangles / 12) };
});
// walk up to the arch with tap-to-walk-style steering (the door triggers on arrival)
const enter = async (page) => {
  await page.evaluate(() => { const g = window.game, c = g.cave, o = c.outsideSpot; g.player.teleport(o.x, o.z, o.facing + Math.PI); for (let i = 0; i < 6; i++) g.step(1 / 30);
    g.rig.yaw = o.facing + 0.5; g.rig.pitch = 0.35; g.rig.distance = 9; g.rig.target.copy(g.player.position).add({ x: 0, y: 1.1, z: 0 }); g.rig.apply(); });
};
const walkIn = (page) => page.evaluate(async () => {
  const g = window.game, c = g.cave; g.play.walk.go({ pos: () => c.doorPt, reach: 0.4, key: '' });
  for (let i = 0; i < 300 && !c.inside; i++) { g.step(1 / 30); if (i % 30 === 0) await new Promise((r) => setTimeout(r, 30)); }
  await new Promise((r) => setTimeout(r, 700)); for (let i = 0; i < 20; i++) g.step(1 / 30);
  return { inside: c.inside, terrainHidden: !g.terrain.mesh.visible, interior: c.interior.visible, y: g.player.position.y };
});

if (!process.argv.includes('--skip-desktop')) {
  const { ctx, page, errors } = await open({ viewport: { width: 1280, height: 720 } }, 'high');
  const isl = await page.evaluate(() => ({ r: Array.from({ length: 36 }, (_, i) => window.game.coast.shoreRadius(i / 36 * Math.PI * 2)).reduce((a, b) => a + b) / 36, mouth: window.game.cave.mouth.toArray().map((v) => +v.toFixed(1)), dir: window.game.cave.dir.toArray().map((v) => +v.toFixed(2)) }));
  ok('island is bigger (mean shore radius, was ~41.5 m)', isl.r > 45, JSON.stringify(isl));
  // overview
  await page.evaluate(() => { const g = window.game; g.player.teleport(0, 4); g.step(1 / 30); g.rig.yaw = 0.6; g.rig.pitch = 0.95; g.rig.distance = 28; g.rig.target.set(0, 2, 0); g.rig.apply(); g.rig.locked = true; });
  await page.evaluate(() => { const g = window.game; g.camera.position.set(70, 75, 85); g.camera.lookAt(0, 0, 0); });
  await shot(page, '36-bigger-island');
  await page.evaluate(() => { window.game.rig.locked = false; });
  await enter(page); await frames(page, 2); await shot(page, '37-cave-entrance');
  const r = await walkIn(page);
  ok('walking into the arch enters the cave', r.inside && r.terrainHidden && r.interior && r.y < -40, JSON.stringify(r));
  // camera stays under the ceiling and inside
  const cam = await page.evaluate(() => { const g = window.game, c = g.cave, p = g.camera.position; g.rig.distance = 20; g.rig.pitch = 1.2; for (let i = 0; i < 10; i++) g.step(1 / 30); return { y: p.y, ceil: c.ceilAt(p.x, p.z), floor: c.floorAt(p.x, p.z), shape: c.shapeAt(p.x, p.z) }; });
  ok('camera stays inside the cave (below ceiling, above floor)', cam.y < cam.ceil && cam.y > cam.floor && cam.shape < 0.9, JSON.stringify(cam));
  await page.evaluate(() => { const g = window.game; g.rig.distance = 6; g.rig.pitch = 0.3; for (let i = 0; i < 10; i++) g.step(1 / 30); });
  await shot(page, '38-cave-interior');
  // collect a crystal: tap-walk to it, auto-pick
  const pick = await page.evaluate(async () => {
    const g = window.game, P = g.play, it = P.forage.items.find((i) => i.id === 'crystal' && i.active);
    g.player.teleport(it.x - 2.5, it.z); for (let i = 0; i < 6; i++) g.step(1 / 30);
    const n0 = P.save.data.food.crystal ?? 0;
    P.walk.go({ pos: () => it, reach: 0.9, key: 'pick:crystal', arrive: () => { const t = P.findTarget(g.player.position); if (t && t.key === 'pick:crystal') { P.target = t; P.act(); } } });
    for (let i = 0; i < 150 && P.walk.active; i++) g.step(1 / 30);
    g.rig.yaw = -Math.PI / 2 + 0.6; g.rig.pitch = 0.35; g.rig.distance = 5;
    return { n0, n1: P.save.data.food.crystal ?? 0 };
  });
  ok('collect a cave crystal', pick.n1 === pick.n0 + 1, JSON.stringify(pick));
  await shot(page, '39-cave-crystals');
  // geode → first one always holds a cave wearable
  const geo = await page.evaluate(async () => {
    const g = window.game, P = g.play, it = P.forage.items.find((i) => i.id === 'geode' && i.active);
    g.player.teleport(it.x - 0.8, it.z); for (let i = 0; i < 6; i++) g.step(1 / 30);
    P.target = P.findTarget(g.player.position); const key = P.target?.key; P.act();
    await new Promise((r) => setTimeout(r, 600));
    return { key, owned: !!P.save.data.owned.crystalneck };
  });
  ok('first geode gives the Crystal Pendant', geo.key === 'pick:geode' && geo.owned, JSON.stringify(geo));
  // mole: feed a worm → miner helmet
  const mole = await page.evaluate(async () => {
    const g = window.game, P = g.play, mo = g.cave.mole; P.save.data.food.worm = 2;
    g.player.teleport(mo.x - 1.6, mo.z, Math.PI / 2); for (let i = 0; i < 40; i++) g.step(1 / 30);
    g.rig.yaw = -Math.PI / 2 - 0.5; g.rig.pitch = 0.3; g.rig.distance = 4.5;
    P.target = P.findTarget(g.player.position); const t = { key: P.target?.key, label: P.target?.label }; P.act();
    await new Promise((r) => setTimeout(r, 650)); for (let i = 0; i < 4; i++) g.step(1 / 30);
    return { ...t, worms: P.save.data.food.worm, helmet: !!P.save.data.owned.minerhelmet };
  });
  ok('feed the mole a worm → Miner Helmet', mole.key === 'feed:mole:worm' && mole.worms === 1 && mole.helmet, JSON.stringify(mole));
  await page.evaluate(() => { const P = window.game.play; P.equip('hat', 'minerhelmet'); });
  await shot(page, '40-cave-mole-helmet');
  // walk back out through the tunnel
  const out = await page.evaluate(async () => {
    const g = window.game, c = g.cave, e = c.entry; g.player.teleport(e.x + 1, e.z); for (let i = 0; i < 70; i++) g.step(1 / 30);
    g.play.walk.go({ pos: () => c.exitPt, reach: 0.3, key: '' });
    for (let i = 0; i < 300 && c.inside; i++) { g.step(1 / 30); if (i % 30 === 0) await new Promise((r) => setTimeout(r, 30)); }
    await new Promise((r) => setTimeout(r, 700)); for (let i = 0; i < 10; i++) g.step(1 / 30);
    const p = g.player.position; return { inside: c.inside, terrain: g.terrain.mesh.visible, y: +p.y.toFixed(2), ground: +g.heightAt(p.x, p.z).toFixed(2) };
  });
  ok('walk back out to the hillside', !out.inside && out.terrain && Math.abs(out.y - out.ground) < 0.6, JSON.stringify(out));
  ok('desktop: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}
if (!process.argv.includes('--skip-ipad')) {
  const { ctx, page, errors } = await open({ ...devices['iPad Pro 11'], hasTouch: true }, 'low');
  await enter(page);
  const pOut = await perf(page);
  const r = await walkIn(page);
  ok('iPad: enters the cave', r.inside);
  await page.evaluate(() => { const g = window.game; g.rig.distance = 6; g.rig.pitch = 0.35; for (let i = 0; i < 10; i++) g.step(1 / 30); });
  const pIn = await perf(page);
  console.log('perf outside', pOut, 'inside', pIn);
  ok('iPad Low: cave interior is cheap', pIn.drawCalls < pOut.drawCalls * 0.7 && pIn.triangles < pOut.triangles * 0.6, JSON.stringify({ pIn, pOut }));
  await shot(page, '41-ipad-cave');
  ok('iPad: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}
await browser.close();
const f = results.filter((r) => !r).length; console.log(`\n${results.length - f}/${results.length} passed`); process.exit(f ? 1 : 0);
