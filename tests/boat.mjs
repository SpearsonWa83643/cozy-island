// Rowboat (Order 51a), iPad touch viewport: hidden from the picker until it's yours; ?boat=1 unlocks it (51b: the dock);
// called by the water it floats at the waterline beside you; boarding, rowing at sea, Jump = big oar stroke (no dive),
// never beaches (blocked in the shallows), crosses past the turtle's reef leash toward the islets. Screenshot 99.
// Timeout + browser closed in finally. Usage: node tests/boat.mjs [baseUrl]
import { chromium, devices } from 'playwright';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const kill = setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 420000);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = []; const ok = (n, c, x = '') => { results.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
const errFilter = (m) => (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|swiftshader|Automatic fallback/i.test(m.text())));
try {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], deviceScaleFactor: 1, hasTouch: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(180000);
  const errors = []; page.on('console', (m) => { if (errFilter(m)) errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
  const q = '?webgl&q=low&touch=1&whatsnew=0&time=noon&weather=clear';
  await page.goto(base + q); await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => document.getElementById('whatsnew')?.querySelector('.w-ok')?.click());
  const snap = () => page.evaluate(() => window.game.mount.snapshot());
  const step = (n) => page.evaluate((n) => { for (let i = 0; i < n; i++) window.game.step(1 / 60); }, n);
  const waitPhase = async (ph) => { for (let i = 0; i < 120 && (await snap()).phase !== ph; i++) await step(5); return snap(); };
  // a fresh save: no rowboat, and no rowboat tile in the picker
  const fresh = await page.evaluate(() => ({ boat: !!window.game.play.save.data.boat }));
  ok('a fresh save has no rowboat', !fresh.boat);
  // ?boat=1 unlocks it (stand-in for finding it at the dock in 51b)
  await page.goto(base + q + '&boat=1'); await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => document.getElementById('whatsnew')?.querySelector('.w-ok')?.click());
  const un = await page.evaluate(() => ({ boat: !!window.game.play.save.data.boat }));
  ok('?boat=1 makes the rowboat yours', un.boat);
  // stand on the beach and call it
  const st = await page.evaluate(() => { const g = window.game; g.audio.unlock?.(); const ang = 0.6, p = g.coast.atOffshore(ang, -1.2); g.player.teleport(p.x, p.z, 0); for (let i = 0; i < 20; i++) g.step(1 / 30);
    g.play.save.data.mountId = 'rowboat'; g.mount.select('rowboat'); const called = g.mount.call('rowboat'); return { called, ang }; });
  let s = await waitPhase('wait');
  await step(120); s = await snap();
  ok('called by the water, it floats at the waterline beside you', s.id === 'rowboat' && s.phase === 'wait' && s.swim && s.boat && Math.abs(s.alt - 0.24) < 0.15, JSON.stringify(s));
  await page.tap('.mount-btn');
  s = await waitPhase('ride');
  ok('tapping the Mount button boards the rowboat', s.phase === 'ride' && s.mounted, JSON.stringify(s));
  // row straight out to sea
  await page.evaluate(() => { const g = window.game, m = g.mount; g.rig.yaw = Math.atan2(m.gx, m.gz) + Math.PI; g.input.stick.x = 0; g.input.stick.y = -1; });
  await step(180); s = await snap();
  ok('rows along at the surface (on top of the water)', s.speed > 3 && s.alt > 0.1 && s.alt < 0.4, JSON.stringify(s));
  const sp0 = s.speed;
  await page.evaluate(() => { const g = window.game; g.input.pressed.add(' '); g.step(1 / 60); });
  await step(20); s = await snap();
  ok('Jump is a big oar stroke, never a dive', s.strokes === 1 && s.dives === 0 && s.dive === 0 && s.alt > 0.1, JSON.stringify({ sp0, s }));
  await page.evaluate(() => { const g = window.game, m = g.mount; g.rig.yaw = m.heading + Math.PI * 0.85; });
  await step(10);
  await page.screenshot({ path: 'screenshots/99-ipad-rowboat.png' });
  // keep rowing out: a boat goes past the turtle's reef leash (it can reach the islets)
  const far = await page.evaluate(() => { const g = window.game, m = g.mount; let mx = 0; for (let i = 0; i < 60 * 20; i++) { g.rig.yaw = Math.atan2(m.gx, m.gz) + Math.PI; g.input.stick.y = -1; g.step(1 / 60); mx = Math.max(mx, g.coast.nearestLand(m.gx, m.gz).off); } return +mx.toFixed(1); });
  const turtleLeash = await page.evaluate(() => 0);
  ok('crosses open sea past the turtle reef leash', far > 40, String(far));
  // row back at the beach: it stops in the shallows instead of beaching
  const beach = await page.evaluate(() => { const g = window.game, m = g.mount; let minDepth = 9, blocked = 0;
    for (let i = 0; i < 60 * 30; i++) { g.rig.yaw = Math.atan2(m.gx, m.gz); g.input.stick.y = -1; g.step(1 / 60); const d = 0.5 - g.coast.offshore(m.gx, m.gz) * 0; blocked = Math.max(blocked, m.blockedT); }
    g.input.stick.y = 0; const sn = m.snapshot(); return { blocked: +blocked.toFixed(2), off: +g.coast.offshore(m.gx, m.gz).toFixed(2), alt: sn.alt, phase: sn.phase }; });
  ok('never beaches: blocked in the shallows, still afloat', beach.blocked > 0.3 && beach.phase === 'ride' && beach.alt > 0.05, JSON.stringify(beach));
  ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally { clearTimeout(kill); await browser.close().catch(() => {}); }
const pass = results.filter(Boolean).length;
console.log(`${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
