// Mountain goats on Alpine Peak (Order 38): 4-5 goats spawn high on Alpine Peak (steep slopes allowed), ledge-hop when
// idle, bleat + skip on tap, flee then return, feeding clover befriends one, friend screen opens. iPad touch viewport.
// Screenshots 84/85. Usage: node tests/goat.mjs [baseUrl]
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
  await page.goto(base + '?webgl&q=low&touch=1&theme=summer'); await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForFunction(() => window.game?.ready);
  const info = await page.evaluate(() => { const g = window.game, h = g.fauna.herds.find((q) => q.k.name === 'goat');
    if (!h) return null; return { n: h.agents.length, active: h.active, biomes: h.agents.map((a) => g.terrain.biomeAt ? g.terrain.biomeAt(a.x, a.z) : null), pos: h.agents.map((a) => [+a.x.toFixed(1), +a.z.toFixed(1)]) }; });
  console.log(JSON.stringify(info));
  ok('4-5 goats spawn (>=3 active on low quality)', info && info.n >= 4 && info.n <= 5 && info.active >= 3, JSON.stringify(info));
  const hs = await page.evaluate(() => { const g = window.game, h = g.fauna.herds.find((q) => q.k.name === 'goat'); for (let i = 0; i < 3; i++) g.step(1 / 30); return h.agents.slice(0, h.active).map((a) => +a.y.toFixed(1)); });
  ok('active goats live high on the slopes (>= 3 m)', hs.length >= 3 && hs.every((y) => y >= 3), JSON.stringify(hs));
  const inGrove = await page.evaluate(() => { const g = window.game, h = g.fauna.herds.find((q) => q.k.name === 'goat');
    const homes = h.agents.map((a) => [a.hx, a.hz]); return homes.map(([x, z]) => { g.player.teleport(x, z, 0); for (let s = 0; s < 90; s++) g.step(1 / 30); let best = 0; for (let i = 1; i < g.biome.length; i++) if (g.biome[i] > g.biome[best]) best = i; return best; }); });
  ok('goats live on Alpine Peak', inGrove.every((b) => b === 1), JSON.stringify(inGrove));
  // other animals' saved ids unchanged: birds still start right after the original herds
  const ids = await page.evaluate(() => { const g = window.game; return { bird0: g.fauna.birdState[0].id, goat0: g.fauna.herds.find((q) => q.k.name === 'goat').agents[0].id }; });
  ok('existing animal ids unchanged (goats appended)', ids.goat0 > ids.bird0, JSON.stringify(ids));
  // idle pounces (player far away)
  const leaps = await page.evaluate(() => { const g = window.game, h = g.fauna.herds.find((q) => q.k.name === 'goat'); g.player.teleport(0, 0, 0); for (let i = 0; i < 500; i++) g.step(1 / 30); return h.leaps; });
  ok('goats ledge-hop when idle', leaps >= 1, String(leaps));
  const tap = await page.evaluate(() => { const g = window.game, h = g.fauna.herds.find((q) => q.k.name === 'goat'), a = h.agents[0]; a.state = 0; g.player.teleport(a.x + 3, a.z, 0); g.step(1 / 30); a.state = 0; const v = new g.player.position.constructor(a.x, a.y + 0.7, a.z); v.project(g.camera); const sx = (v.x * 0.5 + 0.5) * innerWidth, sy = (-v.y * 0.5 + 0.5) * innerHeight; const r = g.play.react.tapAnimal(sx, sy, (p) => g.play.juice.project(p), 70, g.player.position); return { r, state: a.state }; });
  ok('tapping a goat makes it bleat and skip', !!tap.r && tap.state === 2, JSON.stringify(tap));
  // flee from a running player, then head home
  const flee = await page.evaluate(() => { const g = window.game, h = g.fauna.herds.find((q) => q.k.name === 'goat'), a = h.agents[0];
    a.x = a.hx; a.z = a.hz; a.state = 0; a.timer = 5; g.player.teleport(a.x + 2, a.z + 0.5, 0); for (let i = 0; i < 3; i++) g.step(1 / 30);
    const fled = a.state === 2; g.player.teleport(0, 0, 0); for (let i = 0; i < 900; i++) g.step(1 / 30);
    return { fled, home: +Math.hypot(a.x - a.hx, a.z - a.hz).toFixed(1) }; });
  ok('goat flees, then returns to its peak', flee.fled && flee.home < 12, JSON.stringify(flee));
  // frame the grove for a screenshot
  await page.evaluate(() => { const g = window.game, h = g.fauna.herds.find((q) => q.k.name === 'goat'), a = h.agents[1] ?? h.agents[0];
    for (const b of h.agents) { b.state = 0; b.timer = 99; }
    g.player.teleport(a.x - 3.2, a.z + 2.2, 0); for (let i = 0; i < 4; i++) g.step(1 / 30);
    h.agents.forEach((b, i) => { if (b !== a) { b.x = a.x + 1.2 * Math.cos(i * 2.1); b.z = a.z + 1.2 * Math.sin(i * 2.1); } });
    a.state = 0; a.timer = 99; g.rig.yaw = Math.atan2(g.player.position.x - a.x, g.player.position.z - a.z) - 0.35; g.rig.pitch = 0.3; g.rig.distance = 6.5;
    for (let i = 0; i < 12; i++) g.step(1 / 30); });
  await frames(page, 6); await page.screenshot({ path: outDir + '84-ipad-goats-alpine-peak.png' }); console.log('saved 84-ipad-goats-alpine-peak');
  // feed berries → follower
  const fed = await page.evaluate(() => { const g = window.game, d = g.play.save.data; d.food = { ...(d.food || {}), clover: 3 };
    const h = g.fauna.herds.find((q) => q.k.name === 'goat'), a = h.agents[0]; a.x = a.hx; a.z = a.hz;
    g.player.teleport(a.x + 1.2, a.z, 0); g.step(1 / 30); a.x = g.player.position.x - 1.2; a.z = g.player.position.z; a.state = 0; a.timer = 5;
    const an = g.fauna.nearestFeedable(g.player.position.x, g.player.position.z, 2.5);
    if (!an || an.species !== 'goat') return { err: 'no goat feedable', an: an?.species };
    const act = g.play.nearestAction?.() ?? null;
    g.play.feed(an, 'clover', true); for (let i = 0; i < 60; i++) g.step(1 / 30);
    return { friend: a.friend, followers: g.fauna.friends().map((f) => f.species), clover: d.food.clover, label: act?.label ?? null }; });
  ok('feeding clover befriends a goat (follower)', fed.friend === true && fed.followers.includes('goat'), JSON.stringify(fed));
  // friend close-up screen
  const fs2 = await page.evaluate(async () => { const g = window.game, f = await g.play.ensureFriend(), ref = g.fauna.friends().find((q) => q.species === 'goat'); f.show(ref); for (let i = 0; i < 30; i++) f.update(1 / 30); return { open: f.open, name: document.querySelector('.fs-name')?.textContent ?? '' }; });
  await frames(page, 8); await page.screenshot({ path: outDir + '85-ipad-goat-friend-screen.png' }); console.log('saved 85-ipad-goat-friend-screen');
  ok('friend close-up screen opens for a goat', fs2.open === true && fs2.name.length > 0, JSON.stringify(fs2));
  ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
} finally { await browser.close(); }
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
