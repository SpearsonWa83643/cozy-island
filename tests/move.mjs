// iPad movement test: floating joystick on both sides (+ orbit with the other side), re-anchor past the rim,
// handedness persists, tap-to-walk to ground and to food (auto-pick), stick cancels tap-walk; desktop click-to-walk.
// Screenshots: screenshots/29-31-*.png. Usage: node tests/move.mjs [baseUrl] [--skip-desktop]
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const outDir = new URL('../screenshots/', import.meta.url).pathname;
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
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
const pos = (page) => page.evaluate(() => { const p = window.game.player.position; return { x: p.x, z: p.z }; });
const frameCam = (page, yaw, pitch, dist) => page.evaluate(([y, p, d]) => { const g = window.game; g.rig.yaw = y; g.rig.pitch = p; g.rig.distance = d; g.rig.target.copy(g.player.position).add({ x: 0, y: 1.1, z: 0 }); g.rig.apply(); }, [yaw, pitch, dist]);
const setup = (page) => page.evaluate(() => { const g = window.game; g.player.teleport(2, 9, Math.PI); for (let i = 0; i < 10; i++) g.step(1 / 30); g.rig.yaw = 0.3; g.rig.pitch = 0.5; g.rig.distance = 9; });

if (!process.argv.includes('--skip-ipad')) {
  const { ctx, page, errors } = await open({ ...devices['iPad Pro 11'], hasTouch: true }, 'low');
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: p.id ?? 1, radiusX: 4, radiusY: 4, force: 1 })) });
  const vw = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  await setup(page);
  // --- left-handed: stick on the left, orbit with the right
  await page.evaluate(() => { document.querySelector('.hand[data-h="left"]').click(); });
  const L = { x: vw.w * 0.25, y: vw.h * 0.7 };
  let a = await pos(page);
  await touch('touchStart', [L]); await touch('touchMove', [{ x: L.x + 4, y: L.y - 30 }]); await touch('touchMove', [{ x: L.x + 6, y: L.y - 60 }]);
  const ui1 = await page.evaluate(() => ({ ...window.game.input.stickUi, stick: { ...window.game.input.stick }, shown: document.querySelector('.fstick').classList.contains('show') }));
  ok('left: floating stick appears under the thumb', ui1.active && ui1.shown && Math.abs(ui1.ox - L.x) < 2 && Math.abs(ui1.oy - L.y) < 2, JSON.stringify(ui1));
  // second finger on the right orbits the camera while walking
  const yaw0 = await page.evaluate(() => window.game.rig.yaw);
  const R = { x: vw.w * 0.75, y: vw.h * 0.45, id: 2 };
  await touch('touchMove', [{ x: L.x + 6, y: L.y - 60 }, R]);
  for (let i = 1; i <= 5; i++) { await touch('touchMove', [{ x: L.x + 6, y: L.y - 60 }, { ...R, x: R.x + i * 25 }]); await page.evaluate(() => window.game.step(1 / 30)); }
  await sim(page, 1.2);
  let b = await pos(page);
  const yaw1 = await page.evaluate(() => window.game.rig.yaw);
  ok('left: stick walks the character', Math.hypot(b.x - a.x, b.z - a.z) > 2, `${Math.hypot(b.x - a.x, b.z - a.z).toFixed(2)} m`);
  ok('left: right-side drag orbits at the same time', Math.abs(yaw1 - yaw0) > 0.2, `yaw ${yaw0.toFixed(2)}→${yaw1.toFixed(2)}`);
  await touch('touchMove', [{ x: L.x + 6, y: L.y - 60 }]);
  await shot(page, '29-ipad-joystick-left');
  // drag past the rim: the base follows the thumb
  await touch('touchMove', [{ x: L.x + 6, y: L.y - 260 }]);
  const ui2 = await page.evaluate(() => ({ ...window.game.input.stickUi, stick: { ...window.game.input.stick } }));
  ok('left: base re-anchors when dragged past the rim', ui2.oy < L.y - 150 && Math.hypot(ui2.stick.x, ui2.stick.y) > 0.95, JSON.stringify(ui2));
  await touch('touchEnd', []);
  const rel = await page.evaluate(() => ({ ...window.game.input.stick, on: window.game.input.stickUi.on }));
  ok('left: release recentres', rel.x === 0 && rel.y === 0 && !rel.on);
  // --- right-handed
  await page.evaluate(() => { document.querySelector('.hand[data-h="right"]').click(); });
  await setup(page);
  a = await pos(page);
  const RR = { x: vw.w * 0.78, y: vw.h * 0.72 };
  await touch('touchStart', [RR]); await touch('touchMove', [{ x: RR.x - 5, y: RR.y - 40 }]); await touch('touchMove', [{ x: RR.x - 8, y: RR.y - 70 }]);
  await sim(page, 1.2);
  b = await pos(page);
  const ui3 = await page.evaluate(() => ({ ...window.game.input.stickUi }));
  ok('right: stick on the right side walks', ui3.active && Math.hypot(b.x - a.x, b.z - a.z) > 2, `${Math.hypot(b.x - a.x, b.z - a.z).toFixed(2)} m`);
  await shot(page, '30-ipad-joystick-right');
  await touch('touchEnd', []);
  // left-side single drag now orbits
  const y0 = await page.evaluate(() => window.game.rig.yaw);
  const LL = { x: vw.w * 0.3, y: vw.h * 0.6 };
  await touch('touchStart', [LL]);
  for (let i = 1; i <= 6; i++) { await touch('touchMove', [{ x: LL.x + i * 25, y: LL.y }]); await page.evaluate(() => window.game.step(1 / 30)); }
  await touch('touchEnd', []);
  const y1 = await page.evaluate(() => window.game.rig.yaw);
  ok('right: left-side drag orbits the camera', Math.abs(y1 - y0) > 0.2 && !(await page.evaluate(() => window.game.input.stickUi.active)), `yaw ${y0.toFixed(2)}→${y1.toFixed(2)}`);
  // handedness persists
  await page.reload(); await page.waitForFunction(() => window.game?.ready);
  const hand = await page.evaluate(() => ({ h: window.game.input.hand, on: document.querySelector('.hand.on')?.dataset.h }));
  ok('handedness persists after reload', hand.h === 'right' && hand.on === 'right', JSON.stringify(hand));
  // --- auto: lower part of either side is the stick
  await page.evaluate(() => { document.querySelector('.hand[data-h="auto"]').click(); });
  await setup(page);
  for (const x of [vw.w * 0.2, vw.w * 0.8]) {
    const P = { x, y: vw.h * 0.75 };
    await touch('touchStart', [P]); await touch('touchMove', [{ x: P.x, y: P.y - 50 }]);
    const act = await page.evaluate(() => window.game.input.stickUi.active);
    await touch('touchEnd', []);
    ok(`auto: stick under the thumb at x=${Math.round(x)}`, act);
  }
  // --- tap to walk: ground
  await setup(page); await frameCam(page, 0.3, 0.75, 10); await frames(page, 2);
  a = await pos(page);
  const tgt = { sx: vw.w * 0.62, sy: vw.h * 0.5 };
  await page.touchscreen.tap(tgt.sx, tgt.sy);
  const going = await page.evaluate(() => { const w = window.game.play.walk, p = w.goal?.pos(); return { active: w.active, marker: w.marker.visible, x: p?.x, z: p?.z }; });
  Object.assign(tgt, { x: going.x, z: going.z });
  await sim(page, 0.5); await frameCam(page, 0.3, 0.75, 10);
  await shot(page, '31-tap-walk-marker');
  await sim(page, 3);
  b = await pos(page);
  ok('tap ground: walks there with a marker', going.active && going.marker && Math.hypot(b.x - tgt.x, b.z - tgt.z) < 0.8, `${JSON.stringify(going)} end ${Math.hypot(b.x - tgt.x, b.z - tgt.z).toFixed(2)} m from target`);
  // --- tap food: walks and auto-picks
  const food = await page.evaluate(() => {
    const g = window.game, f = g.play.forage, me = g.player.position;
    const it = f.items.filter((i) => i.active && !['conch', 'seaglass', 'starfish', 'pearl'].includes(i.id) && i.y > 0.3).sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z))[0];
    g.player.teleport(it.x + 4.5, it.z + 2.5); for (let i = 0; i < 6; i++) g.step(1 / 30);
    g.rig.yaw = Math.atan2(4.5, 2.5) + 0.3; g.rig.pitch = 0.8; g.rig.distance = 9; g.rig.target.copy(g.player.position).add({ x: 0, y: 1.1, z: 0 }); g.rig.apply();
    window.__it = it; return { id: it.id, n: g.play.save.data.food[it.id] ?? 0 };
  });
  await frames(page, 2);
  const fs2 = await page.evaluate(() => { const it = window.__it, v = window.game.player.position.clone(); v.set(it.x, it.y + 0.15, it.z); return window.game.play.juice.project(v); });
  await page.touchscreen.tap(fs2.x, fs2.y);
  const goal = await page.evaluate(() => window.game.play.walk.goal?.key ?? null);
  await sim(page, 5);
  const after = await page.evaluate((id) => ({ n: window.game.play.save.data.food[id] ?? 0, gone: !window.__it.active }), food.id);
  ok('tap food: walks there and picks it', goal === `pick:${food.id}` && after.n === food.n + 1 && after.gone, `goal=${goal} ${food.n}→${after.n}`);
  // --- joystick cancels tap-walk
  await setup(page); await frameCam(page, 0.3, 0.75, 10); await frames(page, 2);
  await page.evaluate(() => { const g = window.game, p = g.player.position; g.play.walk.go({ pos: () => ({ x: p.x + 12, z: p.z }), reach: 0.3, key: '' }); });
  await sim(page, 0.3);
  const P = { x: vw.w * 0.2, y: vw.h * 0.75 };
  await touch('touchStart', [P]); await touch('touchMove', [{ x: P.x, y: P.y - 50 }]); await sim(page, 0.2);
  const canc = await page.evaluate(() => window.game.play.walk.active);
  await touch('touchEnd', []);
  ok('joystick cancels tap-walk', canc === false);
  ok('iPad: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

if (!process.argv.includes('--skip-desktop')) {
  const { ctx, page, errors } = await open({ viewport: { width: 1280, height: 720 } }, 'high');
  await setup(page); await frameCam(page, 0.3, 0.75, 10); await frames(page, 2);
  const tgt = await page.evaluate(() => { const g = window.game, p = g.player.position.clone(); p.x -= 3; p.z -= 3; p.y = g.heightAt(p.x, p.z); const s = g.play.juice.project(p); return { sx: s.x, sy: s.y, x: p.x, z: p.z }; });
  await page.mouse.click(tgt.sx, tgt.sy);
  await sim(page, 3.5);
  const b = await pos(page);
  ok('desktop: click-to-walk', Math.hypot(b.x - tgt.x, b.z - tgt.z) < 0.8, `${Math.hypot(b.x - tgt.x, b.z - tgt.z).toFixed(2)} m`);
  // camera drag is not a click
  await page.mouse.move(640, 300); await page.mouse.down(); await page.mouse.move(700, 310, { steps: 5 }); await page.mouse.up();
  ok('desktop: drag does not walk', !(await page.evaluate(() => window.game.play.walk.active)));
  // build mode click still places a piece
  const n0 = await page.evaluate(() => { const g = window.game; g.build.toggle(true); return g.build.count; });
  const bp = await page.evaluate(() => { const g = window.game, p = g.player.position.clone(); p.x += 2; p.y = g.heightAt(p.x, p.z); return g.play.juice.project(p); });
  await page.mouse.move(bp.x, bp.y); await frames(page, 2); await page.mouse.click(bp.x, bp.y); await frames(page, 2);
  const n1 = await page.evaluate(() => window.game.build.count);
  const w = await page.evaluate(() => window.game.play.walk.active);
  ok('desktop: build mode click places (no walk)', n1 === n0 + 1 && !w, `${n0}→${n1}`);
  ok('desktop: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}
await browser.close();
const f = results.filter((r) => !r).length; console.log(`\n${results.length - f}/${results.length} passed`); process.exit(f ? 1 : 0);
