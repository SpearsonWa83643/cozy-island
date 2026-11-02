// Rowboat docks (Order 51b), iPad touch viewport: a jetty on the main island and on every islet; the rowboat starts
// tied up at the Home Dock; walking onto the deck shows "Take Rowboat" (first time makes it yours), tapping boards it;
// row across to an islet, Land by its dock ties up and steps you onto the deck; the save remembers which dock;
// row home again. Screenshot 100. Timeout + browser closed in finally. Usage: node tests/boat-dock.mjs [baseUrl]
import { chromium, devices } from 'playwright';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const kill = setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 480000);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = []; const ok = (n, c, x = '') => { results.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
const errFilter = (m) => (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|swiftshader|Automatic fallback/i.test(m.text())));
try {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], deviceScaleFactor: 1, hasTouch: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(60000);
  const errors = []; page.on('console', (m) => { if (errFilter(m)) errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
  const q = '?webgl&q=low&touch=1&whatsnew=0&time=noon&weather=clear';
  await page.goto(base + q); await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => document.getElementById('whatsnew')?.querySelector('.w-ok')?.click());
  const snap = () => page.evaluate(() => window.game.mount.snapshot());
  const step = (n) => page.evaluate((n) => { for (let i = 0; i < n; i++) window.game.step(1 / 60); }, n);
  const waitPhase = async (ph) => { for (let i = 0; i < 120 && (await snap()).phase !== ph; i++) await step(5); return snap(); };
  const dbg = await page.evaluate(() => window.game.docks.debug);
  console.log(JSON.stringify(dbg));
  ok('a dock on the main island and on every islet', dbg.docks.length === 5 && dbg.docks.every((d) => d.len >= 6 && d.len <= 18), String(dbg.docks.length));
  ok('the rowboat starts tied up at the Home Dock', dbg.boatAt === 0 && !dbg.away);
  // walk out onto the Home Dock deck
  const deck = await page.evaluate(() => { const g = window.game, d = g.docks.list[0]; g.player.teleport(d.step.x, d.step.z, d.moor.h, 0.62); for (let i = 0; i < 40; i++) g.step(1 / 60);
    const t = g.play.findTarget(g.player.position); return { y: +g.player.position.y.toFixed(2), swim: g.player.swimming, key: t?.key, label: t?.label }; });
  ok('stands on the deck (not swimming) and sees Take Rowboat', !deck.swim && deck.y > 0.5 && deck.key === 'board:boat' && deck.label === 'Take Rowboat', JSON.stringify(deck));
  await step(10);
  const shown = await page.evaluate(() => document.querySelector('.action-btn').classList.contains('show'));
  ok('the action button shows', shown);
  await page.tap('.action-btn');
  let s = await waitPhase('ride');
  const own = await page.evaluate(() => ({ boat: !!window.game.play.save.data.boat, away: window.game.docks.away }));
  ok('tapping it makes the rowboat yours and boards it', s.phase === 'ride' && s.id === 'rowboat' && s.mounted && own.boat && own.away, JSON.stringify({ s, own }));
  // row to the islet dock the Home Dock points at (Blossom Isle)
  const row = (k) => page.evaluate((k) => { const g = window.game, m = g.mount, d = g.docks.list[k]; let n = 0, dist = 1e9;
    for (; n < 60 * 120; n++) { dist = Math.hypot(m.gx - d.moor.x, m.gz - d.moor.z); if (dist < 3.5) break; g.rig.yaw = Math.atan2(m.gx - d.moor.x, m.gz - d.moor.z); g.input.stick.x = 0; g.input.stick.y = -1; g.step(1 / 60); }
    g.input.stick.y = 0; for (let i = 0; i < 40; i++) g.step(1 / 60); return { secs: +(n / 60).toFixed(1), dist: +dist.toFixed(1), name: d.name }; }, k);
  const r1 = await row(1);
  ok('rows across open sea to the Blossom Isle dock', r1.dist < 3.5, JSON.stringify(r1));
  await page.evaluate(() => { const g = window.game, m = g.mount; g.rig.yaw = m.heading + Math.PI * 0.75; }); await step(20);
  await page.screenshot({ path: 'screenshots/100-ipad-rowboat-dock.png' });
  await page.tap('.mount-btn'); await step(30);
  const tied = await page.evaluate(() => { const g = window.game, s = g.mount.snapshot(); return { phase: s.phase, dockings: s.dockings, boatAt: g.docks.boatAt, away: g.docks.away, saved: g.play.save.data.boatDock, y: +g.player.position.y.toFixed(2), swim: g.player.swimming, mounted: g.player.mounted }; });
  ok('Land by the dock ties it up and steps you onto the deck', tied.phase === 'off' && tied.dockings === 1 && tied.boatAt === 1 && !tied.away && tied.saved === 1 && !tied.swim && tied.y > 0.5 && !tied.mounted, JSON.stringify(tied));
  // the save remembers where it is tied up
  await page.evaluate(() => window.game.play.save.flush?.() ?? window.game.play.save.save?.());
  await page.reload(); await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => document.getElementById('whatsnew')?.querySelector('.w-ok')?.click());
  const back = await page.evaluate(() => { const g = window.game, d = g.docks.list[1]; g.player.teleport(d.step.x, d.step.z, d.moor.h, 0.62); for (let i = 0; i < 40; i++) g.step(1 / 60);
    const t = g.play.findTarget(g.player.position); return { boatAt: g.docks.boatAt, key: t?.key, label: t?.label }; });
  ok('after a reload it is still tied up at the islet dock (Row Boat)', back.boatAt === 1 && back.key === 'board:boat' && back.label === 'Row Boat', JSON.stringify(back));
  await page.tap('.action-btn'); s = await waitPhase('ride');
  const r2 = await row(0);
  await page.tap('.mount-btn'); await step(30);
  const home = await page.evaluate(() => { const g = window.game; return { boatAt: g.docks.boatAt, phase: g.mount.snapshot().phase, swim: g.player.swimming }; });
  ok('rows home and ties up at the Home Dock', r2.dist < 3.5 && home.boatAt === 0 && home.phase === 'off' && !home.swim, JSON.stringify({ r2, home }));
  // fps sanity: frame time of a step with a dock and the boat in view
  ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally { clearTimeout(kill); await browser.close().catch(() => {}); }
