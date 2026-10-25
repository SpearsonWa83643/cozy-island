// Blossom Isle sakura forage (Order 46c), iPad touch viewport: once the islet flora is built, Sakura blossoms spawn
// on the ground under the cherry grove (final heights), show a Pick prompt, go in the bag with a first-find toast,
// and deer list them as a favourite. Timeout + browser closed in finally.
// Usage: node tests/sakura-forage.mjs [baseUrl] [--no-shots]
import { chromium, devices } from 'playwright';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4196/cozy-island/';
const kill = setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 360000);
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
  const step = (n) => page.evaluate((n) => { for (let i = 0; i < n; i++) window.game.step(1 / 60); }, n);
  ok('no sakura before the islet loads', await page.evaluate(() => !window.game.play.forage.items.some((i) => i.id === 'sakura')));
  await page.evaluate(() => { const L = window.game.islets.list[0].flora.landing; window.game.player.teleport(L.x + 3, L.z - 3, 0); });
  for (let i = 0; i < 80 && (await page.evaluate(() => window.game.islets.stats[0].state)) !== 'ready'; i++) { await page.waitForTimeout(250); await step(4); }
  for (let i = 0; i < 80 && !(await page.evaluate(() => window.game.play.isletForage)); i++) await step(2);
  const sp = await page.evaluate(() => {
    const g = window.game, fl = g.islets.list[0].flora, its = g.play.forage.items.filter((i) => i.id === 'sakura');
    let dy = 0, tree = 0, isle = 0;
    for (const it of its) { dy = Math.max(dy, Math.abs(it.y + 0.02 - g.heightAt(it.x, it.z))); tree = Math.max(tree, Math.min(...fl.cherryPts.map((t) => Math.hypot(t.x - it.x, t.z - it.z)))); isle = Math.max(isle, Math.hypot(it.x - 190, it.z + 190)); }
    return { n: its.length, dy: +dy.toFixed(3), tree: +tree.toFixed(2), isle: +isle.toFixed(1), mesh: !!g.play.forage.group.getObjectByName('food-sakura') };
  });
  ok('sakura spawn under the cherry grove', sp.n >= 8 && sp.mesh && sp.tree < 2 && sp.isle < 66, JSON.stringify(sp));
  ok('sakura sit on the final ground', sp.dy < 0.08, JSON.stringify(sp));
  // walk up to one: Pick prompt
  await page.evaluate(() => { const g = window.game, it = g.play.forage.items.find((i) => i.id === 'sakura'); g.player.teleport(it.x + 0.6, it.z, -Math.PI / 2); g.rig.pitch = 0.45; g.rig.distance = 5; });
  await step(70);
  const tg = await page.evaluate(() => { const t = window.game.play.target; return t ? { label: t.label, key: t.key } : null; });
  ok('Pick prompt for Sakura blossom', tg?.key === 'pick:sakura' && /Sakura blossom/.test(tg.label), JSON.stringify(tg));
  if (shots) { await page.waitForTimeout(600); await page.screenshot({ path: 'screenshots/order46c-sakura-pick.png' }).catch((e) => console.log('shot failed', e.message)); }
  const got = await page.evaluate(() => { const g = window.game; g.play.target.run(); for (let i = 0; i < 30; i++) g.step(1 / 60); return { n: g.play.save.data.food.sakura ?? 0, seen: !!g.play.save.data.sakuraSeen, toast: document.body.innerText.includes('Sakura blossom') }; });
  ok('picked → in the bag + first-find toast', got.n === 1 && got.seen && got.toast, JSON.stringify(got));
  const fav = await page.evaluate(() => { const f = window.game.play.bestFood('deer'); return f ? { id: f.id, fav: f.fav } : null; });
  ok('deer pick Sakura as a favourite', fav?.id === 'sakura' && fav.fav, JSON.stringify(fav));
  ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) { ok('test ran', false, e.message); }
finally { clearTimeout(kill); await browser.close(); }
const pass = results.filter(Boolean).length; console.log(`${pass}/${results.length} passed`); process.exit(pass === results.length ? 0 : 1);
