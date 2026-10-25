// Order 45c: treasure maps can lead to an islet. Map No. 4, 8, 12… sends you across the sea to Blossom Isle:
// the spot is dry meadow on the islet, the hint names it, the map's X + fragment sit in the islet inset, and the
// chest digs up there (iPad action button). Ordinary maps stay on the main island. Timeout + browser closed in finally.
// Usage: node tests/islet-treasure.mjs [baseUrl] [--no-shots]
import { chromium, devices } from 'playwright';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4196/cozy-island/';
const kill = setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 420000);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = []; const ok = (n, c, x = '') => { results.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
const errFilter = (m) => (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|swiftshader|Automatic fallback|willReadFrequently/i.test(m.text())));
const shots = !process.argv.includes('--no-shots');
try {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], hasTouch: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(120000);
  const errors = []; page.on('console', (m) => { if (errFilter(m)) errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '?webgl&q=low&touch=1&whatsnew=0&theme=spring');
  await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => document.getElementById('whatsnew')?.querySelector('.w-ok')?.click());
  const step = (n) => page.evaluate((n) => { for (let i = 0; i < n; i++) window.game.step(1 / 60); }, n);
  const targetKind = () => page.evaluate(() => { const g = window.game; g.play.target = null; for (let i = 0; i < 4; i++) g.step(1 / 30); return g.play.target?.kind ?? null; });
  await step(30);
  // which maps go where
  const plan = await page.evaluate(() => { const p = window.game.play, d = p.save.data, out = [];
    d.treasures = ['pterodactyl_egg', 'cloud_puppy_tuft', 'rainbow_horseshoe', 'shimmer_wing', 'sea_pearl']; // no mount chest pending
    for (const n of [0, 1, 2, 3, 4, 5, 6, 7, 11]) { d.map.n = n; d.map.x = 0; d.map.z = 0; p.treasure.newSpot(); out.push({ n, isle: Math.hypot(d.map.x - 190, d.map.z + 190) < 66, x: +d.map.x.toFixed(1), z: +d.map.z.toFixed(1), h: +window.game.heightAt(d.map.x, d.map.z).toFixed(2), hint: d.map.hint }); }
    return out; });
  const isle = plan.filter((p) => p.isle).map((p) => p.n);
  ok('maps No. 4, 8 and 12 lead to Blossom Isle; the rest stay home', isle.join() === '3,7,11', JSON.stringify(isle));
  const s3 = plan.find((p) => p.n === 3);
  ok('islet dig spot is dry meadow', s3.h > 0.8, JSON.stringify(s3));
  ok('hint names Blossom Isle and the sea crossing', /Blossom Isle/.test(s3.hint) && /sea/i.test(s3.hint), s3.hint);
  ok('deterministic per map number', await page.evaluate(([x]) => { const p = window.game.play, d = p.save.data; d.map.n = 3; p.treasure.newSpot(); return Math.abs(d.map.x - x) < 0.06; }, [s3.x]));
  // the map: X + fragment drawn in the inset
  await page.evaluate(() => window.game.play.toggleMap()); await page.waitForTimeout(900); await step(2);
  const xm = await page.evaluate(() => { const x = document.querySelector('.map-x'); return { disp: x.style.display, left: parseFloat(x.style.left), top: parseFloat(x.style.top), cap: document.querySelector('.map-caption').textContent }; });
  ok('map X sits in the Blossom Isle inset', xm.disp === 'block' && xm.left > 70 && xm.top < 36, JSON.stringify(xm));
  if (shots) await page.screenshot({ path: 'test-results/order45c-map-x-islet.png' }).catch((e) => console.log('shot failed', e.message));
  await page.evaluate(() => window.game.play.toggleMap()); await page.waitForTimeout(300);
  // fly over (teleport), let the islet stream in, dig with the action button
  await page.evaluate(() => { const g = window.game, s = g.play.treasure.spot; g.player.teleport(s.x + 1.0, s.z + 0.3, -Math.PI / 2); });
  for (let i = 0; i < 80 && (await page.evaluate(() => window.game.islets.stats[0].state)) !== 'ready'; i++) { await page.waitForTimeout(250); await step(4); }
  await step(60);
  await page.evaluate(() => { const g = window.game, s = g.play.treasure.spot; g.player.teleport(s.x + 1.0, s.z + 0.3, -Math.PI / 2); });
  await step(30);
  const tk = await targetKind();
  ok('at the islet X → Dig', tk === 'dig', String(tk));
  await page.tap('.action-btn'); await step(140);
  const st = await page.evaluate(() => ({ state: window.game.play.save.data.map.state, swimming: window.game.player.swimming }));
  ok('dug up a chest on Blossom Isle', st.state === 'dug' && !st.swimming, JSON.stringify(st));
  ok('chest → Open', (await targetKind()) === 'open');
  ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) { ok('test ran', false, e.message); }
finally { clearTimeout(kill); await browser.close(); }
const pass = results.filter(Boolean).length; console.log(`${pass}/${results.length} passed`); process.exit(pass === results.length ? 0 : 1);
