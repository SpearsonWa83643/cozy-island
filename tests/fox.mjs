// Foxes in Autumn Grove (Order 32): 3-4 foxes spawn in the Autumn biome, pounce into the leaves when idle, flee then
// return, feeding berries befriends one (follower), the friend close-up screen opens for a fox. iPad touch viewport.
// Screenshots 82/83. Usage: node tests/fox.mjs [baseUrl]
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const outDir = new URL('../screenshots/', import.meta.url).pathname;
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = []; const ok = (n, c, x = '') => { results.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
const errFilter = (m) => (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|swiftshader|Automatic fallback/i.test(m.text())));
const frames = (page, n) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
try {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11'], hasTouch: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(300000);
  const errors = []; page.on('console', (m) => { if (errFilter(m)) errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '?webgl&q=low&touch=1&theme=autumn'); await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForFunction(() => window.game?.ready);
  const info = await page.evaluate(() => { const g = window.game, h = g.fauna.herds.find((q) => q.k.name === 'fox');
    if (!h) return null; return { n: h.agents.length, active: h.active, biomes: h.agents.map((a) => g.terrain.biomeAt ? g.terrain.biomeAt(a.x, a.z) : null), pos: h.agents.map((a) => [+a.x.toFixed(1), +a.z.toFixed(1)]) }; });
  console.log(JSON.stringify(info));
  ok('3-4 foxes spawn (>=3 active on low quality)', info && info.n >= 3 && info.n <= 4 && info.active >= 3, JSON.stringify(info));
  const inGrove = await page.evaluate(() => { const g = window.game, h = g.fauna.herds.find((q) => q.k.name === 'fox');
    const homes = h.agents.map((a) => [a.hx, a.hz]); return homes.map(([x, z]) => { g.player.teleport(x, z, 0); for (let s = 0; s < 90; s++) g.step(1 / 30); let best = 0; for (let i = 1; i < g.biome.length; i++) if (g.biome[i] > g.biome[best]) best = i; return best; }); });
  ok('foxes live in Autumn Grove', inGrove.every((b) => b === 2), JSON.stringify(inGrove));
  // other animals' saved ids unchanged: birds still start right after the original herds
  const ids = await page.evaluate(() => { const g = window.game; return { bird0: g.fauna.birdState[0].id, fox0: g.fauna.herds.find((q) => q.k.name === 'fox').agents[0].id }; });
  ok('existing animal ids unchanged (foxes appended)', ids.fox0 > ids.bird0, JSON.stringify(ids));
  // idle pounces (player far away)
  const pounces = await page.evaluate(() => { const g = window.game, h = g.fauna.herds.find((q) => q.k.name === 'fox'); g.player.teleport(0, 0, 0); for (let i = 0; i < 400; i++) g.step(1 / 30); return h.pounces; });
  ok('foxes pounce into the leaves when idle', pounces >= 1, String(pounces));
  // flee from a running player, then head home
  const flee = await page.evaluate(() => { const g = window.game, h = g.fauna.herds.find((q) => q.k.name === 'fox'), a = h.agents[0];
    a.x = a.hx; a.z = a.hz; a.state = 0; a.timer = 5; g.player.teleport(a.x + 2, a.z + 0.5, 0); for (let i = 0; i < 3; i++) g.step(1 / 30);
    const fled = a.state === 2; g.player.teleport(0, 0, 0); for (let i = 0; i < 900; i++) g.step(1 / 30);
    return { fled, home: +Math.hypot(a.x - a.hx, a.z - a.hz).toFixed(1) }; });
  ok('fox flees, then returns to its grove', flee.fled && flee.home < 12, JSON.stringify(flee));
  // frame the grove for a screenshot
  await page.evaluate(() => { const g = window.game, h = g.fauna.herds.find((q) => q.k.name === 'fox'), a = h.agents[1] ?? h.agents[0];
    for (const b of h.agents) { b.state = 0; b.timer = 99; }
    g.player.teleport(a.x - 3.2, a.z + 2.2, 0); for (let i = 0; i < 4; i++) g.step(1 / 30);
    h.agents.forEach((b, i) => { if (b !== a) { b.x = a.x + 1.2 * Math.cos(i * 2.1); b.z = a.z + 1.2 * Math.sin(i * 2.1); } });
    a.state = 0; a.timer = 99; g.rig.yaw = Math.atan2(g.player.position.x - a.x, g.player.position.z - a.z) - 0.35; g.rig.pitch = 0.3; g.rig.distance = 6.5;
    for (let i = 0; i < 12; i++) g.step(1 / 30); });
  await frames(page, 6); await page.screenshot({ path: outDir + '82-ipad-foxes-autumn-grove.png' }); console.log('saved 82-ipad-foxes-autumn-grove');
  // feed berries → follower
  const fed = await page.evaluate(() => { const g = window.game, d = g.play.save.data; d.food = { ...(d.food || {}), berry: 3 };
    const h = g.fauna.herds.find((q) => q.k.name === 'fox'), a = h.agents[0]; a.x = a.hx; a.z = a.hz;
    g.player.teleport(a.x + 1.2, a.z, 0); g.step(1 / 30); a.x = g.player.position.x - 1.2; a.z = g.player.position.z; a.state = 0; a.timer = 5;
    const an = g.fauna.nearestFeedable(g.player.position.x, g.player.position.z, 2.5);
    if (!an || an.species !== 'fox') return { err: 'no fox feedable', an: an?.species };
    const act = g.play.nearestAction?.() ?? null;
    g.play.feed(an, 'berry', true); for (let i = 0; i < 60; i++) g.step(1 / 30);
    return { friend: a.friend, followers: g.fauna.friends().map((f) => f.species), berries: d.food.berry, label: act?.label ?? null }; });
  ok('feeding a berry befriends a fox (follower)', fed.friend === true && fed.followers.includes('fox'), JSON.stringify(fed));
  // friend close-up screen
  const fs2 = await page.evaluate(async () => { const g = window.game, f = await g.play.ensureFriend(), ref = g.fauna.friends().find((q) => q.species === 'fox'); f.show(ref); for (let i = 0; i < 30; i++) f.update(1 / 30); return { open: f.open, name: document.querySelector('.fs-name')?.textContent ?? '' }; });
  await frames(page, 8); await page.screenshot({ path: outDir + '83-ipad-fox-friend-screen.png' }); console.log('saved 83-ipad-fox-friend-screen');
  ok('friend close-up screen opens for a fox', fs2.open === true && fs2.name.length > 0, JSON.stringify(fs2));
  ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
} finally { await browser.close(); }
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
