// Dragonfly mount (Order 34), iPad touch viewport: the Shimmer Wing chest is buried in the Misty Marsh, the
// picker shows the locked tile + hint, then unlocked: tap-pick, hover, hop on, darting flight, wing buzz,
// scenic tour on idle, land. Timeout + browser closed in finally.
// Usage: node tests/dragonfly.mjs [baseUrl] [--no-shots]
import { chromium, devices } from 'playwright';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4193/';
const kill = setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 300000);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = []; const ok = (n, c, x = '') => { results.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
const errFilter = (m) => (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|swiftshader|Automatic fallback/i.test(m.text())));
const shots = !process.argv.includes('--no-shots');
try {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11'], hasTouch: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(120000);
  const errors = []; page.on('console', (m) => { if (errFilter(m)) errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '?webgl&q=low&touch=1&whatsnew=0');
  await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => document.getElementById('whatsnew')?.querySelector('.w-ok')?.click());
  const snap = () => page.evaluate(() => window.game.mount.snapshot());
  const step = (n) => page.evaluate((n) => { for (let i = 0; i < n; i++) window.game.step(1 / 60); }, n);
  const waitPhase = async (ph) => { for (let i = 0; i < 80 && (await snap()).phase !== ph; i++) await step(5); return snap(); };

  // ---- the next mount chest after the first three mount treasures carries the Shimmer Wing, buried in the Misty Marsh
  const spot = await page.evaluate(() => {
    const p = window.game.play, d = p.save.data;
    d.treasures = ['pterodactyl_egg', 'cloud_puppy_tuft', 'rainbow_horseshoe']; d.chests = 7; // next chest = 8th (a mount chest)
    const out = [];
    for (let i = 0; i < 3; i++) { d.map.n = 10 + i; p.treasure.newSpot(); out.push({ biome: d.map.biome, hint: d.map.hint }); }
    return out;
  });
  ok('Shimmer Wing chests are buried in the Misty Marsh', spot.every((s) => s.biome === 5), JSON.stringify(spot.map((s) => s.biome)));
  ok('map hint teases the dragonfly', spot.every((s) => /Misty Marsh/.test(s.hint) && /dragonfly/.test(s.hint)), spot[0].hint);
  const other = await page.evaluate(() => { const p = window.game.play, d = p.save.data; d.chests = 6; d.map.n = 2; p.treasure.newSpot(); return d.map.biome; });
  ok('ordinary chests still rotate through zones', other !== undefined, String(other));

  // ---- picker: dragonfly locked with its hint
  await page.evaluate(() => { window.game.audio.unlock?.(); window.game.player.teleport(0, 8); });
  await step(5);
  await page.tap('.mount-btn');
  await page.waitForSelector('.mount-picker.show'); await page.waitForTimeout(500);
  let tile = await page.evaluate(() => { const t = document.querySelector('.mp-tile[data-mount="dragonfly"]'); const r = t.getBoundingClientRect(); return { locked: t.classList.contains('locked'), sub: t.querySelector('.mp-sub').textContent, h: r.height, w: r.width, vis: r.bottom <= innerHeight }; });
  ok('dragonfly tile locked with Misty Marsh hint', tile.locked && /Shimmer Wing/.test(tile.sub) && /Misty Marsh/.test(tile.sub), JSON.stringify(tile));
  ok('dragonfly tile is a big on-screen touch target', tile.h >= 120 && tile.vis, JSON.stringify(tile));
  await page.tap('.mp-x'); await page.waitForTimeout(300);

  // ---- unlock (as a chest would), pick by tap, ride
  await page.evaluate(() => { window.game.play.save.data.treasures.push('shimmer_wing'); });
  await page.tap('.mount-btn');
  await page.waitForSelector('.mount-picker.show'); await page.waitForTimeout(500);
  tile = await page.evaluate(() => ({ locked: document.querySelector('.mp-tile[data-mount="dragonfly"]').classList.contains('locked') }));
  ok('dragonfly unlocked after the Shimmer Wing', !tile.locked);
  if (shots) await page.screenshot({ path: 'screenshots/order34-dragonfly-picker.png' }).catch((e) => console.log('shot failed', e.message));
  // count wing buzzes through the audio hook
  await page.evaluate(() => { const a = window.game.audio, f = a.mount.bind(a); window.__buzz = 0; a.mount = (k) => { if (k === 'buzz') window.__buzz++; return f(k); }; });
  await page.tap('.mp-tile[data-mount="dragonfly"]');
  await step(5);
  let s = await waitPhase('wait');
  ok('dragonfly arrives and hovers', s.id === 'dragonfly' && s.phase === 'wait', JSON.stringify(s));
  const icon = await page.evaluate(() => document.querySelector('.mount-btn .mi')?.innerHTML ?? '');
  ok('Mount button shows the dragonfly icon', icon.includes('<svg'), icon.slice(0, 40));
  if (shots) {
    await page.evaluate(() => { const m = window.game.mount, r = window.game.rig; r.yaw = m.heading + Math.PI * 0.75; });
    await step(30);
    await page.screenshot({ path: 'screenshots/order34-dragonfly-hover.png' }).catch((e) => console.log('shot failed', e.message));
  }
  await page.tap('.mount-btn');
  s = await waitPhase('ride');
  ok('riding the dragonfly', s.phase === 'ride' && s.mounted && s.id === 'dragonfly', JSON.stringify(s));
  // darting: a sharp stick turn swings the heading faster than the eagle's 3.2/s turn rate would
  const h0 = s.heading;
  await page.evaluate(() => { window.game.input.stick.x = 0; window.game.input.stick.y = -0.9; });
  await step(60);
  const fwd = await snap();
  await page.evaluate(() => { window.game.input.stick.x = 0.9; window.game.input.stick.y = 0; });
  const hA = (await snap()).heading;
  await step(12);
  const hB = (await snap()).heading;
  const turned = Math.abs(Math.atan2(Math.sin(hB - hA), Math.cos(hB - hA)));
  ok('darting turn: >45° in 0.2 s', turned > 0.78, `turned ${turned.toFixed(2)} rad (from ${h0})`);
  ok('dragonfly flies forward', fwd.speed > 4, JSON.stringify(fwd));
  await page.evaluate(() => { window.game.input.stick.x = 0; window.game.input.stick.y = 0; });
  // idle → scenic tour
  await step(60 * 3);
  s = await snap();
  ok('scenic tour starts on idle', s.autopilot && s.tours >= 1, JSON.stringify(s));
  await step(60 * 4);
  s = await snap();
  ok('stays airborne on tour', s.alt > 1.5 && s.speed > 3, JSON.stringify(s));
  if (shots) await page.screenshot({ path: 'screenshots/order34-dragonfly-ride.png' }).catch((e) => console.log('shot failed', e.message));
  const buzz = await page.evaluate(() => window.__buzz);
  ok('wings buzz while flying', buzz >= 3, `buzzes ${buzz}`);
  await page.tap('.mount-btn');
  s = await waitPhase('off');
  ok('landed, dragonfly flew off', s.phase === 'off' && !s.mounted, JSON.stringify(s));
  // wing opacity restored after the fade-out (base opacity kept)
  const wing = await page.evaluate(() => { const r = window.game.mount.rigs.get('dragonfly'); const w = r.mats.find((m) => m.userData.baseOpacity); return { op: w.opacity, tr: w.transparent }; });
  ok('wing membranes stay see-through after the fade', Math.abs(wing.op - 0.55) < 0.01 && wing.tr, JSON.stringify(wing));
  ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
} catch (e) { console.error(e); results.push(false); } finally { clearTimeout(kill); await browser.close().catch(() => {}); }
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
