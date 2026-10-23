// Height fog + aerial perspective per theme (Order 33). From mount-like altitude in all 5 themes (WebGL2 backend,
// iPad touch viewport): the TSL fog node is installed, per-theme haze colour/strength applied, the cave turns it off,
// frame time is not worse than plain range fog. Screenshots 84-88. Usage: node tests/haze.mjs [baseUrl]
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const outDir = new URL('../screenshots/', import.meta.url).pathname;
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = []; const ok = (n, c, x = '') => { results.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
const errFilter = (m) => (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|swiftshader|Automatic fallback/i.test(m.text())));
const frames = (page, n) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const timeFrames = (page, n) => page.evaluate((n) => new Promise((r) => { let k = 0; const t0 = performance.now(); const f = () => (++k >= n ? r((performance.now() - t0) / n) : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
try {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11'], hasTouch: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(300000);
  const errors = []; page.on('console', (m) => { if (errFilter(m)) errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '?webgl&q=low&touch=1'); await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForFunction(() => window.game?.ready);
  const installed = await page.evaluate(() => !!window.game.scene.fogNode && window.game.scene.fogNode === window.game.atmos.node);
  ok('TSL height-fog node installed (WebGL2 backend)', installed);
  // aerial view over the island
  await page.evaluate(() => { const g = window.game; g.player.teleport(-6, 18, Math.PI); for (let i = 0; i < 4; i++) g.step(1 / 30); g.rig.pitch = 0.5; g.rig.distance = 26; g.rig.yaw = Math.PI * 0.15; });
  const looks = {};
  let n = 84;
  const ALL = ['spring', 'summer', 'autumn', 'winter', 'halloween'];
  const THEMES = (process.env.HAZE_THEMES ?? 'spring,summer,autumn,winter,halloween').split(',');
  for (const id of THEMES) {
    n = 84 + ALL.indexOf(id);
    await page.goto(base + `?webgl&q=low&touch=1&nonews&theme=${id}`); await page.waitForFunction(() => window.game?.ready);
    await page.evaluate(() => { const g = window.game; g.player.teleport(-6, 18, Math.PI); g.rig.yaw = Math.PI * 0.15; });
    await page.evaluate((id) => { const g = window.game; for (let i = 0; i < 150; i++) g.step(1 / 30); g.rig.pitch = 0.5; g.rig.distance = 26; for (let i = 0; i < 5; i++) g.step(1 / 30); }, id);
    await frames(page, 6);
    looks[id] = await page.evaluate(() => window.game.atmos.debug);
    await page.screenshot({ path: outDir + `${n}-ipad-haze-${id}.png` }); console.log('saved', `${n}-ipad-haze-${id}`, JSON.stringify(looks[id])); n++;
  }
  if (THEMES.length === 5) {
  const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
  const [ar, , ab] = hex(looks.autumn.haze), [wr, , wb] = hex(looks.winter.haze), [hr, hg, hb] = hex(looks.halloween.haze);
  ok('warm haze in Autumn, cool in Winter, purple in Halloween', ar > ab && wb > wr && hb > hg && hr > hg, JSON.stringify({ a: looks.autumn.haze, w: looks.winter.haze, h: looks.halloween.haze }));
  ok('height fog thicker in Halloween/Winter than Summer', looks.halloween.height > looks.summer.height && looks.winter.height > looks.summer.height);
  }
  // cost: fog node vs plain range fog (swiftshader is CPU-bound, so this mostly guards against something pathological)
  const tHaze = await timeFrames(page, 12);
  await page.evaluate(() => { window.game.scene.fogNode = null; }); await frames(page, 5);
  const tPlain = await timeFrames(page, 12);
  await page.evaluate(() => { window.game.scene.fogNode = window.game.atmos.node; }); await frames(page, 5);
  ok('no frame-time regression vs plain fog (within 15%)', tHaze < tPlain * 1.15 + 2, JSON.stringify({ haze: +tHaze.toFixed(1), plain: +tPlain.toFixed(1) }));
  // inside the cave the haze switches off
  const cave = await page.evaluate(() => { const g = window.game; g.caveK = 1; for (let i = 0; i < 120; i++) { g.caveK = 1; g.atmos.under = 1; g.atmos.update(1 / 30); } return g.atmos.debug; });
  ok('haze fades out underground', cave.aerial < 0.05 && cave.height < 0.05, JSON.stringify(cave));
  ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
} finally { await browser.close(); }
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
