// Weather (Order 50): ?weather= pins clear/rain/snow; showers grey the sky, pull the fog in and dim the sun;
// winter showers fall as snow; caves are dry; without ?weather= the cycle starts clear then a shower builds in.
// iPad touch viewport. Screenshots 94-97. Usage: node tests/weather.mjs [baseUrl]
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const outDir = new URL('../screenshots/', import.meta.url).pathname;
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const results = []; const ok = (n, c, x = '') => { results.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
const errFilter = (m) => (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|swiftshader|Automatic fallback/i.test(m.text())));
const frames = (page, n) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
let ctx;
try {
  ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], deviceScaleFactor: 1, hasTouch: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(240000);
  const errors = []; page.on('console', (m) => { if (errFilter(m)) errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
  const L = {};
  const open = async (q) => { await page.goto(base + `?webgl&q=low&touch=1&${q.includes('time=') ? '' : 'time=noon&'}${q}`); await page.waitForFunction(() => window.game?.ready);
    await page.evaluate(() => { const g = window.game; for (let i = 0; i < 40; i++) g.step(1 / 30); g.rig.pitch = -0.05; g.rig.distance = 12; for (let i = 0; i < 10; i++) g.step(1 / 30); });
    await frames(page, 4); return page.evaluate(() => window.game.weatherDebug); };
  for (const [name, q] of [['clear', 'theme=spring&weather=clear'], ['rain', 'theme=spring&weather=rain'], ['snow', 'theme=spring&weather=snow'], ['winter', 'theme=winter&weather=rain'], ['halloween', 'theme=halloween&weather=rain'], ['rainbow', 'theme=spring&weather=rainbow'], ['bownight', 'theme=spring&weather=rainbow&time=night']]) {
    L[name] = await open(q); console.log(name, JSON.stringify(L[name]));
    if (name === 'rain') { await page.screenshot({ path: outDir + '94-ipad-weather-rain.png' });
      // caves are dry
      L.cave = await page.evaluate(() => { const g = window.game; g.setCave(true); for (let i = 0; i < 60; i++) g.step(1 / 30); const inn = g.weatherDebug; g.setCave(false); for (let i = 0; i < 60; i++) g.step(1 / 30); return { inn, out: g.weatherDebug }; });
      // 50b: rain soundscape layer (tap unlocks audio)
      await page.touchscreen.tap(512, 300); await page.waitForFunction(() => window.game.audio.started, null, { timeout: 15000 }); await page.waitForTimeout(4000);
      L.rainAudio = await page.evaluate(() => { const a = window.game.audio; return { rain: +a.bedLevel('rain').toFixed(4), low: +a.bedLevel('rainlow').toFixed(4), plinks: a.plinks, amt: a.rainAmt }; }); }
    if (name === 'clear') { await page.touchscreen.tap(512, 300); await page.waitForFunction(() => window.game.audio.started, null, { timeout: 15000 }); await page.waitForTimeout(2500);
      L.clearAudio = await page.evaluate(() => { const a = window.game.audio; return { rain: a.bedLevel('rain'), low: a.bedLevel('rainlow'), plinks: a.plinks }; }); }
    if (name === 'winter') await page.screenshot({ path: outDir + '95-ipad-weather-snow.png' });
    if (name === 'halloween') await page.screenshot({ path: outDir + '96-ipad-weather-halloween.png' });
    if (name === 'rainbow') { await page.evaluate(() => { const g = window.game, d = g.rainbow.mesh.position.clone().sub(g.camera.position); g.rig.yaw = Math.atan2(-d.x, -d.z); g.rig.pitch = 0.05; g.rig.distance = 10; for (let i = 0; i < 20; i++) g.step(1 / 30); });
      await frames(page, 4); L.rainbowView = await page.evaluate(() => { const g = window.game, d = g.rainbow.mesh.position.clone().sub(g.camera.position).normalize(), f = new g.camera.position.constructor(); g.camera.getWorldDirection(f); return +d.dot(f).toFixed(3); });
      await page.screenshot({ path: outDir + '97-ipad-weather-rainbow.png' }); }
  }
  const c = L.clear, r = L.rain, s = L.snow, w = L.winter;
  ok('?weather=clear: pinned, nothing falling', c.frozen && c.amount === 0 && !c.rainVisible && !c.snowVisible, JSON.stringify(c));
  ok('?weather=rain: full rain, rain drawn, no snowfall', r.frozen && r.rain === 1 && r.snow === 0 && r.rainVisible && !r.snowVisible);
  ok('rain dims the sun and pulls the fog in', r.sunI < c.sunI * 0.6 && r.fogFar < c.fogFar * 0.75, `${r.sunI}/${c.sunI} ${r.fogFar}/${c.fogFar}`);
  ok('rain greys the sky', r.zenith !== c.zenith, `${r.zenith} vs ${c.zenith}`);
  ok('?weather=snow: snowfall drawn, no rain', s.snow === 1 && s.rain === 0 && s.snowVisible && !s.rainVisible);
  ok('winter theme: a shower falls as snow', w.snowy && w.snow === 1 && w.rain === 0 && w.snowVisible && !w.rainVisible, JSON.stringify(w));
  const cave = L.cave;
  // 50c ripples, 50d rainbow, 50e Halloween drizzle
  ok('rain ripples on the water while it rains, calm when clear', r.water === 1 && c.water === 0 && L.winter.water === 0, JSON.stringify([r.water, c.water, L.winter.water]));
  ok('Halloween: violet drizzle + violet overcast, other themes plain', L.halloween.rainCol === 'c2a8ee' && r.rainCol === 'cbd6e6' && L.halloween.zenith !== r.zenith, JSON.stringify([L.halloween.rainCol, r.rainCol]));
  ok('?weather=rainbow: rainbow shown by day, one mesh', L.rainbow.bowVisible && L.rainbow.bow > 0.9 && L.rainbow.amount === 0, JSON.stringify(L.rainbow));
  ok('rainbow sits opposite the sun (in view when you face away from it)', L.rainbowView > 0.5, String(L.rainbowView));
  ok('no rainbow at night', !L.bownight.bowVisible, JSON.stringify(L.bownight));
  ok('no rainbow while raining or clear', !r.bowVisible && !c.bowVisible);
  ok('rain soundscape: hiss + drumming beds and drop plinks while it rains', L.rainAudio.rain > 0.03 && L.rainAudio.low > 0.02 && L.rainAudio.plinks >= 2 && L.rainAudio.amt === 1, JSON.stringify(L.rainAudio));
  ok('clear weather: rain beds silent, no plinks', L.clearAudio.rain === 0 && L.clearAudio.low === 0 && L.clearAudio.plinks === 0, JSON.stringify(L.clearAudio));
  ok('no rain inside the cave, back when you leave', !cave.inn.rainVisible && cave.inn.shelter > 0.95 && cave.out.rainVisible, JSON.stringify([cave.inn.shelter, cave.out.shelter]));
  // the live cycle: a visit starts clear, then a shower eases in (~12 s) and eases out (~16 s)
  await page.goto(base + '?webgl&q=low&touch=1&theme=spring&time=noon'); await page.waitForFunction(() => window.game?.ready);
  const cyc = await page.evaluate(() => { const g = window.game, W = g.weather, a0 = W.amount, k0 = W.kind, left0 = W.left;
    W.left = 0; g.step(1 / 30); const k1 = W.kind; for (let i = 0; i < 30 * 6; i++) g.step(1 / 30); const half = W.amount;
    for (let i = 0; i < 30 * 8; i++) g.step(1 / 30); const full = W.amount;
    W.left = 0; for (let i = 0; i < 30 * 20; i++) g.step(1 / 30); const bow = g.weatherDebug;
    for (let i = 0; i < 30 * 80; i++) g.step(1 / 30); const bowEnd = g.weatherDebug;
    return { a0, k0, left0, k1, half, full, end: W.amount, k2: W.kind, src: W.source, bow: bow.bow, bowVis: bow.bowVisible, bowEnd: bowEnd.bow, bowEndVis: bowEnd.bowVisible }; });
  console.log(JSON.stringify(cyc));
  ok('visit starts clear for 2-4 min', cyc.k0 === 'clear' && cyc.a0 === 0 && cyc.left0 >= 115 && cyc.left0 <= 245 && cyc.src === 'cycle', JSON.stringify(cyc));
  ok('a shower eases in (~12 s) and clears softly (~16 s)', cyc.k1 === 'rain' && cyc.half > 0.35 && cyc.half < 0.65 && cyc.full === 1 && cyc.k2 === 'clear' && cyc.end < 0.01, JSON.stringify(cyc));
  ok('a rainbow appears after the shower clears (noon), then fades', cyc.bow > 0.9 && cyc.bowVis && cyc.bowEnd === 0 && !cyc.bowEndVis, JSON.stringify(cyc));
  ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally { await ctx?.close().catch(() => {}); await browser.close(); }
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
