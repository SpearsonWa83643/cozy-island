// Eagle mount smoke: Call → wait → Hop on → fly a bit → Land. iPad touch HUD + desktop V.
// Usage: node tests/mount.mjs [baseUrl] [--skip-desktop] [--skip-ipad]
import { chromium, devices } from 'playwright';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const __closeBrowser = async (code) => { try { await browser.close(); } catch { /* ignore */ } process.exit(code); };
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => __closeBrowser(130));
process.on('uncaughtException', (e) => { console.error(e); __closeBrowser(1); });
process.on('unhandledRejection', (e) => { console.error(e); __closeBrowser(1); });
const results = []; const ok = (n, c, x = '') => { results.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
const errFilter = (m) => (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|swiftshader|Automatic fallback/i.test(m.text())));
const frames = (page, n) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const snap = (page) => page.evaluate(() => window.game.mount.snapshot());
const step = (page, n = 30) => page.evaluate(async (n) => { for (let i = 0; i < n; i++) window.game.step(1 / 60); }, n);

async function run(label, dev, query) {
  const ctx = await browser.newContext(dev);
  const page = await ctx.newPage(); page.setDefaultTimeout(300000);
  const errors = []; page.on('console', (m) => { if (errFilter(m)) errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + query + (query.includes('?') ? '&' : '?') + 'whatsnew=0');
  await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload();
  await page.waitForFunction(() => window.game?.ready);
  await page.waitForTimeout(400);
  // dismiss what's-new if it somehow showed
  await page.evaluate(() => document.getElementById('whatsnew')?.querySelector('.w-ok')?.click());
  await page.evaluate(() => { window.game.audio.unlock?.(); window.game.player.teleport(0, 8); });
  await step(page, 10);

  const hasBtn = await page.evaluate(() => !!document.querySelector('.mount-btn'));
  ok(`${label}: Call Mount button present`, hasBtn);

  let s = await snap(page);
  ok(`${label}: starts off, can call`, s.phase === 'off' && s.button === 'call', JSON.stringify(s));

  // Call
  if (label === 'ipad') await page.tap('.mount-btn');
  else await page.click('.mount-btn');
  await step(page, 5);
  s = await snap(page);
  ok(`${label}: swooping in`, s.phase === 'arrive' || s.phase === 'wait', JSON.stringify(s));
  // finish arrive
  for (let i = 0; i < 40 && (await snap(page)).phase === 'arrive'; i++) await step(page, 5);
  s = await snap(page);
  ok(`${label}: waiting beside player`, s.phase === 'wait', JSON.stringify(s));

  // Hop on
  if (label === 'ipad') await page.tap('.mount-btn');
  else await page.click('.mount-btn');
  for (let i = 0; i < 20 && (await snap(page)).phase === 'hop'; i++) await step(page, 3);
  s = await snap(page);
  ok(`${label}: riding`, s.phase === 'ride' && s.mounted, JSON.stringify(s));
  ok(`${label}: button says Land`, s.button === 'land', JSON.stringify(s));

  // fly forward a bit
  await page.evaluate(() => { window.game.input.keys.add('w'); });
  await step(page, 45);
  await page.evaluate(() => { window.game.input.keys.delete('w'); });
  const mid = await snap(page);
  ok(`${label}: moved while riding`, Math.hypot(mid.pos[0] - s.pos[0], mid.pos[2] - s.pos[2]) > 1.5, JSON.stringify({ from: s.pos, to: mid.pos }));

  // Land
  if (label === 'ipad') await page.tap('.mount-btn');
  else await page.click('.mount-btn');
  await step(page, 5);
  s = await snap(page);
  ok(`${label}: eagle leaving after land`, s.phase === 'leave' || s.phase === 'off', JSON.stringify(s));
  ok(`${label}: player unmounted`, !s.mounted, JSON.stringify(s));
  for (let i = 0; i < 40 && (await snap(page)).phase === 'leave'; i++) await step(page, 5);
  s = await snap(page);
  ok(`${label}: eagle gone`, s.phase === 'off' && !s.visible, JSON.stringify(s));

  // V key call (desktop) / button again
  // V key (same path as keyboard): inject pressed so the frame sees it
  await page.evaluate(() => { window.game.player.teleport(0, 8); window.game.input.pressed.add('v'); });
  await step(page, 5);
  s = await snap(page);
  ok(`${label}: V key calls mount`, s.phase === 'arrive' || s.phase === 'wait', JSON.stringify(s));
  await page.evaluate(() => window.game.mount.dropNow());
  await step(page, 40);

  // cave blocks call
  await page.evaluate(() => { window.game.mount.dropNow(); window.game.play.caveTransition(true, true); });
  await step(page, 10);
  s = await snap(page);
  const noCall = await page.evaluate(() => !window.game.mount.canCall());
  ok(`${label}: cannot call in cave`, noCall, JSON.stringify(s));
  // leave cave
  await page.evaluate(() => window.game.play.caveTransition(false, true));
  await step(page, 10);

  ok(`${label}: no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

try {
  if (!process.argv.includes('--skip-desktop')) await run('desktop', { viewport: { width: 1280, height: 800 } }, '?webgl&q=high');
  if (!process.argv.includes('--skip-ipad')) await run('ipad', { ...devices['iPad Pro 11'], hasTouch: true }, '?webgl&q=low&touch=1');
} finally { await browser.close(); }
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
