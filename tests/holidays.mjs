// Holidays: New Year (fireworks + sky lanterns), Valentine's (heart balloons, heart fireworks), Easter (egg hunt, movable date).
// Usage: node tests/holidays.mjs [baseUrl] [--ipad]. Screenshots 64-66.
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const outDir = new URL('../screenshots/', import.meta.url).pathname; fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const __closeBrowser = async (code) => { try { await browser.close(); } catch { /* ignore */ } process.exit(code); };
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => __closeBrowser(130));
process.on('uncaughtException', (e) => { console.error(e); __closeBrowser(1); });
process.on('unhandledRejection', (e) => { console.error(e); __closeBrowser(1); });
const results = []; const ok = (n, c, x = '') => { results.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
const errFilter = (m) => (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|swiftshader|Automatic fallback/i.test(m.text())));
const frames = (page, n) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const shot = async (page, n) => { await frames(page, 3); await page.screenshot({ path: outDir + n + '.png' }); console.log('saved', n); };
const ipad = process.argv.includes('--ipad');
const ctx = await browser.newContext(ipad ? { ...devices['iPad Pro 11'], hasTouch: true } : { viewport: { width: 1280, height: 800 } });
const q = ipad ? 'low' : 'high', label = ipad ? 'ipad' : 'desktop';
const page = await ctx.newPage(); page.setDefaultTimeout(300000);
const errors = []; page.on('console', (m) => { if (errFilter(m)) errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
const open = async (th) => { await page.goto(base + `?webgl&q=${q}&nonews&theme=${th}`); await page.waitForFunction(() => window.game?.ready); };
const view = (dz = 10, dy = 6) => page.evaluate(([dz, dy]) => {
  const g = window.game, c = g.dress.patch; g.player.teleport(c.x + 2, c.z + 6, Math.PI);
  for (let i = 0; i < 6; i++) g.step(1 / 30);
  const py = g.player.position.y; g.rig.locked = true;
  g.camera.position.set(c.x + 2, py + dy, c.z + dz); g.camera.lookAt(c.x, py + 1 + dy * 0.4, c.z); g.camera.updateMatrixWorld();
}, [dz, dy]);
try {
  await open('spring');
  const dates = await page.evaluate(() => ['2026-12-31', '2027-01-01', '2027-01-03', '2026-02-12', '2026-02-15', '2026-04-02', '2026-04-07', '2027-03-25', '2027-03-30', '2026-12-26']
    .map((d) => window.game.themes.forDate(d)).join());
  ok(`${label}: holiday date windows`, dates === 'newyear,newyear,winter,valentine,winter,easter,spring,easter,spring,christmas', dates);
  // New Year
  await open('newyear');
  let s = await page.evaluate(() => { const g = window.game; for (let i = 0; i < 150; i++) g.step(1 / 30); return { id: g.themes.current().id, fw: g.dress.fireworks, sparks: g.dress.fw.length, react: g.dress.reactables.length }; });
  ok(`${label}: new year fireworks launch + burst`, s.id === 'newyear' && s.fw >= 2 && s.react > 0, JSON.stringify(s));
  await view(12, 4);
  await page.evaluate(() => { const g = window.game, c = g.dress.patch, py = g.player.position.y; g.dress.fwNext = 99; g.dress.fw.length = 0; for (let k = 0; k < 3; k++) g.dress.launch(c.x - 8 + k * 8, c.z - 18); for (let i = 0; i < 52; i++) g.step(1 / 30); g.camera.lookAt(c.x, py + 7, c.z - 18); g.camera.updateMatrixWorld(); });
  s = await page.evaluate(() => ({ sparks: window.game.dress.fw.length }));
  ok(`${label}: firework sparks alive`, s.sparks > 20, JSON.stringify(s));
  await shot(page, ipad ? '64-ipad-newyear-fireworks' : '64-newyear-fireworks');
  // Valentine's
  await open('valentine');
  await view(9, 4);
  s = await page.evaluate(() => { const g = window.game; for (let i = 0; i < 20; i++) g.step(1 / 30); const r = g.dress.reactables.filter((x) => x.kind === 'heart'); const before = g.dress.fireworks; if (r.length) g.dress.launch(r[0].pos.x, r[0].pos.z, true); for (let i = 0; i < 40; i++) g.step(1 / 30); return { id: g.themes.current().id, hearts: r.length, fw: g.dress.fireworks - before, sparks: g.dress.fw.length }; });
  ok(`${label}: valentine balloons + heart burst`, s.id === 'valentine' && s.hearts >= 3 && s.fw >= 1, JSON.stringify(s));
  await shot(page, ipad ? '65-ipad-valentine' : '65-valentine');
  // Easter: tap an egg through the real tap path
  await open('easter');
  await view(8, 5);
  const n = await page.evaluate(() => window.game.dress.eggs.length);
  ok(`${label}: easter eggs hidden`, n >= 8, String(n));
  await shot(page, ipad ? '66-ipad-easter-eggs' : '66-easter-eggs');
  const egg = await page.evaluate(() => {
    const g = window.game, e = g.dress.eggs[0], o = e.pos; g.player.teleport(o.x, o.z + 3, Math.PI); for (let i = 0; i < 4; i++) g.step(1 / 30);
    g.rig.locked = true; g.camera.position.set(o.x, o.y + 1.6, o.z + 3.2); g.camera.lookAt(o.x, o.y, o.z); g.camera.updateMatrixWorld();
    const v = o.clone().project(g.camera); return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
  });
  if (ipad) await page.touchscreen.tap(egg.x, egg.y); else await page.mouse.click(egg.x, egg.y);
  await page.waitForTimeout(200);
  await page.evaluate(() => { for (let i = 0; i < 20; i++) window.game.step(1 / 30); });
  s = await page.evaluate(() => ({ found: window.game.dress.eggsFound }));
  ok(`${label}: tapping an egg finds it`, s.found >= 1, JSON.stringify({ ...s, onScreen: !!egg }));
  ok(`${label}: no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
} finally { await browser.close(); }
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
