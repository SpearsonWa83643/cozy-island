// Order 47b: the hot-air balloon's slow idle tour drifts out to Blossom Isle, laps its coast and drifts home.
// iPad touch viewport; sim-stepped (game.step) so it is fast. Timeout + browser closed in finally.
// Usage: node tests/balloon-tour.mjs [baseUrl]
import { chromium, devices } from 'playwright';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4211/cozy-island/';
const kill = setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 900000);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = []; const ok = (n, c, x = '') => { results.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
const errFilter = (m) => (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|swiftshader|Automatic fallback/i.test(m.text())));
try {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], deviceScaleFactor: 1, hasTouch: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(120000);
  const errors = []; page.on('console', (m) => { if (errFilter(m)) errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '?webgl&q=low&touch=1&whatsnew=0');
  await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => document.getElementById('whatsnew')?.querySelector('.w-ok')?.click());
  await page.evaluate(() => { window.game.audio.unlock?.(); window.game.player.teleport(0, 8); });
  const snap = () => page.evaluate(() => window.game.mount.snapshot());
  const step = (n) => page.evaluate((n) => { for (let i = 0; i < n; i++) window.game.step(1 / 60); }, n);
  const waitPhase = async (ph) => { for (let i = 0; i < 200 && (await snap()).phase !== ph; i++) await step(5); return snap(); };
  await step(10);
  await page.evaluate(() => { window.game.play.save.data.balloonPad = true; window.game.mount.call('balloon'); });
  await waitPhase('wait');
  await page.tap('.mount-btn');
  let s = await waitPhase('ride');
  ok('riding the balloon', s.phase === 'ride' && s.mounted && s.balloon, s.phase);
  await step(60 * 3);
  s = await snap();
  ok('scenic tour eases in after idle', s.autopilot && s.tours === 1);
  const isl = await page.evaluate(() => { const t = window.game.mount.tour; const I = { x: 190, z: -190, r: 66 };
    const near = t.filter((p) => Math.hypot(p.x - I.x, p.z - I.z) < I.r + 12);
    const angs = near.map((p) => Math.atan2(p.z - I.z, p.x - I.x));
    let gaps = angs.map((a) => a).sort((a, b) => a - b); let maxGap = 0; for (let i = 0; i < gaps.length; i++) maxGap = Math.max(maxGap, ((gaps[(i + 1) % gaps.length] - gaps[i]) + 2 * Math.PI) % (2 * Math.PI));
    let maxStep = 0; for (let i = 0; i < t.length; i++) { const a = t[i], b = t[(i + 1) % t.length]; maxStep = Math.max(maxStep, Math.hypot(a.x - b.x, a.z - b.z)); }
    return { n: t.length, near: near.length, cover: 2 * Math.PI - maxGap, maxStep };
  });
  ok('tour loop laps Blossom Isle (covers > 270 deg of its coast)', isl.near > 20 && isl.cover > Math.PI * 1.5, JSON.stringify(isl));
  ok('tour points stay evenly spaced', isl.maxStep < 3, JSON.stringify(isl));
  // drift it: up to 560 s of sim time (balloon tour ~4.7 m/s), sampled every 2 s
  let reached = -1, minAlt = 99, back = -1, maxIsleOff = 0, angSeen = new Set();
  let maxSpd = 0;
  for (let k = 0; k < 560; k += 2) {
    await step(120);
    const r = await snap();
    if (!r.autopilot) { console.log('  tour dropped at', k, JSON.stringify(r)); break; }
    minAlt = Math.min(minAlt, r.alt); maxSpd = Math.max(maxSpd, r.speed);
    const dI = Math.hypot(r.pos[0] - 190, r.pos[2] + 190);
    if (dI < 66 + 14) { if (reached < 0) reached = k; angSeen.add(Math.round(((Math.atan2(r.pos[2] + 190, r.pos[0] - 190) + Math.PI) / (2 * Math.PI)) * 12) % 12); maxIsleOff = Math.max(maxIsleOff, dI); }
    if (reached >= 0 && angSeen.size >= 9 && Math.hypot(r.pos[0], r.pos[2]) < 90) { back = k; break; }
  }
  ok('the tour flies out to Blossom Isle', reached >= 0, `reached at ${reached} s`);
  ok('…laps round its coast', angSeen.size >= 9, `${angSeen.size}/12 sectors`);
  ok('…and flies back home', back > reached, `home at ${back} s`);
  ok('drifts slowly the whole way (< 6 m/s)', maxSpd < 6, `max ${maxSpd.toFixed(2)} m/s`);
  if (!process.argv.includes('--no-shots')) await page.screenshot({ path: 'screenshots/order47b-balloon-tour.png' }).catch(() => {});
  ok('stays airborne the whole way', minAlt > 1.5, `min alt ${minAlt.toFixed(2)}`);
  s = await snap();
  ok('still touring (leash never fought the route)', s.autopilot && s.tours === 1, JSON.stringify({ autopilot: s.autopilot, tours: s.tours }));
  await page.tap('.mount-btn'); await step(5);
  s = await snap();
  ok('landing ends the tour', !s.autopilot && !s.mounted);
  ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
} catch (e) { console.error(e); results.push(false); } finally { clearTimeout(kill); await browser.close().catch(() => {}); }
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
