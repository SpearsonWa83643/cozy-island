// Non-default wearables are a lazy chunk (WearablesExtra, polish 2026-11-17): the default outfit shows from the
// main bundle, the chunk is prefetched during load, a saved outfit that needs it is on the character by ready,
// and equipping a piece later still works. iPad viewport.
import { chromium, devices } from 'playwright';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = []; const ok = (n, c, d = '') => { results.push(!!c); console.log(`${c ? 'PASS' : 'FAIL'} ${n} ${c ? '' : d}`); };
const worn = (page) => page.evaluate(() => { const s = window.game.player.parts.sockets; return Object.fromEntries(['hat', 'face', 'neck', 'back', 'sprout'].map((k) => [k, s[k].children.length])); });
try {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], hasTouch: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(Number(process.env.TEST_TIMEOUT_MS ?? 180000));
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(base + '?webgl&q=low&touch=1&whatsnew=0');
  await page.waitForFunction(() => window.game?.ready);
  const w0 = await worn(page);
  ok('fresh load wears the default backpack + leaf sprout', w0.back === 1 && w0.sprout === 1 && w0.hat === 0, JSON.stringify(w0));
  await page.waitForFunction(() => performance.getEntriesByType('resource').some((e) => /WearablesExtra/.test(e.name)), null, { timeout: 30000 }).catch(() => null);
  ok('wearables chunk prefetched during load', await page.evaluate(() => performance.getEntriesByType('resource').some((e) => /WearablesExtra/.test(e.name))));
  // save a non-default outfit and reload: it must be on the character by the time the game is ready
  await page.evaluate(() => { const s = window.game.play.save; s.data.equipped = { hat: 'wizard', face: 'sunglasses', neck: 'redscarf', back: 'cape', body: 'stripes', sprout: 'flower' }; s.flush(); });
  await page.reload(); await page.waitForFunction(() => window.game?.ready);
  const w1 = await worn(page);
  ok('saved non-default outfit worn at ready', w1.hat === 1 && w1.face === 1 && w1.neck === 1 && w1.back === 1 && w1.sprout === 1, JSON.stringify(w1));
  // equip another piece from the wardrobe path
  await page.evaluate(() => window.game.play.equip('hat', 'crown'));
  const w2 = await worn(page);
  ok('equipping a hat after load shows it', w2.hat === 1, JSON.stringify(w2));
  await page.evaluate(() => window.game.play.equip('hat', null));
  ok('removing the hat clears it', (await worn(page)).hat === 0);
  ok('no page errors', errs.length === 0, errs.join(' | '));
} finally { await browser.close(); }
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
