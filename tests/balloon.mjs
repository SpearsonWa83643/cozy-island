// Hot-air balloon mount (Order 47a), iPad touch viewport: locked in the picker with its build hint, placing a
// Balloon Pad unlocks it (toast + save flag), it floats over from the pad, basket rests on the ground, hop on,
// slow high drift, burner flares on Jump, scenic tour on idle, land. Timeout + browser closed in finally.
// Usage: node tests/balloon.mjs [baseUrl] [--no-shots]
import { chromium, devices } from 'playwright';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4211/cozy-island/';
const kill = setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 300000);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = []; const ok = (n, c, x = '') => { results.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
const errFilter = (m) => (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|swiftshader|Automatic fallback/i.test(m.text())));
const shots = !process.argv.includes('--no-shots');
try {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11'], hasTouch: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(120000);
  const errors = []; page.on('console', (m) => { if (errFilter(m)) errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '?webgl&q=low&touch=1&whatsnew=0&theme=autumn');
  await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => document.getElementById('whatsnew')?.querySelector('.w-ok')?.click());
  const snap = () => page.evaluate(() => window.game.mount.snapshot());
  const step = (n) => page.evaluate((n) => { for (let i = 0; i < n; i++) window.game.step(1 / 60); }, n);
  const waitPhase = async (ph) => { for (let i = 0; i < 120 && (await snap()).phase !== ph; i++) await step(5); return snap(); };

  // ---- a second mount so the picker opens; balloon tile locked with the build hint
  await page.evaluate(() => { window.game.audio.unlock?.(); window.game.play.save.data.treasures = ['pterodactyl_egg']; window.game.player.teleport(0, 8); });
  await step(5);
  await page.tap('.mount-btn');
  await page.waitForSelector('.mount-picker.show'); await page.waitForTimeout(400);
  let tile = await page.evaluate(() => { const t = document.querySelector('.mp-tile[data-mount="balloon"]'); return t && { locked: t.classList.contains('locked'), sub: t.querySelector('.mp-sub').textContent }; });
  ok('balloon tile locked with Balloon Pad hint', !!tile && tile.locked && /Balloon Pad/.test(tile.sub), JSON.stringify(tile));
  await page.tap('.mp-x'); await page.waitForTimeout(300);

  // ---- Balloon Pad is always in the build palette; placing it unlocks the balloon
  const res = await page.evaluate(async () => {
    const g = window.game, b = await g.ensureBuild(), p = g.player.position;
    const idx = [...document.querySelectorAll('.hotbar .slot')].findIndex((el) => el.querySelector('span')?.textContent === 'Balloon Pad');
    const avail = b.available(idx);
    const x = Math.round(p.x + 9), z = Math.round(p.z + 2);
    let okPlace = false;
    for (let k = 0; k < 8 && !okPlace; k++) { okPlace = b.placeAt(x + 0.5 + k, z + 0.5, idx, 0); }
    if (okPlace) b.onPlace(idx); // what place() calls after a successful tap-place
    const piece = b.pieces[b.pieces.length - 1];
    return { idx, avail, okPlace, id: piece?.def.id, flag: !!g.play.save.data.balloonPad, toast: document.body.innerText.match(/Hot-Air Balloon unlocked[^\n]*/)?.[0] ?? '' };
  });
  ok('Balloon Pad available and placed', res.avail && res.okPlace && res.id === 'balloonpad', JSON.stringify(res));
  ok('placing the pad unlocks the balloon (save flag + toast)', res.flag && /Balloon unlocked/i.test(res.toast), res.toast.slice(0, 80));

  await page.tap('.mount-btn');
  await page.waitForSelector('.mount-picker.show'); await page.waitForTimeout(400);
  tile = await page.evaluate(() => ({ locked: document.querySelector('.mp-tile[data-mount="balloon"]').classList.contains('locked') }));
  ok('balloon tile unlocked', !tile.locked);
  await page.evaluate(() => { const a = window.game.audio, f = a.mount.bind(a); window.__burn = 0; a.mount = (k) => { if (k === 'burner') window.__burn++; return f(k); }; });
  await page.tap('.mp-tile[data-mount="balloon"]');
  await step(3);
  let s = await snap();
  ok('balloon floats over from its pad', s.id === 'balloon' && s.phase === 'arrive' && !!s.padFrom, JSON.stringify(s));
  s = await waitPhase('wait');
  ok('balloon settles with its basket on the ground', s.phase === 'wait' && s.alt < 0.4, `alt ${s.alt} ${JSON.stringify(s.pos)}`);
  if (shots) {
    await page.evaluate(() => { const m = window.game.mount, r = window.game.rig; r.yaw = m.heading + Math.PI * 0.7; r.pitch = 0.18; r.distance = Math.max(r.distance ?? 0, 9); });
    await step(30);
    await page.screenshot({ path: 'screenshots/order47a-balloon-waiting.png' }).catch((e) => console.log('shot failed', e.message));
  }
  await page.tap('.mount-btn');
  s = await waitPhase('ride');
  ok('riding the balloon', s.phase === 'ride' && s.mounted && s.balloon, JSON.stringify(s));
  await page.evaluate(() => { window.game.input.stick.x = 0; window.game.input.stick.y = -1; });
  await step(60 * 6);
  const fwd = await snap();
  ok('slow drift (well under the eagle\'s 9 m/s)', fwd.speed > 2 && fwd.speed < 6.5, `speed ${fwd.speed}`);
  ok('cruises higher than the birds', fwd.alt > 7, `alt ${fwd.alt}`);
  await page.evaluate(() => { window.game.input.stick.y = 0; window.game.input.pressed.add(' '); });
  await step(2);
  await step(20);
  const hot = await snap();
  ok('Jump fires the burner (heat + sound)', hot.heat > 3 && (await page.evaluate(() => window.__burn)) >= 2, `heat ${hot.heat}`);
  await step(60 * 3);
  s = await snap();
  ok('scenic tour starts on idle', s.autopilot && s.tours >= 1, JSON.stringify(s));
  await step(60 * 4);
  s = await snap();
  ok('tour drifts gently and stays aloft', s.alt > 4 && s.speed > 1 && s.speed < 6, JSON.stringify(s));
  if (shots) {
    await page.evaluate(() => { const r = window.game.rig; r.yaw = window.game.mount.heading + Math.PI * 0.6; });
    await step(20);
    await page.screenshot({ path: 'screenshots/order47a-balloon.png' }).catch((e) => console.log('shot failed', e.message));
  }
  await page.tap('.mount-btn');
  s = await waitPhase('off');
  ok('landed, balloon drifted off', s.phase === 'off' && !s.mounted, JSON.stringify(s));
  // reload keeps the unlock
  await page.evaluate(() => window.game.play.save.save?.());
  ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
} catch (e) { console.error(e); results.push(false); } finally { clearTimeout(kill); await browser.close().catch(() => {}); }
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
