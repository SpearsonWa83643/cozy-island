// iPad/touch + GitHub-Pages-subpath smoke test.
// Usage: node tests/touch.mjs [baseUrl]   (default http://localhost:4181/cozy-island/ from tests/subpath-server.mjs)
import { chromium, devices } from 'playwright';
import fs from 'node:fs';

const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const outDir = new URL('../screenshots/', import.meta.url).pathname;
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const __closeBrowser = async (code) => { try { await browser.close(); } catch { /* ignore */ } process.exit(code); };
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => __closeBrowser(130));
process.on('uncaughtException', (e) => { console.error(e); __closeBrowser(1); });
process.on('unhandledRejection', (e) => { console.error(e); __closeBrowser(1); });
const results = {};
const ok = (name, cond, extra = '') => { results[name] = cond; console.log(`${cond ? 'PASS' : 'FAIL'} ${name} ${extra}`); };

async function open(ctxOpts, query) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  page.setDefaultTimeout(240000);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall/.test(m.text()))) errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`[requestfailed] ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`[http ${r.status()}] ${r.url()}`); });
  await page.goto(base + query);
  await page.waitForFunction(() => window.game?.ready);
  return { ctx, page, errors };
}
const frames = (page, n) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const center = (page, sel) => page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);

// ---------------- iPad ----------------
{
  const dev = devices['iPad Pro 11 landscape'];
  const { ctx, page, errors } = await open({ ...dev, deviceScaleFactor: 1 }, '?webgl');
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: i + 1, radiusX: 4, radiusY: 4, force: 1 })) });

  const st = await page.evaluate(() => ({
    touch: document.body.classList.contains('touch'),
    quality: window.game.renderer.quality,
    keysHidden: getComputedStyle(document.querySelector('.title .keys')).display === 'none',
    uiShown: !!document.querySelector('.touch-ui .stick'),
    coarse: matchMedia('(pointer: coarse)').matches,
    touchAction: getComputedStyle(document.body).touchAction,
    viewport: document.querySelector('meta[name=viewport]').content,
    backend: window.game.renderer.backendName,
  }));
  console.log('ipad state', st);
  ok('ipad: touch UI detected', st.touch && st.uiShown);
  ok('ipad: defaults to Low quality', st.quality === 'low');
  ok('ipad: keyboard hint hidden', st.keysHidden);
  ok('ipad: touch-action none + user-scalable=no', st.touchAction === 'none' && /user-scalable=no/.test(st.viewport));

  // Frame the shot near spawn.
  await page.evaluate(() => { const g = window.game; g.player.teleport(0, 6, Math.PI); g.rig.yaw = 0.3; g.rig.pitch = 0.38; g.rig.distance = 7.5; g.rig.target.copy(g.player.position).setY(g.player.position.y + 1.1); });
  await frames(page, 3);

  // Joystick: hold the knob pushed up (forward) and step the sim.
  const sc = await center(page, '.stick');
  await touch('touchStart', [sc]);
  await touch('touchMove', [{ x: sc.x + 8, y: sc.y - 40 }]);
  await touch('touchMove', [{ x: sc.x + 12, y: sc.y - 70 }]);
  const mv = await page.evaluate(() => {
    const g = window.game; const a = g.player.position.clone(); const stick = { ...g.input.stick };
    for (let i = 0; i < 90; i++) g.step(1 / 60);
    const b = g.player.position;
    return { stick, dist: Math.hypot(b.x - a.x, b.z - a.z), from: [a.x, a.z], to: [b.x, b.z] };
  });
  console.log('joystick move', mv);
  ok('ipad: joystick drag moves the character', mv.dist > 2, `(${mv.dist.toFixed(2)} m in 1.5 s sim)`);
  // re-frame for the screenshot: short walk across the open meadow with the stick still held
  await page.evaluate(() => {
    const g = window.game; g.player.teleport(0.5, 7, Math.PI);
    for (let i = 0; i < 20; i++) g.step(1 / 60);
    g.rig.yaw = 0.75; g.rig.pitch = 0.3; g.rig.distance = 6.5;
    g.rig.target.copy(g.player.position).setY(g.player.position.y + 1.1); g.rig.apply();
  });
  await frames(page, 3);
  await page.screenshot({ path: outDir + '05-ipad-walk.png' });
  console.log('saved 05-ipad-walk.png');
  await touch('touchEnd', []);
  const released = await page.evaluate(() => ({ ...window.game.input.stick }));
  ok('ipad: joystick recentres on release', released.x === 0 && released.y === 0);

  // Jump button
  const jb = await center(page, '.tbtn.jump');
  // y0 before the tap: on a loaded box real frames can advance the jump between the tap and the measurement
  const y0 = await page.evaluate(() => window.game.player.position.y);
  await page.touchscreen.tap(jb.x, jb.y);
  const jumped = await page.evaluate((y0) => { const g = window.game; let m = Math.max(y0, g.player.position.y); for (let i = 0; i < 25; i++) { g.step(1 / 60); m = Math.max(m, g.player.position.y); } return m - y0; }, y0);
  ok('ipad: Jump button jumps', jumped > 0.5, `(${jumped.toFixed(2)} m)`);

  // Orbit drag on the right side + pinch zoom
  const r0 = await page.evaluate(() => ({ yaw: window.game.rig.yaw, d: window.game.rig.distance }));
  await touch('touchStart', [{ x: 900, y: 300 }]);
  for (let i = 1; i <= 5; i++) { await touch('touchMove', [{ x: 900 - i * 30, y: 300 }]); await page.evaluate(() => window.game.step(1 / 30)); }
  await touch('touchEnd', []);
  await frames(page, 2);
  await touch('touchStart', [{ x: 520, y: 400 }, { x: 620, y: 400 }]);
  for (let i = 1; i <= 5; i++) { await touch('touchMove', [{ x: 520 - i * 25, y: 400 }, { x: 620 + i * 25, y: 400 }]); await page.evaluate(() => window.game.step(1 / 30)); }
  await touch('touchEnd', []);
  await frames(page, 2);
  const r1 = await page.evaluate(() => ({ yaw: window.game.rig.yaw, d: window.game.rig.distance }));
  ok('ipad: right-side drag orbits camera', Math.abs(r1.yaw - r0.yaw) > 0.2, `(yaw ${r0.yaw.toFixed(2)} -> ${r1.yaw.toFixed(2)})`);
  ok('ipad: pinch zooms in', r1.d < r0.d * 0.8, `(dist ${r0.d.toFixed(2)} -> ${r1.d.toFixed(2)})`);

  // ---- eye (free look) button ----
  await page.evaluate(() => { const g = window.game; g.player.teleport(1.5, 8, 2.4); g.play.walk.cancel(); g.input.setHand('auto'); g.rig.yaw = -0.15; g.rig.pitch = 0.5; g.rig.distance = 9; });
  await frames(page, 3);
  const W = 1194, H = 834;
  const overlaps = () => page.evaluate(() => {
    const e = document.querySelector('.eye-btn').getBoundingClientRect();
    const hit = [];
    for (const el of document.querySelectorAll('.tbtn, .action-btn, .gbtn, .hotbar, .stick')) {
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      if (!r.width || cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
      if (r.left < e.right && r.right > e.left && r.top < e.bottom && r.bottom > e.top) hit.push(el.className);
    }
    return { size: Math.min(e.width, e.height), hit, left: e.left };
  });
  const ov = await overlaps();
  ok('ipad: eye button is 44pt+ and clear of other buttons', ov.size >= 44 && ov.hit.length === 0, JSON.stringify(ov));
  const eye = await center(page, '.eye-btn');
  const st0 = await page.evaluate(() => ({ yaw: window.game.rig.yaw, p: window.game.player.position.clone() }));
  const yaw0 = st0.yaw;
  await touch('touchStart', [eye]);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', [{ x: eye.x - i * 45, y: eye.y - i * 12 }]); await page.evaluate(() => window.game.step(1 / 30)); }
  const held = await page.evaluate(() => ({ down: document.querySelector('.eye-btn').classList.contains('down'), look: window.game.input.eyeLook, stick: window.game.input.stickUi.on }));
  await page.screenshot({ path: outDir + '42-ipad-eye-look.png' });
  await touch('touchEnd', []);
  const st1 = await page.evaluate((a) => { const g = window.game; for (let i = 0; i < 8; i++) g.step(1 / 30); return { dyaw: Math.abs(g.rig.yaw - a.yaw), moved: Math.hypot(g.player.position.x - a.p.x, g.player.position.z - a.p.z), walk: !!g.play.walk.goal, down: document.querySelector('.eye-btn').classList.contains('down') }; }, st0);
  ok('ipad: press eye + drag anywhere orbits (pressed state, no walk/stick)', held.down && held.look && !held.stick && st1.dyaw > 0.4 && !st1.walk && st1.moved < 0.3 && !st1.down, JSON.stringify({ ...held, ...st1 }));
  // two thumbs: floating joystick (left) + eye drag at the same time
  const S = { x: 200, y: H - 160 };
  const t0 = await page.evaluate(() => ({ yaw: window.game.rig.yaw, p: window.game.player.position.clone() }));
  await touch('touchStart', [S]);
  await touch('touchMove', [{ x: S.x, y: S.y - 50 }]);
  await touch('touchStart', [{ x: S.x, y: S.y - 50 }, eye]);
  for (let i = 1; i <= 8; i++) {
    await touch('touchMove', [{ x: S.x, y: S.y - 55 }, { x: eye.x - i * 30, y: eye.y }]);
    await page.evaluate(() => { for (let k = 0; k < 3; k++) window.game.step(1 / 30); });
  }
  const mid = await page.evaluate(() => ({ stick: window.game.input.stickUi.active, look: window.game.input.eyeLook }));
  await touch('touchEnd', []);
  const t1 = await page.evaluate((a) => { const g = window.game; for (let i = 0; i < 6; i++) g.step(1 / 30); return { dyaw: Math.abs(g.rig.yaw - a.yaw), moved: Math.hypot(g.player.position.x - a.p.x, g.player.position.z - a.p.z) }; }, t0);
  ok('ipad: joystick + eye drag simultaneously', mid.stick && mid.look && t1.moved > 1 && t1.dyaw > 0.2, JSON.stringify({ ...mid, ...t1 }));
  // tap still walks
  // the eye drags above rotated the camera; restore the starting view so the tap lands on the same open ground
  await page.evaluate((y0) => { const g = window.game; g.player.teleport(1.5, 8, 2.4); g.play.walk.cancel(); g.rig.yaw = y0; g.rig.pitch = 0.5; for (let i = 0; i < 20; i++) g.step(1 / 30); g.play.walk.cancel(); }, yaw0);
  await frames(page, 2);
  const done0 = await page.evaluate(() => {
    const g = window.game; const i = g.input;
    window.__tapProbe = [];
    if (!window.__tapProbeOn) { window.__tapProbeOn = true; i.onClick.unshift((e, drag) => { window.__tapProbe?.push({ drag, button: e.button, type: e.pointerType, x: e.clientX, y: e.clientY }); }); }
    window.__tapPre = { ptrs: i.ptrs.size, multi: i.multiTouched, stick: !!i.stickPtr, eye: i.eyeLook, lock: g.play.lockMove, preview: g.play.previewOn };
    return g.play.walk.stats.done;
  });
  await page.touchscreen.tap(W * 0.42, H * 0.3);
  const tapRes = await page.evaluate((d0) => { const g = window.game; g.step(1 / 30); const going = !!g.play.walk.goal; return { walking: going || g.play.walk.stats.done > d0, outcome: g.play.lastTap, yaw: +g.rig.yaw.toFixed(2), pre: window.__tapPre, clicks: window.__tapProbe, ptrsAfter: g.input.ptrs.size }; }, done0);
  const walking = tapRes.walking;
  await page.evaluate(() => window.game.play.walk.cancel());
  ok('ipad: quick tap on the ground still walks', walking, JSON.stringify(tapRes));
  // mirrors for right-handed play
  await page.evaluate(() => window.game.input.setHand('right'));
  await frames(page, 2);
  const ovR = await overlaps();
  await page.evaluate(() => window.game.input.setHand('auto'));
  ok('ipad: eye mirrors to the left for right-handed (still clear of buttons)', ovR.left < W / 2 && ovR.hit.length === 0, JSON.stringify(ovR));

  // Build mode via button, tap-to-place, hotbar, rotate, remove toggle
  await page.evaluate(() => { const g = window.game; g.player.teleport(1.5, 8, 2.4); g.rig.yaw = -0.15; g.rig.pitch = 0.62; g.rig.distance = 11; g.rig.target.set(-1.5, g.player.position.y + 0.6, 5); g.rig.apply(); });
  await frames(page, 2);
  const bb = await center(page, '.tbtn.build');
  await page.touchscreen.tap(bb.x, bb.y);
  await frames(page, 2);
  const bstate = await page.evaluate(() => ({ active: window.game.build.active, rot: getComputedStyle(document.querySelector('.tbtn.rotate')).display, hot: !document.querySelector('.hotbar').classList.contains('off') }));
  ok('ipad: Build button enters build mode (+Rotate/Remove/hotbar shown)', bstate.active && bstate.rot !== 'none' && bstate.hot);

  // screen position of a world point
  const toScreen = (x, z) => page.evaluate(([x, z]) => {
    const g = window.game; const v = g.camera.position.clone().set(x, g.player.position.y, z); // meadow is ~flat
    v.project(g.camera);
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
  }, [x, z]);
  const count = () => page.evaluate(() => window.game.build.count);
  const c0 = await count();
  let p = await toScreen(-3, 4); await page.touchscreen.tap(p.x, p.y); await frames(page, 1);
  p = await toScreen(-2, 4); await page.touchscreen.tap(p.x, p.y); await frames(page, 1);
  const c1 = await count();
  ok('ipad: tap places pieces', c1 === c0 + 2, `(${c0} -> ${c1})`);
  const slot = await page.evaluate(() => { const r = document.querySelectorAll('.slot')[2].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.touchscreen.tap(slot.x, slot.y);
  const rb = await center(page, '.tbtn.rotate');
  await page.touchscreen.tap(rb.x, rb.y); await frames(page, 1);
  const sel = await page.evaluate(() => ({ s: window.game.build.selected, r: window.game.build.rotation }));
  ok('ipad: hotbar tap selects piece', sel.s === 2);
  ok('ipad: Rotate button rotates piece', sel.r > 0);
  p = await toScreen(0, 3); await page.touchscreen.tap(p.x, p.y); await frames(page, 1);
  // remove mode: tap the block at (-2,4)
  const rm = await center(page, '.tbtn.remove');
  await page.touchscreen.tap(rm.x, rm.y);
  const c2 = await count();
  const pb = await page.evaluate(() => { const g = window.game; const o = g.build.group.children.find((c) => Math.abs(c.position.x + 2) < 0.01 && Math.abs(c.position.z - 4) < 0.01); const v = o.position.clone(); v.y += 0.5; v.project(g.camera); return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight }; });
  await page.touchscreen.tap(pb.x, pb.y); await frames(page, 1);
  // far pieces: the character walks over first, then removes it (tap-to-walk)
  const walked = await page.evaluate(() => { const g = window.game; const w = g.play.walk.active; for (let i = 0; i < 240 && g.play.walk.active; i++) g.step(1 / 30); return w; });
  console.log('remove: walked over first =', walked);
  const c3 = await count();
  ok('ipad: Remove toggle + tap removes a piece', c3 === c2 - 1, `(${c2} -> ${c3})`);
  await page.touchscreen.tap(rm.x, rm.y); // remove mode off

  // dress the scene for the screenshot
  await page.evaluate(() => {
    const b = window.game.build; const P = (x, z, t, r = 0) => b.placeAt(x, z, t, r);
    for (let i = 0; i < 3; i++) P(-5 + i, 3, 0);
    for (let i = 0; i < 5; i++) P(-5 + i, 8, 1);
    P(-5, 7, 1, Math.PI / 2); P(-5, 6, 1, Math.PI / 2); P(2, 2, 3); P(-1, 4, 4); P(-4, 4, 4);
    b.placeAt(-5, 3, 0, 0, b.group.children.find((c) => c.position.x === -5 && c.position.z === 3).position.y + 1);
    b.select(0);
    window.game.input.setMouse(innerWidth * 0.58, innerHeight * 0.6);
  });
  await frames(page, 8);
  await page.screenshot({ path: outDir + '06-ipad-build.png' });
  console.log('saved 06-ipad-build.png');
  ok('ipad: no console errors', errors.length === 0, errors.join('\n'));
  await ctx.close();
}

// ---------------- Desktop (subpath) ----------------
{
  const { ctx, page, errors } = await open({ viewport: { width: 1440, height: 810 } }, '?webgl');
  const st = await page.evaluate(() => ({ touch: document.body.classList.contains('touch'), ui: !!document.querySelector('.touch-ui'), q: window.game.renderer.quality, keys: getComputedStyle(document.querySelector('.title .keys')).display }));
  ok('desktop: no touch UI, keyboard hint visible, High quality', !st.touch && !st.ui && st.keys !== 'none' && st.q === 'high', JSON.stringify(st));
  await page.keyboard.down('w');
  const mv = await page.evaluate(() => { const g = window.game; const a = g.player.position.clone(); for (let i = 0; i < 60; i++) g.step(1 / 60); return a.distanceTo(g.player.position); });
  await page.keyboard.up('w');
  ok('desktop: W moves character', mv > 2, `(${mv.toFixed(2)} m)`);
  await page.keyboard.press('b'); await frames(page, 2);
  const bm = await page.evaluate(() => window.game.build.active);
  ok('desktop: B toggles build mode', bm);
  await frames(page, 4);
  ok('desktop: no console errors', errors.length === 0, errors.join('\n'));
  await ctx.close();
}
await browser.close();
const failed = Object.entries(results).filter(([, v]) => !v);
console.log(failed.length ? `\n${failed.length} FAILED` : `\nALL ${Object.keys(results).length} CHECKS PASSED`);
process.exit(failed.length ? 1 : 0);
