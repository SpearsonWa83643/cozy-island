// Order 45b: the treasure map is driven by the config island list: every islet gets a rim inset in its real direction,
// with its landing pin (refreshed when the map opens, even if the islet streamed in after the map was first built)
// and the player marker inside it. iPad touch viewport; timeout + browser closed in finally.
// Usage: node tests/map-islands.mjs [baseUrl] [--no-shots]
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
  const openMap = async () => { await page.evaluate(() => window.game.play.toggleMap()); await page.waitForTimeout(900); await step(2); };
  const closeMap = async () => { await page.evaluate(() => window.game.play.toggleMap()); await page.waitForTimeout(300); };
  const marker = () => page.evaluate(() => { const me = document.querySelector('.map-me'); return { open: document.querySelector('.map-overlay')?.classList.contains('open'), left: parseFloat(me.style.left), top: parseFloat(me.style.top) }; });
  const pinkIn = (x0, y0, x1, y1) => page.evaluate(([x0, y0, x1, y1]) => { const c = document.querySelector('.map-overlay canvas'); const d = c.getContext('2d').getImageData(x0, y0, x1 - x0, y1 - y0).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 232) < 14 && Math.abs(d[i + 1] - 96) < 16 && Math.abs(d[i + 2] - 142) < 16) n++; return n; }, [x0, y0, x1, y1]);
  // 1) open the map at home first (islet not streamed yet) so the overlay is built without a pin
  await step(30);
  await openMap();
  let m = await marker();
  ok('map opens at home, marker on the main map', m.open && m.left > 25 && m.left < 75 && m.top > 25 && m.top < 75, JSON.stringify(m));
  await closeMap();
  // 2) fly over: stream Blossom Isle in, then reopen — the pin must appear now
  await page.evaluate(() => window.game.player.teleport(170, -170, 0));
  for (let i = 0; i < 80 && (await page.evaluate(() => window.game.islets.stats[0].state)) !== 'ready'; i++) { await page.waitForTimeout(250); await step(4); }
  for (let i = 0; i < 40 && !(await page.evaluate(() => window.game.islets.floraStats[0]?.built)); i++) await step(4);
  await page.evaluate(() => { const L = window.game.islets.list[0].flora.landing; window.game.player.teleport(L.x + 2, L.z + 2, 0); });
  await step(60);
  await openMap();
  m = await marker();
  ok('on Blossom Isle the marker sits in its inset (top-right, where the islet lies)', m.open && m.left > 70 && m.top < 36, JSON.stringify(m));
  const pink = await pinkIn(500, 20, 715, 240);
  ok('inset shows the landing pin once the islet has streamed in', pink > 20, `${pink} pin px`);
  if (shots) await page.screenshot({ path: 'test-results/order45b-map-islands.png' }).catch((e) => console.log('shot failed', e.message));
  await closeMap();
  // 3) home again: marker back on the main map, inset + pin still drawn
  await page.evaluate(() => window.game.player.teleport(0, 8, 0)); await step(60);
  await openMap();
  m = await marker();
  ok('back home the marker returns to the main map', m.left > 25 && m.left < 75 && m.top > 25 && m.top < 75, JSON.stringify(m));
  ok('inset keeps its pin', (await pinkIn(500, 20, 715, 240)) > 20);
  ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) { ok('test ran', false, e.message); }
finally { clearTimeout(kill); await browser.close(); }
const pass = results.filter(Boolean).length; console.log(`${pass}/${results.length} passed`); process.exit(pass === results.length ? 0 : 1);
