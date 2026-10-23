// Order 35: Build Mode touch bar Rotate + Undo on the iPad viewport. Place, rotate, place, place, Undo;
// the ghost swings to the new rotation; the saved layout survives reload with correct rotations.
// Usage: node tests/build-undo.mjs [baseUrl] [--no-shots]
import { chromium, devices } from 'playwright';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4193/';
const shots = !process.argv.includes('--no-shots');
const kill = setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 480000);
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
  const center = (sel) => page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, disp: getComputedStyle(document.querySelector(sel)).display }; }, sel);
  const tapSel = async (sel) => { const c = await center(sel); await page.touchscreen.tap(c.x, c.y); await frames(2); };
  const setCam = () => page.evaluate(() => { const g = window.game; g.player.teleport(1.5, 8, 2.4); g.rig.yaw = -0.15; g.rig.pitch = 0.62; g.rig.distance = 11; g.rig.target.set(-1.5, g.player.position.y + 0.6, 5); g.rig.apply(); });
  const toScreen = (x, z) => page.evaluate(([x, z]) => { const g = window.game; const v = g.camera.position.clone().set(x, g.player.position.y, z); v.project(g.camera); return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight }; }, [x, z]);
  const tapWorld = async (x, z) => { const p = await toScreen(x, z); await page.touchscreen.tap(p.x, p.y); await frames(2); };
  const pieces = () => page.evaluate(() => window.game.build.pieces.map((p) => ({ x: +p.obj.position.x.toFixed(2), z: +p.obj.position.z.toFixed(2), r: +p.obj.rotation.y.toFixed(3) })));

  await setCam(); await frames(2);
  ok('Undo hidden outside Build Mode', (await center('.tbtn.undo')).disp === 'none');
  await tapSel('.tbtn.build');
  const ub = await center('.tbtn.undo');
  ok('Build Mode shows a big Undo button', ub.disp !== 'none' && ub.w >= 64 && ub.h >= 64, JSON.stringify(ub));
  const cover = await page.evaluate(() => ['.tbtn.rotate', '.tbtn.undo', '.tbtn.remove', '.tbtn.build', '.tbtn.jump'].map((sel) => { const b = document.querySelector(sel), r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { sel, top: !!e && b.contains(e) }; }));
  ok('every build button is on top (nothing covers it)', cover.every((c) => c.top), JSON.stringify(cover));
  ok('Undo starts dimmed (nothing to undo)', await page.evaluate(() => document.querySelector('.tbtn.undo').classList.contains('dim')));
  await tapSel('.tbtn.undo');
  ok('Undo with nothing placed is harmless', (await pieces()).length === 0);

  await tapWorld(-3, 4); // piece A, rotation 0
  await tapSel('.tbtn.rotate');
  const r1 = await page.evaluate(() => window.game.build.rotation);
  ok('Rotate button: quarter turn', Math.abs(r1 - Math.PI / 2) < 1e-6, String(r1));
  const btnRot = await page.evaluate(() => document.querySelector('.tbtn.rotate').style.getPropertyValue('--rot'));
  ok('Rotate button icon shows the angle', btnRot === '90deg', btnRot);
  await frames(30);
  const gy = await page.evaluate(() => window.game.build.previewYaw);
  ok('ghost preview swings to the new rotation', gy !== null && Math.abs(gy - Math.PI / 2) < 0.05, String(gy));
  if (shots) await page.screenshot({ path: 'screenshots/order35-build-rotate-undo.png' }).catch((e) => console.log('shot failed', e.message));
  await tapWorld(-2, 4); // piece B, rotated
  await tapWorld(-1, 4); // piece C, rotated
  let ps = await pieces();
  ok('three pieces placed by tap', ps.length === 3, JSON.stringify(ps));
  ok('Undo lit once something is placed', !(await page.evaluate(() => document.querySelector('.tbtn.undo').classList.contains('dim'))));
  await tapSel('.tbtn.undo');
  ps = await pieces();
  ok('Undo takes back the last piece only', ps.length === 2 && !ps.some((p) => p.x === -1), JSON.stringify(ps));
  // four rotate taps wrap back to 0 (no runaway angle)
  for (let i = 0; i < 3; i++) await tapSel('.tbtn.rotate');
  ok('rotation wraps after a full turn', Math.abs(await page.evaluate(() => window.game.build.rotation)) < 1e-6);
  // save + reload: layout and rotations persist
  const saved = await pieces();
  await page.evaluate(() => window.game.play.save.flush());
  await page.reload(); await boot();
  await page.waitForFunction(() => window.game.build && window.game.build.count > 0, null, { timeout: 60000 });
  const after = await pieces();
  const key = (a) => a.map((p) => `${p.x},${p.z},${(((p.r % 6.2832) + 6.2832) % 6.2832).toFixed(2)}`).sort().join('|');
  ok('layout survives reload with rotations', key(after) === key(saved), JSON.stringify({ saved, after }));
  ok('piece B kept its quarter turn', after.some((p) => p.x === -2 && Math.abs(p.r - Math.PI / 2) < 0.01), JSON.stringify(after));
  ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
} catch (e) { console.error(e); results.push(false); } finally { clearTimeout(kill); await browser.close().catch(() => {}); }
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
