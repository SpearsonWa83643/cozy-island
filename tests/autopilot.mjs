// Mount autopilot scenic tour (iPad touch viewport): ride, go idle → tour eases in and loops the island;
// stick input takes over at once; idle again → tour resumes; landing ends it. Timeout + browser closed in finally.
// Usage: node tests/autopilot.mjs [baseUrl] [--no-shots]
import { chromium, devices } from 'playwright';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4187/';
const kill = setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 240000);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = []; const ok = (n, c, x = '') => { results.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
const errFilter = (m) => (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|swiftshader|Automatic fallback/i.test(m.text())));
try {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11'], hasTouch: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(120000);
  const errors = []; page.on('console', (m) => { if (errFilter(m)) errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '?webgl&q=low&touch=1&whatsnew=0');
  await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => document.getElementById('whatsnew')?.querySelector('.w-ok')?.click());
  await page.evaluate(() => { window.game.audio.unlock?.(); window.game.player.teleport(0, 8); });
  const snap = () => page.evaluate(() => window.game.mount.snapshot());
  const step = (n) => page.evaluate((n) => { for (let i = 0; i < n; i++) window.game.step(1 / 60); }, n);
  const waitPhase = async (ph) => { for (let i = 0; i < 80 && (await snap()).phase !== ph; i++) await step(5); return snap(); };
  await step(10);
  await page.evaluate(() => window.game.mount.call('eagle'));
  await waitPhase('wait');
  await page.tap('.mount-btn');
  let s = await waitPhase('ride');
  ok('riding', s.phase === 'ride' && s.mounted, JSON.stringify(s));
  await step(60 * 1);
  s = await snap();
  ok('no autopilot before idle delay', !s.autopilot, JSON.stringify(s));
  await step(60 * 2);
  s = await snap();
  ok('autopilot eases in after ~2 s idle', s.autopilot && s.tours === 1, JSON.stringify(s));
  const toast = await page.evaluate(() => document.body.innerText.includes('Scenic tour'));
  ok('scenic tour toast shown', toast);
  const start = s.pos, yaw0 = await page.evaluate(() => window.game.rig.yaw);
  let maxOff = 0, minAlt = 99, path = 0, prev = start;
  for (let k = 0; k < 20; k++) {
    await step(60);
    const r = await snap();
    const off = await page.evaluate(([x, z]) => Math.hypot(x, z), [r.pos[0], r.pos[2]]);
    maxOff = Math.max(maxOff, off); minAlt = Math.min(minAlt, r.alt); path += Math.hypot(r.pos[0] - prev[0], r.pos[2] - prev[2]); prev = r.pos;
    if (k === 12 && !process.argv.includes('--no-shots')) await page.screenshot({ path: 'test-results/autopilot-ipad.png', timeout: 60000 }).catch((e) => console.log('shot failed', e.message));
  }
  s = await snap();
  ok('tour flies a real distance (20 s)', path > 100, `path ${path.toFixed(1)} m`);
  ok('stays airborne', minAlt > 1.5, `min alt ${minAlt.toFixed(2)}`);
  ok('stays near the island', maxOff < 90, `max r ${maxOff.toFixed(1)}`);
  const yaw1 = await page.evaluate(() => window.game.rig.yaw);
  const camBehind = await page.evaluate(() => { const m = window.game.mount, r = window.game.rig; const d = Math.atan2(Math.sin(m.heading + Math.PI - r.yaw), Math.cos(m.heading + Math.PI - r.yaw)); return Math.abs(d); });
  ok('camera drifts behind the mount', camBehind < 0.9, `|d| ${camBehind.toFixed(2)} yaw ${yaw0.toFixed(2)}→${yaw1.toFixed(2)}`);
  // stick input takes over at once
  await page.evaluate(() => { window.game.input.stick.x = 0.6; window.game.input.stick.y = -0.6; });
  await step(2);
  s = await snap();
  ok('stick input overrides instantly', !s.autopilot, JSON.stringify(s));
  await step(60);
  await page.evaluate(() => { window.game.input.stick.x = 0; window.game.input.stick.y = 0; });
  await step(60 * 7);
  s = await snap();
  ok('tour resumes after idle', s.autopilot && s.tours === 2, JSON.stringify(s));
  await page.tap('.mount-btn');
  await step(5);
  s = await snap();
  ok('landing ends the tour', !s.autopilot && !s.mounted, JSON.stringify(s));
  ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
} catch (e) { console.error(e); results.push(false); } finally { clearTimeout(kill); await browser.close().catch(() => {}); }
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
