// Treasure-mount rigs are a lazy chunk (MountArtExtra): a saved non-eagle pick is restored before ready,
// the chunk is prefetched after load, and a fresh pick of an unloaded rig still calls once it lands. iPad viewport.
import { chromium, devices } from 'playwright';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = []; const ok = (n, c, d = '') => { results.push(!!c); console.log(`${c ? 'PASS' : 'FAIL'} ${n} ${c ? '' : d}`); };
try {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], hasTouch: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(120000);
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  const extra = []; page.on('request', (r) => { if (/MountArtExtra/.test(r.url())) extra.push(r.url()); });
  await page.goto(base + '?webgl&q=low&touch=1&whatsnew=0');
  await page.waitForFunction(() => window.game?.ready);
  ok('fresh load starts on the eagle', await page.evaluate(() => window.game.mount.id) === 'eagle');
  await page.waitForFunction(() => performance.getEntriesByType('resource').some((e) => /MountArtExtra/.test(e.name)), null, { timeout: 30000 }).catch(() => null);
  ok('treasure-mount chunk prefetched after load', extra.length >= 1, JSON.stringify(extra));
  // save the unicorn as the picked mount and reload: it must be selected by the time the game is ready
  await page.evaluate(() => { const s = window.game.play.save; (s.data.treasures ??= []).push('rainbow_horseshoe', 'pterodactyl_egg'); s.data.mountId = 'unicorn'; s.flush(); });
  const mid = await page.evaluate(() => window.game.play.save.data.mountId);
  await page.reload(); await page.waitForFunction(() => window.game?.ready);
  const st = await page.evaluate(() => ({ id: window.game.mount.id, saved: window.game.play.save.data.mountId }));
  ok('saved treasure mount restored before ready', st.id === st.saved && st.saved === mid && st.id !== 'eagle', JSON.stringify(st));
  // pick another treasure mount and call it; it must arrive
  await page.evaluate(() => { window.game.player.teleport(0, 8); window.game.mount.call('pterodactyl'); });
  await page.waitForFunction(() => window.game.mount.id === 'pterodactyl' && window.game.mount.phase !== 'off', null, { timeout: 30000 }).catch(() => null);
  const c = await page.evaluate(() => ({ id: window.game.mount.id, phase: window.game.mount.phase }));
  ok('calling an unlocked treasure mount brings it', c.id === 'pterodactyl' && c.phase !== 'off', JSON.stringify(c));
  ok('no page errors', errs.length === 0, errs.join(' | '));
} finally { await browser.close(); }
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
