// Order 40: walkable build pieces (stone path, stairs, bridge) on the iPad viewport.
// Place each by touch, walk up the stairs and over the bridge, layout survives reload.
// Usage: node tests/build-walkable.mjs [baseUrl] [--no-shots]
import { chromium, devices } from 'playwright';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const shots = !process.argv.includes('--no-shots');
const kill = setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 600000);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = []; const ok = (n, c, x = '') => { results.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
try {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], deviceScaleFactor: 1, hasTouch: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(120000);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|swiftshader|Automatic fallback/i.test(m.text()))) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  const boot = async () => { await page.waitForFunction(() => window.game?.ready); await page.evaluate(() => document.getElementById('whatsnew')?.querySelector('.w-ok')?.click()); };
  await page.goto(base + '?webgl&q=low&touch=1&whatsnew=0'); await boot();
  await page.evaluate(() => localStorage.clear()); await page.reload(); await boot();
  const frames = (n) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  const center = (sel) => page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
  const tapSel = async (sel) => { const c = await center(sel); await page.touchscreen.tap(c.x, c.y); await frames(2); };
  const setCam = () => page.evaluate(() => { const g = window.game; g.player.teleport(1.5, 8, 2.4); g.rig.yaw = -0.15; g.rig.pitch = 0.62; g.rig.distance = 11; g.rig.target.set(-1.5, g.player.position.y + 0.6, 5); g.rig.apply(); });
  const toScreen = (x, z) => page.evaluate(([x, z]) => { const g = window.game; const v = g.camera.position.clone().set(x, g.player.position.y, z); v.project(g.camera); return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight }; }, [x, z]);
  const tapWorld = async (x, z) => { const p = await toScreen(x, z); await page.touchscreen.tap(p.x, p.y); await frames(2); };
  const pieces = () => page.evaluate(() => window.game.build.pieces.map((p) => ({ id: p.def.id, x: +p.obj.position.x.toFixed(2), y: +p.obj.position.y.toFixed(2), z: +p.obj.position.z.toFixed(2) })));

  await setCam(); await frames(2);
  await tapSel('.tbtn.build');
  // select via the hotbar order (catalog is appended: path 17, stairs 18, bridge 19)
  const place = async (type, x, z) => { await page.evaluate((t) => window.game.build.select(t), type); await frames(3); const n = (await pieces()).length; await tapWorld(x, z); await frames(3); return (await pieces()).length > n; };
  ok('stone path placed by tap', await place(17, -3, 4));
  ok('second path tile placed by tap', await place(17, -2, 4));
  ok('stairs placed by tap', await place(18, 0, 6));
  const ps = await pieces();
  ok('pieces have the right ids', ps.map((p) => p.id).join() === 'path,path,stairs', JSON.stringify(ps));
  const sel = await page.evaluate(() => document.querySelector('.hud')?.textContent?.includes('Stairs') || document.body.textContent.includes('Stairs'));
  ok('Stairs label shows in the HUD', sel);
  // the Bridge slot (last in the bar) is reachable on iPad: selecting it scrolls it into view, nothing covers it
  await page.evaluate(() => window.game.build.select(19)); await frames(3);
  const vis = await page.evaluate(() => { const s = [...document.querySelectorAll('.hotbar .slot')].find((e) => e.textContent.includes('Bridge')); const r = s.getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); const b = document.querySelector('.tbtn.build').getBoundingClientRect(); return { top: !!e && s.contains(e), x: Math.round(r.x), w: Math.round(r.width), clearOfBuild: r.right <= b.left }; });
  ok('Bridge slot visible and tappable in the hotbar', vis.top, JSON.stringify(vis));
  ok('hotbar stays clear of the Build button', vis.clearOfBuild, JSON.stringify(vis));
  await page.evaluate(() => window.game.build.select(18)); await frames(3);
  if (shots) await page.screenshot({ path: 'screenshots/order40-walkable-pieces.png', timeout: 90000 }).catch((e) => console.log('shot failed', e.message));
  await tapSel('.tbtn.build'); // leave Build Mode

  // walk up the stairs: start in front of the low step, walk to the top step
  const st = ps.find((p) => p.id === 'stairs');
  const walk = async (fx, fz, tx, tz, n = 240) => page.evaluate(async ([fx, fz, tx, tz, n]) => {
    const g = window.game; g.play.walk.cancel(false); g.player.teleport(fx, g.player.position.y + 2, fz);
    for (let i = 0; i < 30; i++) await new Promise((r) => requestAnimationFrame(r));
    g.play.walk.go({ pos: () => ({ x: tx, z: tz }), reach: 0.25, key: '' }, false);
    let maxY = -1e9; const y0 = g.player.position.y;
    for (let i = 0; i < n && g.play.walk.goal; i++) { await new Promise((r) => requestAnimationFrame(r)); maxY = Math.max(maxY, g.player.position.y); }
    const p = g.player.position; return { y0, maxY, end: { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) }, arrived: !g.play.walk.goal };
  }, [fx, fz, tx, tz, n]);
  const up = await walk(st.x, st.z - 1.6, st.x, st.z + 0.33);
  ok('player walks up the stairs', up.arrived && up.maxY - up.y0 > 0.8, JSON.stringify({ st, up }));

  // bridge: placed via the same placement path, then walked end to end
  const br = await page.evaluate(() => { const g = window.game; const n = g.build.count; g.build.placeAt(-6, 10, 19, 0); const p = g.build.pieces[n]; return { ok: g.build.count === n + 1, id: p.def.id, x: p.obj.position.x, y: p.obj.position.y, z: p.obj.position.z }; });
  ok('bridge placed', br.ok && br.id === 'bridge', JSON.stringify(br));
  const over = await walk(br.x, br.z - 2.4, br.x, br.z + 2.3, 300);
  ok('player walks over the bridge (rises over the arch, reaches the far end)', over.arrived && over.maxY > br.y + 0.25, JSON.stringify({ br, over }));

  const saved = await pieces();
  await page.evaluate(() => window.game.play.save.flush());
  await page.reload(); await boot();
  await page.waitForFunction(() => window.game.build && window.game.build.count > 0, null, { timeout: 60000 });
  const after = await pieces();
  const key = (a) => a.map((p) => `${p.id}@${p.x},${p.z}`).sort().join('|');
  ok('layout (path, stairs, bridge) survives reload', key(after) === key(saved), JSON.stringify({ saved, after }));
  ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
} catch (e) { console.error(e); results.push(false); } finally { clearTimeout(kill); await browser.close().catch(() => {}); }
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
