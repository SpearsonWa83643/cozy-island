// Mount smoke: eagle Call → wait → Hop on → fly a bit → Land; then treasure unlocks (chest → pterodactyl egg),
// the Call Mount picker (locked hints, pick + ride), saved mount choice across reload, and every mount's rig.
// iPad touch HUD + desktop V / number keys.
// Usage: node tests/mount.mjs [baseUrl] [--skip-desktop] [--skip-ipad]
import { chromium, devices } from 'playwright';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const __closeBrowser = async (code) => { try { await browser.close(); } catch { /* ignore */ } process.exit(code); };
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => __closeBrowser(130));
process.on('uncaughtException', (e) => { console.error(e); __closeBrowser(1); });
process.on('unhandledRejection', (e) => { console.error(e); __closeBrowser(1); });
browser.on('disconnected', () => console.log('BROWSER DISCONNECTED'));
const results = []; const ok = (n, c, x = '') => { results.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
const errFilter = (m) => (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|swiftshader|Automatic fallback/i.test(m.text())));
const frames = (page, n) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const snap = (page) => page.evaluate(() => window.game.mount.snapshot());
const step = (page, n = 30) => page.evaluate(async (n) => { for (let i = 0; i < n; i++) window.game.step(1 / 60); }, n);

async function run(label, dev, query) {
  const ctx = await browser.newContext(dev);
  const page = await ctx.newPage(); page.setDefaultTimeout(300000);
  const errors = []; page.on('console', (m) => { if (errFilter(m)) errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message)); page.on('crash', () => console.log('PAGE CRASHED')); page.on('close', () => console.log('page closed'));
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

  await unlocks(label, page);

  ok(`${label}: no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

const shot = async (page, path) => { if (process.argv.includes('--no-shots')) return; try { await page.screenshot({ path, timeout: 60000 }); } catch (e) { console.log('shot failed', path, e.message.split('\n')[0]); } };
const press = (label, page, sel) => (label === 'ipad' ? page.tap(sel) : page.click(sel));
const waitPhase = async (page, ph, n = 60) => { for (let i = 0; i < n && (await snap(page)).phase !== ph; i++) await step(page, 5); return snap(page); };

async function unlocks(label, page) {
  // ---- only the eagle so far: Call Mount skips the picker
  let st = await page.evaluate(() => ({ t: window.game.play.save.data.treasures ?? [], open: window.game.mountPicker.open, id: window.game.mount.id }));
  ok(`${label}: fresh save = eagle only`, st.t.length === 0 && !st.open && st.id === 'eagle', JSON.stringify(st));

  // ---- first chest is a wearable, the 2nd holds the Pterodactyl Egg
  const openChest = (n) => page.evaluate((n) => { const p = window.game.play; p.save.data.chests = n; p.save.data.map.state = 'dug'; p.rewardDelay = 0; p.openChest(); }, n);
  await openChest(0);
  await page.waitForSelector('.reward.show .btn-ok');
  let lr = await page.evaluate(() => window.game.play.lastReward);
  ok(`${label}: 1st chest is a wearable`, !/egg|tuft|horseshoe/.test(lr), lr);
  await page.evaluate(() => document.querySelector('.reward.show .btn-ok').click());
  await page.waitForTimeout(350);
  await openChest(1);
  await page.waitForSelector('.reward.show .btn-equip');
  const card = await page.evaluate(() => ({ name: document.querySelector('.reward.show .reward-name')?.textContent, btn: document.querySelector('.reward.show .btn-equip')?.textContent,
    t: window.game.play.save.data.treasures, sel: window.game.play.save.data.mountId, id: window.game.mount.id }));
  ok(`${label}: 2nd chest = Pterodactyl Egg reward`, card.name === 'Pterodactyl Egg' && card.btn === 'Ride it!', JSON.stringify(card));
  ok(`${label}: egg unlocks + selects pterodactyl`, card.t?.includes('pterodactyl_egg') && card.sel === 'pterodactyl' && card.id === 'pterodactyl', JSON.stringify(card));
  if (label === 'desktop') await shot(page, 'screenshots/69-mount-reward-egg.png');
  await page.evaluate(() => document.querySelector('.reward.show .btn-ok').click());
  await page.waitForTimeout(350);
  const hint = await page.evaluate(() => window.game.play.save.data.map.hint);
  ok(`${label}: next map hint teases the next mount chest? (3rd chest = no)`, !/mount|friend's treasure/.test(hint), hint);

  // ---- Call Mount now opens the picker: pterodactyl + eagle unlocked, others locked with hints
  await page.evaluate(() => window.game.player.teleport(0, 8));
  await step(page, 5);
  await press(label, page, '.mount-btn');
  await page.waitForSelector('.mount-picker.show'); await page.waitForTimeout(500);
  const tiles = await page.evaluate(() => [...document.querySelectorAll('.mp-tile')].map((t) => ({ id: t.dataset.mount, locked: t.classList.contains('locked'), last: t.classList.contains('last'), sub: t.querySelector('.mp-sub').textContent, r: t.getBoundingClientRect().height })));
  ok(`${label}: picker shows every mount (7)`, tiles.length === 7, JSON.stringify(tiles.map((t) => t.id)));
  ok(`${label}: eagle + pterodactyl unlocked, pterodactyl = last`, !tiles[0].locked && !tiles[1].locked && tiles[1].last, JSON.stringify(tiles));
  ok(`${label}: cloud puppy + unicorn locked with unlock hint`, tiles[2].locked && tiles[3].locked && tiles[4].locked && /Cloud Tuft/.test(tiles[2].sub) && /Rainbow Horseshoe/.test(tiles[3].sub) && /Shimmer Wing/.test(tiles[4].sub), JSON.stringify(tiles));
  ok(`${label}: tiles are big touch targets`, tiles.every((t) => t.r >= 120), JSON.stringify(tiles.map((t) => t.r)));
  let s = await snap(page);
  ok(`${label}: picker open, mount not called yet`, s.phase === 'off', JSON.stringify(s));
  if (label === 'ipad') await shot(page, 'screenshots/70-ipad-mount-picker.png');
  // a locked tile wiggles + toasts the hint, picker stays open
  await press(label, page, '.mp-tile[data-mount="unicorn"]');
  await page.waitForTimeout(100);
  const lockedTap = await page.evaluate(() => ({ open: window.game.mountPicker.open, toast: document.querySelector('.mp-msg')?.textContent ?? '' }));
  ok(`${label}: locked tile keeps picker open + hint`, lockedTap.open && /Rainbow Horseshoe/.test(lockedTap.toast), JSON.stringify(lockedTap));
  s = await snap(page);
  ok(`${label}: locked tile does not call`, s.phase === 'off', JSON.stringify(s));
  // pick the pterodactyl → it swoops in
  await press(label, page, '.mp-tile[data-mount="pterodactyl"]');
  await step(page, 5);
  s = await snap(page);
  ok(`${label}: picked pterodactyl arrives`, s.id === 'pterodactyl' && (s.phase === 'arrive' || s.phase === 'wait') && !(await page.evaluate(() => window.game.mountPicker.open)), JSON.stringify(s));
  s = await waitPhase(page, 'wait');
  ok(`${label}: pterodactyl waiting`, s.phase === 'wait', JSON.stringify(s));
  const icon = await page.evaluate(() => document.querySelector('.mount-btn .mi').innerHTML);
  ok(`${label}: button shows pterodactyl icon`, icon.includes('<svg'), icon.slice(0, 40));
  if (label === 'desktop') await shot(page, 'screenshots/73-pterodactyl-waiting.png');
  await press(label, page, '.mount-btn');
  s = await waitPhase(page, 'ride', 20);
  ok(`${label}: riding pterodactyl`, s.phase === 'ride' && s.mounted && s.id === 'pterodactyl', JSON.stringify(s));
  await page.evaluate(() => window.game.input.keys.add('w')); await step(page, 45); await page.evaluate(() => window.game.input.keys.delete('w'));
  const mid = await snap(page);
  ok(`${label}: pterodactyl flies`, Math.hypot(mid.pos[0] - s.pos[0], mid.pos[2] - s.pos[2]) > 1.5, JSON.stringify({ from: s.pos, to: mid.pos }));
  await press(label, page, '.mount-btn');
  s = await waitPhase(page, 'off');
  ok(`${label}: pterodactyl landed + left`, s.phase === 'off' && !s.mounted, JSON.stringify(s));

  // ---- the choice persists across reload
  await page.evaluate(() => window.game.play.save.flush());
  await page.reload();
  await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => document.getElementById('whatsnew')?.querySelector('.w-ok')?.click());
  st = await page.evaluate(() => ({ id: window.game.mount.id, sel: window.game.play.save.data.mountId, t: window.game.play.save.data.treasures }));
  ok(`${label}: selected mount persists`, st.id === 'pterodactyl' && st.sel === 'pterodactyl' && st.t?.includes('pterodactyl_egg'), JSON.stringify(st));

  // ---- all treasures: every tile unlocked; pick the unicorn (keyboard 4 on desktop, tap on iPad)
  await page.evaluate(() => { const d = window.game.play.save.data; d.treasures = ['pterodactyl_egg', 'cloud_puppy_tuft', 'rainbow_horseshoe', 'shimmer_wing', 'sea_pearl']; d.balloonPad = true; window.game.audio.unlock?.(); window.game.player.teleport(0, 8); });
  await step(page, 5);
  if (label === 'ipad') await page.tap('.mount-btn'); else await page.keyboard.press('v');
  await step(page, 2);
  await page.waitForSelector('.mount-picker.show'); await page.waitForTimeout(500);
  const locked = await page.evaluate(() => document.querySelectorAll('.mp-tile.locked').length);
  ok(`${label}: all mounts unlocked`, locked === 0, String(locked));
  if (label === 'ipad') await page.tap('.mp-tile[data-mount="unicorn"]'); else await page.keyboard.press('4');
  await step(page, 5);
  s = await snap(page);
  ok(`${label}: picked unicorn`, s.id === 'unicorn' && s.phase !== 'off', JSON.stringify(s));
  await page.evaluate(() => window.game.mount.dropNow()); await waitPhase(page, 'off');
  // Esc / ✕ closes the picker without calling
  await press(label, page, '.mount-btn');
  await page.waitForSelector('.mount-picker.show'); await page.waitForTimeout(500);
  await press(label, page, '.mp-x');
  await page.waitForTimeout(260);
  s = await snap(page);
  ok(`${label}: ✕ closes picker, nothing called`, !(await page.evaluate(() => window.game.mountPicker.open)) && s.phase === 'off', JSON.stringify(s));

  // ---- every rig flies: call each, let it hover, ride a moment, land
  for (const id of ['eagle', 'pterodactyl', 'cloud_puppy', 'unicorn', 'dragonfly']) {
    await page.evaluate((id) => { window.game.player.teleport(0, 8); window.game.mount.call(id); }, id);
    s = await waitPhase(page, 'wait');
    if (label === 'desktop') {
      await page.evaluate(() => { const r = window.game.rig; r.distance = 6; });
      await step(page, 30);
      await shot(page, `screenshots/74-mount-${id}.png`);
    }
    await page.evaluate(() => window.game.mount.mount()); s = await waitPhase(page, 'ride', 20);
    await step(page, 30);
    const r = await snap(page);
    ok(`${label}: ${id} rig rides`, s.id === id && r.phase === 'ride' && r.visible && r.alt > 2, JSON.stringify(r));
    await page.evaluate(() => window.game.mount.land()); await waitPhase(page, 'off');
  }
}

try {
  if (!process.argv.includes('--skip-desktop')) await run('desktop', { viewport: { width: 1280, height: 800 } }, '?webgl&q=high');
  if (!process.argv.includes('--skip-ipad')) await run('ipad', { ...devices['iPad Pro 11'], hasTouch: true }, '?webgl&q=low&touch=1');
} finally { await browser.close(); }
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
