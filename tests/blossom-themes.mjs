// Blossom Isle acceptance across the 5 visible themes (Order 46 close-out), iPad touch viewport: with the islet
// loaded, switch live through spring/summer/autumn/winter/halloween; cherry petals recolour each time, the hot spring,
// lanterns and sakura stay put, and a screenshot of the spring + grove is saved per theme. Timeout + browser closed in finally.
// Usage: node tests/blossom-themes.mjs [baseUrl] [--no-shots]
import { chromium, devices } from 'playwright';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4211/cozy-island/';
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
  const fs = () => page.evaluate(() => window.game.islets.floraStats[0]);
  const s0 = (await fs()).spring;
  await page.evaluate(([x, z]) => window.game.player.teleport(x + 7, z + 7, 0), [s0.x, s0.z]);
  for (let i = 0; i < 80 && (await page.evaluate(() => window.game.islets.stats[0].state)) !== 'ready'; i++) { await page.waitForTimeout(250); await step(4); }
  for (let i = 0; i < 60 && !(await fs()).built; i++) await step(2);
  const before = await fs();
  ok('islet flora built (spring, lanterns, petals)', before.built && before.spring?.built && before.lanterns >= 6 && before.petals > 0, JSON.stringify({ l: before.lanterns, p: before.petals }));
  const cols = {};
  for (const id of ['spring', 'summer', 'autumn', 'winter', 'halloween']) {
    await page.evaluate((id) => window.game.themes.set(id), id);
    await step(30);
    const st = await page.evaluate(() => { const g = window.game, fl = g.islets.list[0].flora, S = fl.spring.pos;
      g.player.teleport(S.x + 7, S.z + 7, Math.PI * 1.25); g.rig.yaw = Math.PI * 0.25; g.rig.pitch = 0.35; g.rig.distance = 11;
      const p = fl.group.getObjectByName('cherry-petals'); return { theme: g.themes.current().id, petal: p?.material?.color?.getHexString(), sakura: g.play.forage.items.filter((i) => i.id === 'sakura').length, stats: fl.stats }; });
    await step(60);
    cols[id] = st.petal;
    ok(`${id}: theme live, spring + lanterns + sakura intact`, st.theme === id && st.stats.spring?.built && st.stats.lanterns === before.lanterns && st.sakura >= 8, JSON.stringify({ petal: st.petal, sakura: st.sakura }));
    if (shots) { await page.waitForTimeout(500); await page.screenshot({ path: `test-results/order46-blossom-${id}.png` }).catch((e) => console.log('shot failed', e.message)); }
  }
  ok('petal colour follows the theme (≥3 distinct)', new Set(Object.values(cols)).size >= 3, JSON.stringify(cols));
  ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) { ok('test ran', false, e.message); }
finally { clearTimeout(kill); await browser.close(); }
const pass = results.filter(Boolean).length; console.log(`${pass}/${results.length} passed`); process.exit(pass === results.length ? 0 : 1);
