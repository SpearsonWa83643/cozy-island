// Blossom Isle (Order 42a), iPad touch viewport: the generated islet ~250 m offshore is generated in the gen worker
// after load, streams in its terrain tiles, the water shader picks up its shallows, heightAt / physics work there
// (player stands on it, tap-to-walk works), its colliders drop when you leave, the swim current pushes back to the
// *islet* beach, and the flier leash lets a mount cross the channel. Timeout + browser closed in finally.
// Usage: node tests/islet.mjs [baseUrl] [--no-shots]
import { chromium, devices } from 'playwright';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4193/';
const kill = setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 420000);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = []; const ok = (n, c, x = '') => { results.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
const errFilter = (m) => (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|swiftshader|Automatic fallback/i.test(m.text())));
const shots = !process.argv.includes('--no-shots');
try {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], hasTouch: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(120000);
  const errors = []; page.on('console', (m) => { if (errFilter(m)) errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '?webgl&q=low&touch=1&whatsnew=0');
  await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => document.getElementById('whatsnew')?.querySelector('.w-ok')?.click());
  const step = (n) => page.evaluate((n) => { for (let i = 0; i < n; i++) window.game.step(1 / 60); }, n);
  const stats = () => page.evaluate(() => window.game.islets.stats[0]);

  // ---- nothing happens during the first-load settle
  const s0 = await stats();
  ok('islet idle during first-load settle', s0.state === 'idle' || (await page.evaluate(() => window.game.elapsed)) > 4, JSON.stringify(s0));

  // ---- generated in the worker, tiles streamed in
  await step(260);
  for (let i = 0; i < 60 && (await stats()).state !== 'ready'; i++) { await page.waitForTimeout(250); await step(2); }
  for (let i = 0; i < 20 && !(await page.evaluate(() => window.game.islets.ready)); i++) await step(2);
  const s1 = await stats();
  ok('islet generated in the gen worker (or baked tile, Order 48c)', s1.state === 'ready' && (s1.genMode === 'worker' || s1.genMode === 'baked'), JSON.stringify(s1));
  ok('islet tiles streamed in', s1.loaded === 4 && s1.bytes > 0, JSON.stringify(s1));

  // ---- shape: land in the middle, beach ring, open sea in the channel
  const shape = await page.evaluate(() => {
    const g = window.game, t = g, cx = 190, cz = -190; let land = 0, n = 0, minR = 99, maxR = 0;
    for (let a = 0; a < 64; a++) { const an = a / 64 * Math.PI * 2; let r = 0; while (r < 90 && t.heightAt(cx + Math.cos(an) * r, cz + Math.sin(an) * r) > 0) r += 0.5; minR = Math.min(minR, r); maxR = Math.max(maxR, r); }
    for (let x = -70; x <= 70; x += 5) for (let z = -70; z <= 70; z += 5) { n++; if (t.heightAt(cx + x, cz + z) > 0) land++; }
    return { centre: +t.heightAt(cx, cz).toFixed(2), channel: +t.heightAt(95, -95).toFixed(2), minR, maxR, land, n };
  });
  ok('islet centre is dry land', shape.centre > 1.5, JSON.stringify(shape));
  ok('islet ~120 m across (sand line radius 45-70 m)', shape.minR >= 40 && shape.maxR <= 75 && (shape.minR + shape.maxR) > 100, JSON.stringify(shape));
  ok('open sea in the channel', shape.channel < -1, JSON.stringify(shape));
  const dist = Math.hypot(190, 190) - shape.maxR - 57; // main shore ~57 m from origin
  ok('islet ~250 m offshore', dist > 120 && dist < 260, dist.toFixed(0));

  // ---- swimming off the islet: the current carries you back to *its* beach
  const swim = await page.evaluate(() => {
    const g = window.game, p = g.player; p.teleport(190 + 80, -190, 0);
    for (let i = 0; i < 90; i++) g.step(1 / 30);
    const d0 = Math.hypot(p.position.x - 190, p.position.z + 190);
    return { off: +p.offshoreDist.toFixed(1), d0: +d0.toFixed(1), swimming: p.swimming };
  });
  ok('swim current near the islet points to the islet', swim.d0 < 80 && swim.off < 30, JSON.stringify(swim));

  // ---- flier leash lets you cross the channel, swimmer leash doesn't
  const chan = await page.evaluate(() => { const c = window.game.coast; let mx = 0; for (let f = 0; f <= 1; f += 0.02) mx = Math.max(mx, c.nearestLand(190 * f, -190 * f).off); return +mx.toFixed(1); });
  ok('channel stays inside the flier leash (85 m)', chan < 85 && chan > 25, String(chan));

  // ---- stand on the islet: physics colliders active, player on the ground
  const stand = await page.evaluate(() => {
    const g = window.game, p = g.player; p.teleport(190 - 20, -190 + 10, 0);
    for (let i = 0; i < 120; i++) g.step(1 / 30);
    const h = g.heightAt(p.position.x, p.position.z);
    return { y: +p.position.y.toFixed(2), h: +h.toFixed(2), swimming: p.swimming, colliders: g.islets.stats[0].colliders };
  });
  ok('player stands on islet ground', !stand.swimming && Math.abs(stand.y - stand.h) < 0.6 && stand.h > 0, JSON.stringify(stand));
  ok('islet physics colliders active nearby', stand.colliders > 0, JSON.stringify(stand));

  // ---- tap-to-walk on the islet (touch)
  await page.evaluate(() => { window.game.rig.yaw = Math.PI * 0.25; window.game.rig.pitch = 0.45; }); await step(10);
  const p0 = await page.evaluate(() => ({ x: window.game.player.position.x, z: window.game.player.position.z }));
  const vp = page.viewportSize(); await page.touchscreen.tap(vp.width * 0.5, vp.height * 0.42);
  await page.waitForTimeout(200); await step(90);
  const tap = await page.evaluate((p0) => { const g = window.game, p = g.player.position; return { moved: +Math.hypot(p.x - p0.x, p.z - p0.z).toFixed(2), last: g.play.lastTap, h: +g.heightAt(p.x, p.z).toFixed(2) }; }, p0);
  ok('tap-to-walk works on the islet', tap.moved > 1 && tap.h > 0, JSON.stringify(tap));
  if (shots) { await page.evaluate(() => { const g = window.game; g.rig.yaw = -0.8; g.rig.pitch = 0.32; g.rig.distance = 18; }); await step(30); await page.waitForTimeout(600); await page.screenshot({ path: 'screenshots/order42a-blossom-isle.png' }).catch((e) => console.log('shot failed', e.message)); }

  // ---- leave: islet colliders drop, main island still solid
  const back = await page.evaluate(() => {
    const g = window.game, p = g.player; p.teleport(0, 8, 0);
    for (let i = 0; i < 90; i++) g.step(1 / 30);
    return { colliders: g.islets.stats[0].colliders, y: +p.position.y.toFixed(2), h: +g.heightAt(p.position.x, p.position.z).toFixed(2), swimming: p.swimming };
  });
  ok('islet colliders drop when you leave', back.colliders === 0, JSON.stringify(back));
  ok('main island still solid', !back.swimming && Math.abs(back.y - back.h) < 0.6, JSON.stringify(back));
  if (shots) { await page.evaluate(() => { const g = window.game; g.player.teleport(40, -40, 0); for (let i = 0; i < 30; i++) g.step(1 / 30); g.rig.yaw = -Math.PI * 0.25; g.rig.pitch = 0.2; g.rig.distance = 10; }); await step(30); await page.waitForTimeout(600); await page.screenshot({ path: 'screenshots/order42a-islet-from-shore.png' }).catch((e) => console.log('shot failed', e.message)); }

  ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) { ok('test ran', false, e.message); }
finally { clearTimeout(kill); await browser.close(); }
const pass = results.filter(Boolean).length; console.log(`${pass}/${results.length} passed`); process.exit(pass === results.length ? 0 : 1);
