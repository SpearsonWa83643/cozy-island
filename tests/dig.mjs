// Digging test: F digs a hole (mound + dirt), rock/water refuse, finds go to the bag, digging at the map X digs up the chest,
// holes heal; iPad Dig button. Screenshots 32-34. Usage: node tests/dig.mjs [baseUrl] [--skip-ipad]
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
const wait = (page, ms) => page.waitForTimeout(ms);
const sim = (page, sec) => page.evaluate((s) => { const g = window.game; for (let t = 0; t < s; t += 1 / 30) g.step(1 / 30); }, sec);
// stand at (x,z) facing +x, camera framing the spot in front
const standAt = (page, x, z) => page.evaluate(([x, z]) => {
  const g = window.game; g.player.teleport(x, z, Math.PI / 2); for (let i = 0; i < 8; i++) g.step(1 / 30);
  g.rig.yaw = -0.6; g.rig.pitch = 0.55; g.rig.distance = 5.5; g.rig.target.copy(g.player.position).add({ x: 0.6, y: 0.8, z: 0 }); g.rig.apply();
}, [x, z]);
const press = (page, k) => page.keyboard.press(k);

if (!process.argv.includes('--skip-desktop')) {
  const { ctx, page, errors } = await open({ viewport: { width: 1280, height: 720 } }, 'high');
  await page.evaluate(() => { window.game.play.treasure.state; });
  await standAt(page, 3, 8);
  const h0 = await page.evaluate(() => window.game.play.digger.liveHoles);
  await press(page, 'f'); await wait(page, 250); await shot(page, '32-dig-dirt');
  await wait(page, 700);
  const r1 = await page.evaluate(() => ({ holes: window.game.play.digger.liveHoles, digs: window.game.play.save.data.digs, find: window.game.play.lastFind }));
  ok('F digs a hole in the meadow', r1.holes === h0 + 1 && r1.digs === 1, JSON.stringify(r1));
  await press(page, 'f'); await wait(page, 700);
  const r2 = await page.evaluate(() => window.game.play.digger.liveHoles);
  ok('same spot twice is refused', r2 === r1.holes);
  await shot(page, '33-dig-hole');
  // keep digging at fresh spots until something turns up
  const found = await page.evaluate(async () => {
    const g = window.game, P = g.play; const before = JSON.stringify(P.save.data.food); const sh0 = P.save.data.shells;
    for (let i = 0; i < 30; i++) {
      g.player.teleport(-2 + (i % 6) * 1.6, 2 + Math.floor(i / 6) * 1.6, Math.PI / 2); for (let k = 0; k < 4; k++) g.step(1 / 30);
      P.lockMove = 0; P.digCool = 0; P.lastFind = null;
      if (!P.shovel()) continue;
      await new Promise((r) => setTimeout(r, 560));
      for (let k = 0; k < 25; k++) g.step(1 / 30);
      if (P.lastFind && P.lastFind !== 'nothing') return { find: P.lastFind, i, changed: JSON.stringify(P.save.data.food) !== before || P.save.data.shells !== sh0 || !!P.save.data.owned[P.lastFind] };
    }
    return { find: null };
  });
  ok('digging finds something (bag / shells / wardrobe updated)', !!found.find && found.changed, JSON.stringify(found));
  await standAt(page, 3.2, 9.5); await press(page, 'f'); await wait(page, 600); await shot(page, '34-dig-find');
  // rock + water refuse
  const refuse = await page.evaluate(() => {
    const g = window.game, P = g.play; let rock = null;
    for (let x = -60; x < 60 && !rock; x += 1.5) for (let z = -60; z < 60; z += 1.5) { const c = P.digger.check(x, z, () => false); if (!c.ok && /rocky/.test(c.why) && g.heightAt(x, z) > 1) { rock = { x, z }; break; } }
    const h = P.digger.liveHoles;
    g.player.teleport(rock.x - 0.75, rock.z, Math.PI / 2); for (let k = 0; k < 4; k++) g.step(1 / 30);
    g.player.facing = Math.PI / 2; P.lockMove = 0; P.digCool = 0;
    // re-aim exactly at the rock cell
    const p = g.player.position; const a = Math.atan2(rock.x - p.x, rock.z - p.z); g.player.facing = a;
    const rockOk = P.shovel();
    return { rock, rockOk, holes: P.digger.liveHoles === h, water: P.digger.check(0, 120, () => false) };
  });
  ok('rock refuses digging', refuse.rockOk === false && refuse.holes, JSON.stringify(refuse.rock));
  ok('water is not diggable', refuse.water.ok === false);
  // treasure X: digging there finds the chest
  const tr = await page.evaluate(async () => {
    const g = window.game, P = g.play, tr = P.treasure;
    // walk the normal path: take the bottle (gives the first map)
    if (tr.state === 'bottle') { g.player.teleport(tr.bottlePos.x + 1, tr.bottlePos.z); for (let k = 0; k < 6; k++) g.step(1 / 30); P.target = P.findTarget(g.player.position); P.act(); for (let k = 0; k < 90; k++) g.step(1 / 30); }
    if (tr.state !== 'active') return { state: tr.state };
    const s = tr.spot; g.player.teleport(s.x - 1.0, s.z); for (let k = 0; k < 6; k++) g.step(1 / 30);
    const p = g.player.position; g.player.facing = Math.atan2(s.x - p.x, s.z - p.z); P.lockMove = 0; P.digCool = 0;
    const did = P.shovel();
    for (let k = 0; k < 120; k++) g.step(1 / 30);
    return { did, state: tr.state };
  });
  ok('digging at the map X digs up the chest', tr.did && (tr.state === 'dug' || tr.state === 'open'), JSON.stringify(tr));
  // holes heal
  const heal = await page.evaluate(() => { const g = window.game, P = g.play, n = P.digger.liveHoles; for (let k = 0; k < 100; k++) P.digger.update(1); return { n, after: P.digger.liveHoles }; });
  ok('holes heal over time', heal.n > 0 && heal.after === 0, JSON.stringify(heal));
  ok('desktop: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}
if (!process.argv.includes('--skip-ipad')) {
  const { ctx, page, errors } = await open({ ...devices['iPad Pro 11'], hasTouch: true }, 'low');
  await standAt(page, 3, 8);
  const btn = await page.locator('.tbtn.dig').boundingBox();
  ok('iPad: Dig button shown', !!btn && btn.width >= 60);
  await page.touchscreen.tap(btn.x + btn.width / 2, btn.y + btn.height / 2); await page.waitForFunction(() => window.game.play.digger.liveHoles > 0, null, { timeout: 5000 }).catch(() => {});
  const r = await page.evaluate(() => ({ holes: window.game.play.digger.liveHoles, held: window.game.input.keys.has('f'), digs: window.game.play.save.data.digs ?? 0 }));
  ok('iPad: Dig button digs (and releases)', r.holes === 1 && !r.held, JSON.stringify(r));
  await shot(page, '35-ipad-dig');
  ok('iPad: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}
await browser.close();
const f = results.filter((r) => !r).length; console.log(`\n${results.length - f}/${results.length} passed`); process.exit(f ? 1 : 0);
