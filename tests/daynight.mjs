// Day/night cycle (Order 49): ?time= presets freeze the clock; sun/moon arcs; sky, light, fog, water and grade follow
// the time of day on top of each theme; the clock runs when not frozen. iPad touch viewport.
// Screenshots 90-93. Usage: node tests/daynight.mjs [baseUrl]
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const outDir = new URL('../screenshots/', import.meta.url).pathname;
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = []; const ok = (n, c, x = '') => { results.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
const errFilter = (m) => (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|swiftshader|Automatic fallback/i.test(m.text())));
const frames = (page, n) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const look = () => { const g = window.game, s = g.sun, h = g.hemi, f = g.fogState; const lum = (c) => +(0.3 * c.r + 0.59 * c.g + 0.11 * c.b).toFixed(3);
  return { t: g.time.debug, sunI: +s.intensity.toFixed(3), hemiI: +h.intensity.toFixed(3), fog: lum(f.color), sunCol: [s.color.r, s.color.g, s.color.b].map((v) => +v.toFixed(2)), lightY: +g.time.lightDir.y.toFixed(3), sunDirY: +g.sun.position.clone().sub(g.sun.target.position).normalize().y.toFixed(3), tod: g.todDebug }; };
let ctx;
try {
  ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], deviceScaleFactor: 1, hasTouch: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(240000);
  const errors = []; page.on('console', (m) => { if (errFilter(m)) errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
  const L = {};
  for (const [name, theme] of [['noon', 'spring'], ['dusk', 'spring'], ['night', 'spring'], ['dawn', 'spring'], ['night', 'halloween'], ['noon', 'halloween']]) {
    await page.goto(base + `?webgl&q=low&touch=1&theme=${theme}&time=${name}`); await page.waitForFunction(() => window.game?.ready);
    await page.evaluate(() => { const g = window.game; for (let i = 0; i < 40; i++) g.step(1 / 30); g.rig.pitch = -0.05; g.rig.distance = 12; for (let i = 0; i < 10; i++) g.step(1 / 30); });
    await frames(page, 4);
    L[name + '-' + theme] = await page.evaluate(look);
    console.log(name, theme, JSON.stringify(L[name + '-' + theme]));
    if (theme === 'spring' && name !== 'dawn') await page.screenshot({ path: outDir + `9${['noon', 'dusk', 'night'].indexOf(name)}-ipad-time-${name}.png` });
  }
  const n = L['noon-spring'], d = L['dusk-spring'], ni = L['night-spring'];
  ok('?time=noon frozen at 12:00, full day', n.t.frozen && n.t.hour === 12 && n.t.night === 0 && n.t.sunEl > 0.75, JSON.stringify(n.t));
  ok('?time=night: night, moon up, sun below', ni.t.night > 0.95 && ni.t.moonUp > 0.5 && ni.t.sunEl < -0.3, JSON.stringify(ni.t));
  ok('dusk: twilight band, low sun', d.t.twilight > 0.5 && d.t.sunEl < 0.15 && d.t.sunEl > -0.15, JSON.stringify(d.t));
  ok('night light is dimmer + bluer than noon', ni.sunI < n.sunI * 0.5 && ni.hemiI < n.hemiI * 0.6 && ni.sunCol[2] > ni.sunCol[0]);
  ok('night fog darker than noon', ni.fog < n.fog * 0.5, `${ni.fog} vs ${n.fog}`);
  ok('dusk sun warm (red > blue)', d.sunCol[0] > d.sunCol[2] + 0.2, JSON.stringify(d.sunCol));
  ok('key light never below ~12 deg (shadows sane)', [n, d, ni].every((q) => q.sunDirY >= 0.2));
  ok('theme still layered: Halloween night differs from Spring night', Math.abs(L['night-halloween'].fog - ni.fog) > 0.003 || L['night-halloween'].sunCol.join() !== ni.sunCol.join(), JSON.stringify([L['night-halloween'].fog, ni.fog]));
  ok('Halloween noon keeps its dusky theme sky (day not night)', L['noon-halloween'].t.night === 0);
  // Order 49b: stars + moon at night that fade at dawn; nights dim the fake glows
  const nt = ni.tod, nn = n.tod, dw = L['dawn-spring'].tod;
  ok('night: star field + moon up', nt.stars > 0.95 && nt.moon > 0.9, JSON.stringify(nt));
  ok('noon: no stars, no moon (Spring)', nn.stars === 0 && nn.moon === 0, JSON.stringify(nn));
  ok('dawn: stars fading (between night and day)', dw.stars > 0 && dw.stars < nt.stars * 0.6, JSON.stringify(dw));
  ok('night dims foliage glow + clouds; water and grade go blue', nt.day < 0.3 && nt.cloud < 0.12 && nn.day === 1 && nn.cloud > 0.4 && nt.water !== 'ffffff' && nt.grade !== 'ffffff' && nn.water === 'ffffff', JSON.stringify([nt.water, nt.grade]));
  // Order 49c: night frog chorus + night-only lighthouse beam
  ok('frog chorus loud at night, quiet at noon', nt.chorus > 3 && nn.chorus < 0.2, `${nt.chorus} / ${nn.chorus}`);
  ok('lighthouse beam sweeps at night only', nt.sweeping && nt.beam > 0.2 && !nn.sweeping && nn.beam < 0.01, JSON.stringify([nt.beam, nn.beam]));
  ok('Halloween night: same chorus + beam stronger than Spring', L['night-halloween'].tod.chorus === nt.chorus && L['night-halloween'].tod.beam > nt.beam, JSON.stringify([L['night-halloween'].tod.beam, nt.beam]));
  // the clock runs without ?time=, faster by night; sun arc rises then sets
  await page.goto(base + '?webgl&q=low&touch=1&theme=summer'); await page.waitForFunction(() => window.game?.ready);
  const run = await page.evaluate(() => { const g = window.game, T = g.time, h0 = T.hour; for (let i = 0; i < 300; i++) g.step(1 / 30); const h1 = T.hour;
    const arc = []; for (let h = 0; h < 24; h += 1) { T.set(h, true); arc.push(+T.sunDir.y.toFixed(2)); }
    T.set(23, false); const a = T.hour; for (let i = 0; i < 300; i++) g.step(1 / 30); const nightRate = (T.hour - a);
    T.set(12, false); const b = T.hour; for (let i = 0; i < 300; i++) g.step(1 / 30); const dayRate = (T.hour - b);
    return { h0, h1, arc, nightRate, dayRate, src: T.source }; });
  console.log(JSON.stringify(run));
  ok('starts at 9:00 and the clock runs', run.h0 >= 9 && run.h0 < 9.1 && run.h1 > run.h0 + 0.15, JSON.stringify([run.h0, run.h1]));
  ok('night passes faster than day', run.nightRate > run.dayRate * 1.7, JSON.stringify([run.nightRate, run.dayRate]));
  const up = run.arc.map((y) => y > 0);
  ok('sun up 7:00-17:00, down 19:00-5:00, smooth arc peaking at noon', up.slice(7, 18).every(Boolean) && [19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5].every((h) => !up[h]) && Math.max(...run.arc) === run.arc[12], JSON.stringify(run.arc));
  // 49d: 🕒 dock button (real taps) cycles Live → Dawn → Noon → Dusk → Night → Live
  const tb = page.locator('.dock .time-btn');
  const seen = [];
  for (let k = 0; k < 5; k++) { await tb.tap(); await page.waitForTimeout(150); seen.push(await page.evaluate(() => { const T = window.game.time; return { t: document.querySelector('.dock .time-btn').dataset.t, frozen: T.frozen, hour: +T.hour.toFixed(2), night: +T.night.toFixed(2) }; })); }
  console.log(JSON.stringify(seen));
  ok('time button cycles dawn/noon/dusk/night (frozen) then back to live clock', seen.map((x) => x.t).join() === 'dawn,noon,dusk,night,live' && seen.slice(0, 4).every((x) => x.frozen) && !seen[4].frozen && seen[1].night === 0 && seen[3].night > 0.95, JSON.stringify(seen));
  const box = await tb.boundingBox(), vp = page.viewportSize();
  ok('time button on screen, touch-sized', box && box.width >= 56 && box.x >= 0 && box.x + box.width <= vp.width && box.y >= 0, JSON.stringify(box));
  await tb.tap(); await tb.tap(); await tb.tap(); await tb.tap(); await page.waitForTimeout(300);
  await page.screenshot({ path: outDir + '93-ipad-time-button-night.png' });
  ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally { await ctx?.close().catch(() => {}); await browser.close(); }
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
