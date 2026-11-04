// Rowboat acceptance (Order 51d), iPad touch viewport: board at the Home Dock with a real tap, steer with a real
// joystick drag (forward + turn + release), sail a ring to every islet dock (Blossom -> Driftwood -> Heron -> Juniper)
// tying up and re-boarding by tap at each, respect the sea edge (rowing straight out from Juniper is turned back at the
// leash), tie up at Juniper again, reload (save restores it there), and row home. Screenshot 102. Timeout + browser closed in finally.
// Usage: node tests/boat-tour.mjs [baseUrl]
import { chromium, devices } from 'playwright';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const kill = setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 900000);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = []; const ok = (n, c, x = '') => { results.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
const errFilter = (m) => (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|swiftshader|Automatic fallback/i.test(m.text())));
try {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], deviceScaleFactor: 1, hasTouch: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(150000);
  const errors = []; page.on('console', (m) => { if (errFilter(m)) errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1, radiusX: 4, radiusY: 4, force: 1 })) });
  const q = '?webgl&q=low&touch=1&whatsnew=0&time=noon&weather=clear';
  await page.goto(base + q); await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => document.getElementById('whatsnew')?.querySelector('.w-ok')?.click());
  const snap = () => page.evaluate(() => window.game.mount.snapshot());
  const step = (n) => page.evaluate((n) => { for (let i = 0; i < n; i++) window.game.step(1 / 60); }, n);
  const waitPhase = async (ph) => { for (let i = 0; i < 120 && (await snap()).phase !== ph; i++) await step(5); return snap(); };
  // board at a dock's deck with a real tap on the action button
  const board = async (k) => {
    await page.evaluate((k) => { const g = window.game, d = g.docks.list[k]; g.player.teleport(d.step.x, d.step.z, d.moor.h, 0.62); for (let i = 0; i < 40; i++) g.step(1 / 60); }, k);
    await step(10); await page.waitForTimeout(300);
    const label = await page.evaluate(() => window.game.play.target?.label ?? null);
    await page.tap('.action-btn'); const s = await waitPhase('ride'); return { label, phase: s.phase, mounted: s.mounted };
  };
  // auto-row to dock k (camera-relative stick forward, camera aimed at the next waypoint); legs that would cut across
  // the main island detour round it 115 m out
  const row = (k) => page.evaluate((k) => { const g = window.game, m = g.mount, d = g.docks.list[k];
    const wps = []; { const ax = m.gx, az = m.gz, dx = d.moor.x - ax, dz = d.moor.z - az, L2 = dx * dx + dz * dz, t = Math.max(0, Math.min(1, -(ax * dx + az * dz) / L2));
      const cx = ax + dx * t, cz = az + dz * t, r = Math.hypot(cx, cz); if (r < 100) { const nx = r > 1 ? cx / r : -dz / Math.sqrt(L2), nz = r > 1 ? cz / r : dx / Math.sqrt(L2); wps.push({ x: nx * 115, z: nz * 115 }); } }
    wps.push({ x: d.moor.x, z: d.moor.z });
    let n = 0, dist = 1e9, w = 0, maxBlocked = 0, minAlt = 9;
    for (; n < 60 * 150; n++) { const p = wps[w]; dist = Math.hypot(m.gx - p.x, m.gz - p.z);
      if (w < wps.length - 1 && dist < 8) { w++; continue; } if (w === wps.length - 1 && dist < 3.5) break;
      g.rig.yaw = Math.atan2(m.gx - p.x, m.gz - p.z); g.input.stick.x = 0; g.input.stick.y = -1; g.step(1 / 60);
      maxBlocked = Math.max(maxBlocked, m.blockedT); minAlt = Math.min(minAlt, m.alt); }
    g.input.stick.y = 0; for (let i = 0; i < 40; i++) g.step(1 / 60);
    return { name: d.name, secs: +(n / 60).toFixed(1), dist: +dist.toFixed(1), detour: wps.length > 1, maxBlocked: +maxBlocked.toFixed(2), minAlt: +minAlt.toFixed(2), phase: m.phase }; }, k);
  const land = async () => { await page.tap('.mount-btn'); await step(30);
    return page.evaluate(() => { const g = window.game, s = g.mount.snapshot(); return { phase: s.phase, boatAt: g.docks.boatAt, away: g.docks.away, saved: g.play.save.data.boatDock, swim: g.player.swimming, y: +g.player.position.y.toFixed(2) }; }); };

  // 1. board at the Home Dock
  const b0 = await board(0);
  ok('boards the rowboat at the Home Dock with a tap', b0.label === 'Take Rowboat' && b0.phase === 'ride' && b0.mounted, JSON.stringify(b0));
  // 2. real joystick drag: forward rows, a sideways push turns the boat
  await page.evaluate(() => { const g = window.game, m = g.mount, d = g.docks.list[1]; g.rig.yaw = Math.atan2(m.gx - d.moor.x, m.gz - d.moor.z); });
  const sc = await page.evaluate(() => { const r = document.querySelector('.stick').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await touch('touchStart', [sc]); await touch('touchMove', [{ x: sc.x + 4, y: sc.y - 40 }]); await touch('touchMove', [{ x: sc.x + 2, y: sc.y - 70 }]);
  const fwd = await page.evaluate(() => { const g = window.game, m = g.mount, a = [m.gx, m.gz], h0 = m.heading, stick = { ...g.input.stick };
    for (let i = 0; i < 180; i++) g.step(1 / 60); return { stick, moved: +Math.hypot(m.gx - a[0], m.gz - a[1]).toFixed(1), speed: +m.speed.toFixed(2), dh: +(m.heading - h0).toFixed(2), h: m.heading }; });
  ok('joystick drag forward rows the boat ahead', fwd.stick.y < -0.5 && fwd.moved > 6 && fwd.speed > 3 && Math.abs(fwd.dh) < 0.3, JSON.stringify(fwd));
  await touch('touchMove', [{ x: sc.x + 70, y: sc.y - 10 }]);
  const turn = await page.evaluate((h0) => { const g = window.game, m = g.mount, stick = { ...g.input.stick }; g.rig.locked = true; const y0 = g.rig.yaw;
    for (let i = 0; i < 90; i++) { g.rig.yaw = y0; g.step(1 / 60); } g.rig.locked = false; let dh = m.heading - h0; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); return { stick, dh: +dh.toFixed(2), speed: +m.speed.toFixed(2) }; }, fwd.h);
  ok('pushing the joystick sideways steers the boat round', turn.stick.x > 0.5 && Math.abs(turn.dh) > 0.5, JSON.stringify(turn));
  await touch('touchEnd', []);
  const rel = await page.evaluate(() => { for (let i = 0; i < 120; i++) window.game.step(1 / 60); return { stick: { ...window.game.input.stick }, speed: +window.game.mount.speed.toFixed(2) }; });
  ok('letting go of the joystick: oars rest and the boat glides to a stop', rel.stick.x === 0 && rel.stick.y === 0 && rel.speed < turn.speed * 0.7, JSON.stringify({ rel, before: turn.speed }));
  // 4. a ring to every islet dock, tying up and re-boarding at each
  const ring = [1, 4, 2, 3]; let tied = 0;
  for (const k of ring) {
    const r = await row(k); const t = await land();
    const good = r.dist <= 3.5 && t.phase === 'off' && t.boatAt === k && !t.away && t.saved === k && !t.swim && t.y > 0.4;
    ok(`rows to ${r.name} and ties up at its dock`, good, JSON.stringify({ r, t })); if (good) tied++;
    if (k === 4) { await page.evaluate(() => { const g = window.game, m = g.mount, p = g.player.position; g.rig.yaw = Math.atan2(p.x - 0, p.z - 0) + Math.PI * 0.6; g.rig.pitch = 0.5; }); await step(30); await page.waitForTimeout(600);
      await page.screenshot({ path: 'screenshots/102-ipad-rowboat-driftwood.png' }); }
    { const b = await board(k); ok(`boards again at ${r.name} with a tap`, b.label === 'Row Boat' && b.phase === 'ride', JSON.stringify(b)); }
  }
  ok('every islet dock reached', tied === 4, `${tied}/4`);
  // 4b. sea edge (from Juniper Isle, the west end): row straight out to open sea for 90 s; the wind turns you back at the leash
  const edge = await page.evaluate(() => { const g = window.game, m = g.mount, x0 = m.gx, z0 = m.gz; let r60 = 0, rMax = 0, off60 = 0, offMax = 0; const path = [];
    for (let i = 0; i < 60 * 90; i++) { g.rig.yaw = Math.atan2(1, -0.3); g.input.stick.x = 0; g.input.stick.y = -1; // aim west, a little south: open sea
      g.step(1 / 60); const r = Math.hypot(m.gx - x0, m.gz - z0), off = g.coast.nearestLand(m.gx, m.gz).off; rMax = Math.max(rMax, r); offMax = Math.max(offMax, off);
      if (i === 60 * 60) { r60 = r; off60 = off; } if (i % 60 === 0) path.push([m.gx, m.gz]); }
    g.input.stick.y = 0; for (let i = 0; i < 60; i++) g.step(1 / 60);
    const off90 = g.coast.nearestLand(m.gx, m.gz).off;
    return { r60: +r60.toFixed(1), r90: +Math.hypot(m.gx - x0, m.gz - z0).toFixed(1), rMax: +rMax.toFixed(1), off60: +off60.toFixed(1), off90: +off90.toFixed(1), offMax: +offMax.toFixed(1), pos: [+m.gx.toFixed(1), +m.gz.toFixed(1)], start: [x0, z0], phase: m.phase, path }; });
  const { path: edgePath, ...edgeOut } = edge; // the leash is measured from the nearest shore (FLY_LEASH 85 m), not from the dock
  ok('respects the sea edge: rowing out to open sea is turned back (about 85 m offshore, not 790 m)', edge.offMax < 95 && edge.off90 > 75 && edge.r60 > 40 && edge.r90 - edge.r60 < 3 && edge.phase === 'ride', JSON.stringify(edgeOut));
  // retrace the wake back (a straight line to the dock would run into Juniper Isle itself, the boat slid round its shore going out), then in to the dock
  await page.evaluate((pts) => { const g = window.game, m = g.mount; let w = pts.length - 1;
    for (let n = 0; n < 60 * 90 && w >= 0; n++) { const [x, z] = pts[w]; if (Math.hypot(m.gx - x, m.gz - z) < 6) { w--; continue; } g.rig.yaw = Math.atan2(m.gx - x, m.gz - z); g.input.stick.y = -1; g.step(1 / 60); } g.input.stick.y = 0; }, edgePath);
  const back3 = await row(3); const t3 = await land();
  ok('rows back from the sea edge to the Juniper Isle dock', back3.dist <= 3.5 && t3.boatAt === 3 && t3.phase === 'off', JSON.stringify({ back3, t3 }));
  // 5. the save restores the boat at the last islet dock; row home
  await page.evaluate(() => window.game.play.save.flush?.() ?? window.game.play.save.save?.());
  await page.reload(); await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => document.getElementById('whatsnew')?.querySelector('.w-ok')?.click());
  const back = await page.evaluate(() => ({ boatAt: window.game.docks.boatAt, mine: !!window.game.play.save.data.boat }));
  ok('after a reload the rowboat is still yours, tied up at Juniper Isle', back.boatAt === 3 && back.mine, JSON.stringify(back));
  const b3 = await board(3); ok('boards at Juniper Isle after the reload', b3.phase === 'ride', JSON.stringify(b3));
  const rh = await row(0); const th = await land();
  ok('rows home and ties up at the Home Dock', rh.dist <= 3.5 && th.boatAt === 0 && th.phase === 'off' && !th.swim, JSON.stringify({ rh, th }));
  ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(`${results.filter(Boolean).length}/${results.length} passed`);
  if (results.some((r) => !r)) process.exitCode = 1;
} finally { clearTimeout(kill); await browser.close().catch(() => {}); }
