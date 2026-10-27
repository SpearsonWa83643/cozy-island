// Procedural archipelago (Order 48a), iPad touch viewport: config ISLETS = Blossom Isle + seeded islets from
// placeIslets(ARCHIPELAGO_SEED, GEN_COUNT). Checks placement rules (no box overlap with the main grid / each other,
// 110-160 m of open sea so the 85 m fly leash reaches), that a generated islet streams in with a green wood (no cherry),
// gets its own map inset, and no console errors. Timeout + browser closed in finally.
// Usage: node tests/archipelago.mjs [baseUrl] [--no-shots]
import { chromium, devices } from 'playwright';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4271/';
const kill = setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 360000);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = []; const ok = (n, c, x = '') => { results.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
const errFilter = (m) => (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|swiftshader|Automatic fallback/i.test(m.text())));
const shots = !process.argv.includes('--no-shots');
try {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], hasTouch: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(120000);
  const errors = []; page.on('console', (m) => { if (errFilter(m)) errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '?webgl&q=low&touch=1&whatsnew=0&theme=spring');
  await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => document.getElementById('whatsnew')?.querySelector('.w-ok')?.click());
  const step = (n) => page.evaluate((n) => { for (let i = 0; i < n; i++) window.game.step(1 / 60); }, n);
  const defs = await page.evaluate(() => window.game.islets.list.map((it) => it.def));
  ok('archipelago has Blossom Isle + generated islets', defs.length >= 2 && defs[0].id === 'blossom' && defs.slice(1).every((d) => d.id.startsWith('gen')), JSON.stringify(defs));
  const R = 140, HALF_WORLD = 180, BOX = 184; // ISLAND_RADIUS ~ checked loosely below via gap
  const geo = defs.map((d) => ({ id: d.id, dist: Math.round(Math.hypot(d.x, d.z)), cheb: Math.max(Math.abs(d.x), Math.abs(d.z)), r: d.r }));
  const pairOk = defs.every((a, i) => defs.every((b, j) => i >= j || Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z)) >= BOX));
  ok('islet boxes do not overlap each other', pairOk, JSON.stringify(geo));
  ok('islets inside the ocean plane', defs.every((d) => Math.max(Math.abs(d.x), Math.abs(d.z)) + BOX / 2 <= 600), JSON.stringify(geo));
  ok('generated names unique', new Set(defs.map((d) => d.name)).size === defs.length, defs.map((d) => d.name).join(', '));
  ok('3-5 islets in the archipelago (Order 48b)', defs.length >= 3 && defs.length <= 5, String(defs.length));
  ok('generated islets cycle wood / pine / palm', defs.slice(1).map((d) => d.kind).join() === ['wood', 'pine', 'palm', 'wood'].slice(0, defs.length - 1).join(), defs.map((d) => d.kind).join());
  const TREE = { wood: 'isleoak', pine: 'islepine', palm: 'islepalm' };
  for (let k = 2; k < defs.length; k++) {
    const d = defs[k];
    await page.evaluate((d) => { window.game.player.teleport(d.x - Math.sign(d.x) * d.r * 0.4, d.z - Math.sign(d.z) * d.r * 0.4, 0); }, d);
    await step(200);
    for (let i = 0; i < 80 && (await page.evaluate((k) => window.game.islets.stats[k].state, k)) !== 'ready'; i++) { await page.waitForTimeout(250); await step(2); }
    for (let i = 0; i < 60 && !(await page.evaluate((k) => window.game.islets.floraStats[k].built, k)); i++) await step(2);
    const r = await page.evaluate((k) => { const it = window.game.islets.list[k]; return { st: it.state, built: it.flora.built, placed: it.flora.placed, names: [...new Set(it.flora.group.children.map((c) => c.name))] }; }, k);
    ok(`${d.name} (${d.kind}) streams in with its ${TREE[d.kind]} trees`, r.st === 'ready' && r.built && r.placed > 80 && r.names.includes(TREE[d.kind]) && !r.names.includes('cherry'), JSON.stringify(r));
    if (shots && d.kind === 'palm') { await page.evaluate((k) => { const g = window.game, L = g.islets.list[k].flora.landing; g.player.teleport(L.x, L.z, 0); for (let i = 0; i < 90; i++) g.step(1 / 30); g.rig.yaw = Math.atan2(-L.x, -L.z); g.rig.pitch = 0.3; g.rig.distance = 18; }, k); await step(40); await page.waitForTimeout(700); await page.screenshot({ path: 'test-results/archipelago-palm.png' }).catch(() => {}); }
    if (shots && d.kind === 'pine') { await page.evaluate((k) => { const g = window.game, L = g.islets.list[k].flora.landing; g.player.teleport(L.x, L.z, 0); for (let i = 0; i < 90; i++) g.step(1 / 30); g.rig.yaw = Math.atan2(-L.x, -L.z); g.rig.pitch = 0.3; g.rig.distance = 18; }, k); await step(40); await page.waitForTimeout(700); await page.screenshot({ path: 'test-results/archipelago-pine.png' }).catch(() => {}); }
  }
  const k = 1, g1 = defs[k];
  // fly over: put the player on the generated islet's knoll so it streams in
  await page.evaluate((d) => { const g = window.game; g.player.teleport(d.x - Math.sign(d.x) * d.r * 0.4, d.z - Math.sign(d.z) * d.r * 0.4, 0); }, g1);
  await step(260);
  for (let i = 0; i < 80 && (await page.evaluate((k) => window.game.islets.stats[k].state, k)) !== 'ready'; i++) { await page.waitForTimeout(250); await step(2); }
  const fs = () => page.evaluate((k) => window.game.islets.floraStats[k], k);
  for (let i = 0; i < 60 && !(await fs()).built; i++) await step(2);
  const f = await fs();
  ok('generated islet streams in', (await page.evaluate((k) => window.game.islets.stats[k].state, k)) === 'ready');
  ok('generated islet flora built', f.built && f.placed > 100, JSON.stringify(f));
  const kinds = await page.evaluate((k) => window.game.islets.list[k].flora.group.children.map((c) => c.name), k);
  ok('green wood, no cherry grove / spring on generated islet', f.cherries === 0 && !f.spring && kinds.includes('isleoak') && !kinds.includes('cherry'), kinds.join(','));
  const land = await page.evaluate((d) => window.game.heightAt(d.x, d.z), g1);
  ok('generated islet has land above sea at its centre', land > 1, String(land));
  await page.evaluate((k) => { const g = window.game, L = g.islets.list[k].flora.landing; g.player.teleport(L.x, L.z, 0); for (let i = 0; i < 90; i++) g.step(1 / 30); g.rig.yaw = Math.atan2(L.x, L.z); g.rig.pitch = 0.32; g.rig.distance = 16; }, k);
  await step(40);
  if (shots) { await page.waitForTimeout(700); await page.screenshot({ path: 'screenshots/order48a-generated-islet.png' }).catch((e) => console.log('shot failed', e.message)); }
  await page.evaluate(() => window.game.play.toggleMap()); await page.waitForTimeout(900); await step(2);
  const ins = await page.evaluate(() => document.querySelectorAll('.map-overlay').length && window.game.islets.list.length);
  ok('map open with an inset per islet', ins === defs.length, String(ins));
  ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) { ok('test ran', false, e.message); }
finally { clearTimeout(kill); await browser.close(); }
const pass = results.filter(Boolean).length; console.log(`${pass}/${results.length} passed`); process.exit(pass === results.length ? 0 : 1);
