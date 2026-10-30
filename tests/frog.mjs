// Frogs + lily pads in Misty Marsh (Order 43): frogs spawn around the pond, sit on floating lily pads (above the water),
// hop between pads and the shore, croak, startle + hop away on tap, eat a beetle to befriend, friend screen opens, and
// re-skin per theme. iPad touch viewport. Screenshots screenshots/order43-*.png. Usage: node tests/frog.mjs [baseUrl]
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4193/';
const outDir = new URL('../screenshots/', import.meta.url).pathname;
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = []; const ok = (n, c, x = '') => { results.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
const errFilter = (m) => (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|swiftshader|Automatic fallback/i.test(m.text())));
const frames = (page, n) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const H = "window.game.fauna.herds.find((q) => q.k.name === 'frog')";
try {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11'], hasTouch: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(300000);
  const errors = []; page.on('console', (m) => { if (errFilter(m)) errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '?webgl&q=low&touch=1&theme=summer'); await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => document.getElementById('whatsnew')?.remove());
  const info = await page.evaluate((H) => { const h = eval(H); if (!h) return null;
    const P = h.k.pads; return { n: h.agents.length, active: h.active, pads: P.length, onPadOrShore: h.agents.every((a) => h.padAt(a.x, a.z) >= 0 || h.valid(a.x, a.z)), pos: h.agents.map((a) => [+a.x.toFixed(1), +a.z.toFixed(1)]) }; }, H);
  console.log(JSON.stringify(info));
  ok('6-7 frogs spawn by the marsh pond (>=4 active on low)', info && info.n >= 6 && info.active >= 4, JSON.stringify(info));
  ok('lily pads float on the pond (>= 10 pads known to the frogs)', info && info.pads >= 10, String(info?.pads));
  ok('frogs start on a pad or the shore', info && info.onPadOrShore);
  const ids = await page.evaluate((H) => { const g = window.game; return { goat0: g.fauna.herds.find((q) => q.k.name === 'goat').agents.at(-1).id, frog0: eval(H).agents[0].id }; }, H);
  ok('existing animal ids unchanged (frogs appended)', ids.frog0 > ids.goat0, JSON.stringify(ids));
  // idle life with the player far away: hops, pad landings, croaks; never ends up in open water
  const life = await page.evaluate((H) => { const g = window.game, h = eval(H); g.player.teleport(0, 0, 0);
    let minY = 9; for (let i = 0; i < 1500; i++) { g.step(1 / 30); for (let j = 0; j < h.active; j++) { const a = h.agents[j]; if ((a.jt ?? -1) < 0 && !a.friend) minY = Math.min(minY, a.y); } }
    const inWater = h.agents.slice(0, h.active).filter((a) => (a.jt ?? -1) < 0 && h.padAt(a.x, a.z) < 0 && a.y < 0.04).length;
    return { hops: h.hops, padHops: h.padHops, croaks: h.croaks, inWater, minY: +minY.toFixed(3) }; }, H);
  ok('frogs hop around when idle', life.hops >= 5, JSON.stringify(life));
  ok('frogs land on lily pads', life.padHops >= 1, JSON.stringify(life));
  ok('frogs croak', life.croaks >= 1, JSON.stringify(life));
  ok('resting frogs sit on a pad or dry shore, never sunk in open water', life.inWater === 0 && life.minY > 0.02, JSON.stringify(life));
  // sitting on a pad: frog y sits just above the water
  const padY = await page.evaluate((H) => { const g = window.game, h = eval(H), a = h.agents[0], p = h.k.pads[0]; a.x = p.x; a.z = p.z; a.jt = -1; a.state = 0; a.timer = 99; g.step(1 / 30); return +a.y.toFixed(3); }, H);
  ok('a frog on a lily pad sits on top of it (y ~0.09)', padY > 0.06 && padY < 0.2, String(padY));
  // tap: startled hop away
  const tap = await page.evaluate((H) => { const g = window.game, h = eval(H), a = h.agents[1]; a.state = 0; a.timer = 99; a.jt = -1;
    g.player.teleport(a.x + 3, a.z, 0); g.step(1 / 30); a.state = 0; a.timer = 99;
    g.rig.yaw = Math.atan2(3, 0); g.rig.pitch = 0.45; g.rig.distance = 6; for (let i = 0; i < 6; i++) g.step(1 / 30); a.state = 0; a.timer = 99; a.jt = -1; const hops0 = h.hops;
    const s0 = g.play.juice.project(new g.player.position.constructor(a.x, a.y + 0.2, a.z)), sx = s0.x, sy = s0.y;
    const r = g.play.react.tapAnimal(sx, sy, (p) => g.play.juice.project(p), 70, g.player.position); const st = a.state;
    for (let i = 0; i < 30; i++) g.step(1 / 30); return { r: !!r, sp: r?.species ?? r, state: st, hopped: h.hops - hops0 }; }, H);
  ok('tapping a frog startles it into hopping away', tap.r && tap.state === 2 && tap.hopped >= 1, JSON.stringify(tap));
  // screenshot: frogs on the lily pads
  await page.evaluate((H) => { const g = window.game, h = eval(H), P = h.k.pads;
    const c = P.reduce((s, p) => ({ x: s.x + p.x / P.length, z: s.z + p.z / P.length }), { x: 0, z: 0 });
    const near = [...P].sort((p, q) => Math.hypot(p.x - c.x, p.z - c.z) - Math.hypot(q.x - c.x, q.z - c.z));
    h.agents.forEach((a, i) => { const p = near[i % near.length]; a.x = p.x; a.z = p.z; a.jt = -1; a.state = 0; a.timer = 99; a.yaw = i * 1.3; });
    const p0 = near[0]; let sx = p0.x, sz = p0.z; for (let r = 2; r < 14; r += 0.5) { const tx = p0.x + r, tz = p0.z + r * 0.4; if (h.valid(tx, tz) && h.padAt(tx, tz) < 0) { sx = tx; sz = tz; break; } }
    g.player.teleport(sx, sz, 0); for (let i = 0; i < 4; i++) g.step(1 / 30);
    h.agents.forEach((a, i) => { a.state = 0; a.timer = 99; }); h.k.fleeDist = 0;
    g.rig.yaw = Math.atan2(sx - p0.x, sz - p0.z); g.rig.pitch = 0.42; g.rig.distance = 5.5; for (let i = 0; i < 14; i++) g.step(1 / 30); }, H);
  await frames(page, 6); await page.screenshot({ path: outDir + 'order43-frogs-lily-pads.png' }); console.log('saved order43-frogs-lily-pads');
  // theme-aware skins: halloween recolours frogs
  const skin = await page.evaluate(async (H) => { const g = window.game, h = eval(H), col = () => Array.from(h.mesh.instanceColor.array.slice(0, 3)).map((x) => +x.toFixed(2));
    const summer = col(); g.themes.set('halloween'); for (let i = 0; i < 3; i++) g.step(1 / 30); const hw = col(), chHw = h.chorus; g.themes.set('summer'); for (let i = 0; i < 3; i++) g.step(1 / 30); return { summer, hw, back: col(), chHw, chSummer: h.chorus }; }, H);
  ok('frog skins change with the theme (halloween) and back', skin.summer.join() !== skin.hw.join() && skin.back.join() === skin.summer.join(), JSON.stringify(skin));
  // Order 49c: the chorus follows the clock (night) in every theme, not the theme
  const ch = await page.evaluate((H) => { const g = window.game, h = eval(H), T = g.time, out = {};
    for (const th of ['summer', 'halloween']) { g.themes.set(th); for (const tm of ['noon', 'night']) { T.set(tm, true); for (let i = 0; i < 3; i++) g.step(1 / 30); out[th + '-' + tm] = h.chorus; } }
    g.themes.set('summer'); T.set('noon', true); g.step(1 / 30); return out; }, H);
  ok('night frog chorus in every theme, quiet by day', ch['summer-night'] > ch['summer-noon'] * 10 && ch['halloween-night'] > ch['halloween-noon'] * 10 && ch['summer-night'] === ch['halloween-night'] && ch['summer-noon'] < 0.3, JSON.stringify(ch));
  // feed a beetle -> follower
  const fed = await page.evaluate((H) => { const g = window.game, d = g.play.save.data; d.food = { ...(d.food || {}), bug: 3 }; const h = eval(H); h.k.fleeDist = 2.2;
    const a = h.agents[0]; let sx = a.x, sz = a.z; for (let r = 1; r < 10; r += 0.4) { if (h.valid(a.x + r, a.z) && h.padAt(a.x + r, a.z) < 0) { sx = a.x + r; sz = a.z; break; } }
    g.player.teleport(sx, sz, 0); g.step(1 / 30); a.x = g.player.position.x - 1.0; a.z = g.player.position.z; a.jt = -1; a.state = 0; a.timer = 5;
    const an = g.fauna.nearestFeedable(g.player.position.x, g.player.position.z, 2.5);
    if (!an || an.species !== 'frog') return { err: 'no frog feedable', an: an?.species };
    g.play.feed(an, 'bug', true); for (let i = 0; i < 60; i++) g.step(1 / 30);
    return { friend: a.friend, followers: g.fauna.friends().map((f) => f.species), bug: d.food.bug }; }, H);
  ok('feeding a beetle befriends a frog (follower)', fed.friend === true && fed.followers.includes('frog'), JSON.stringify(fed));
  const fs2 = await page.evaluate(async () => { const g = window.game, f = await g.play.ensureFriend(), ref = g.fauna.friends().find((q) => q.species === 'frog'); f.show(ref); for (let i = 0; i < 30; i++) f.update(1 / 30); return { open: f.open, name: document.querySelector('.fs-name')?.textContent ?? '' }; });
  await frames(page, 8); await page.screenshot({ path: outDir + 'order43-frog-friend-screen.png' }); console.log('saved order43-frog-friend-screen');
  ok('friend close-up screen opens for a frog', fs2.open === true && fs2.name.length > 0, JSON.stringify(fs2));
  ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
} finally { await browser.close(); }
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
