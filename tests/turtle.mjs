// Sea turtle mount (Order 41), iPad touch viewport: the Sea Pearl is in the Shipwreck Cove chest (never a dug-up chest),
// the picker shows the locked tile + hint, the chest gives the pearl + "New mount!" card, "Ride it!" calls the turtle,
// it surfaces beside you, glides at the surface, dives on Jump, won't go up the beach, tours the reef on idle, and
// can't be called inland. Old saves with a looted chest get it closed again. Timeout + browser closed in finally.
// Usage: node tests/turtle.mjs [baseUrl] [--no-shots]
import { chromium, devices } from 'playwright';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4193/';
const kill = setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 360000);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = []; const ok = (n, c, x = '') => { results.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
const errFilter = (m) => (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|swiftshader|Automatic fallback/i.test(m.text())));
const shots = !process.argv.includes('--no-shots');
try {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], hasTouch: true });
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
  const waitPhase = async (ph) => { for (let i = 0; i < 100 && (await snap()).phase !== ph; i++) await step(5); return snap(); };
  const depth = () => page.evaluate(() => { const g = window.game, m = g.mount; return +(g.coast.offshore(m.gx, m.gz)).toFixed(2); });

  // ---- dug-up chests never hand out the pearl
  const hint = await page.evaluate(() => {
    const p = window.game.play, d = p.save.data;
    d.treasures = ['pterodactyl_egg', 'cloud_puppy_tuft', 'rainbow_horseshoe', 'shimmer_wing']; d.chests = 9; d.map.n = 20; p.treasure.newSpot();
    return d.map.hint;
  });
  ok('treasure chests skip the Sea Pearl', !/turtle/i.test(hint), hint);

  // ---- picker: locked turtle tile with the Shipwreck Cove hint
  await page.evaluate(() => { window.game.audio.unlock?.(); window.game.player.teleport(0, 8); });
  await step(5);
  await page.tap('.mount-btn');
  await page.waitForSelector('.mount-picker.show'); await page.waitForTimeout(500);
  let tile = await page.evaluate(() => { const t = document.querySelector('.mp-tile[data-mount="sea_turtle"]'); const r = t.getBoundingClientRect(); return { locked: t.classList.contains('locked'), sub: t.querySelector('.mp-sub').textContent, h: r.height, vis: r.bottom <= innerHeight && r.right <= innerWidth }; });
  ok('turtle tile locked with Shipwreck Cove hint', tile.locked && /Sea Pearl/.test(tile.sub) && /Shipwreck/.test(tile.sub), JSON.stringify(tile));
  ok('turtle tile is a big on-screen touch target', tile.h >= 100 && tile.vis, JSON.stringify(tile));
  await page.tap('.mp-x'); await page.waitForTimeout(300);

  // ---- swim to the wreck chest and open it: Captain Hat + Sea Pearl card
  const at = await page.evaluate(() => {
    const g = window.game, w = g.wreck, c = w.chest; g.player.teleport(c.x + w.side.x * 1.2, c.z + w.side.z * 1.2, 0);
    for (let i = 0; i < 20; i++) g.step(1 / 30);
    g.play.openWreckChest();
    const d = g.play.save.data; return { pearl: d.treasures.includes('sea_pearl'), hat: !!d.owned.captain, opened: w.opened, mountId: d.mountId, swimming: g.player.swimming };
  });
  ok('wreck chest gives the Sea Pearl and the Captain Hat', at.pearl && at.hat && at.opened && at.mountId === 'sea_turtle', JSON.stringify(at));
  await page.evaluate(() => window.game.play.showRewardNow());
  await page.waitForSelector('.reward.show .reward-card'); await page.waitForTimeout(400);
  const card = await page.evaluate(() => document.querySelector('.reward.show')?.textContent ?? '');
  ok('"New mount!" card for the Sea Turtle', /New mount/.test(card) && /Sea Turtle/.test(card), card.slice(0, 90));
  if (shots) await page.screenshot({ path: 'screenshots/order41-turtle-pearl.png' }).catch((e) => console.log('shot failed', e.message));
  await page.tap('.reward.show .btn-equip');
  await page.waitForTimeout(400); await step(5);
  let s = await waitPhase('wait');
  ok('"Ride it!" calls the turtle, it surfaces beside you', s.id === 'sea_turtle' && s.phase === 'wait' && s.swim && Math.abs(s.alt + 0.14) < 0.2, JSON.stringify(s));
  const shadowVis = await page.evaluate(() => window.game.mount.shadow.visible);
  ok('no ground shadow on a swimmer', !shadowVis);

  // ---- ride: surface glide, slower than flying
  await page.tap('.mount-btn');
  s = await waitPhase('ride');
  ok('riding the turtle', s.phase === 'ride' && s.mounted, JSON.stringify(s));
  // point out to sea and swim
  await page.evaluate(() => { const g = window.game, m = g.mount; g.rig.yaw = Math.atan2(m.gx, m.gz) + Math.PI; g.input.stick.x = 0; g.input.stick.y = -1; });
  await step(120);
  s = await snap();
  const meter = await page.evaluate(() => !!document.querySelector('.swim-meter.show'));
  ok('no swim-stamina ring while riding', !meter);
  ok('glides at the surface', s.speed > 3 && s.speed < 9.5 && s.alt > -0.45 && s.alt < 0.15, JSON.stringify(s));
  // Jump → dive
  await page.evaluate(() => { window.game.input.stick.y = -0.5; window.game.input.pressed.add(' '); window.game.step(1 / 60); });
  await step(80);
  s = await snap();
  ok('Jump dives under', s.dives === 1 && s.dive > 0.6 && s.alt < -0.5, JSON.stringify(s));
  if (shots) {
    await page.evaluate(() => { const g = window.game, m = g.mount; g.rig.yaw = m.heading + Math.PI * 0.8; });
    await step(10);
    await page.screenshot({ path: 'screenshots/order41-turtle-dive.png' }).catch((e) => console.log('shot failed', e.message));
  }
  await step(60 * 4);
  s = await snap();
  ok('pops back up to the surface', s.dive < 0.2 && s.alt > -0.45, JSON.stringify(s));
  if (shots) {
    await page.evaluate(() => { const g = window.game, m = g.mount; g.rig.yaw = m.heading + Math.PI * 0.7; g.input.stick.y = 0; });
    await step(30);
    await page.screenshot({ path: 'screenshots/order41-turtle-ride.png' }).catch((e) => console.log('shot failed', e.message));
  }
  // steer straight at the island: it stops in the shallows
  let minOff = 99;
  await page.evaluate(() => { const g = window.game, m = g.mount; g.rig.yaw = Math.atan2(-m.gx, -m.gz) + Math.PI; g.input.stick.x = 0; g.input.stick.y = -1; });
  for (let i = 0; i < 16; i++) { await step(60); minOff = Math.min(minOff, await depth()); await page.evaluate(() => { const g = window.game, m = g.mount; g.rig.yaw = Math.atan2(-m.gx, -m.gz) + Math.PI; }); }
  s = await snap();
  ok('never swims up onto the beach', minOff > -3 && s.alt > -0.5, `min offshore ${minOff} ${JSON.stringify(s)}`);
  ok('shallow-water stop was hit', s.blocked > 0 || minOff < 2, JSON.stringify(s));
  // idle → reef tour, stays in the sea
  await page.evaluate(() => { window.game.input.stick.x = 0; window.game.input.stick.y = 0; });
  await step(60 * 3);
  s = await snap();
  ok('reef tour starts on idle', s.autopilot && s.tours >= 1, JSON.stringify(s));
  let tourMin = 99;
  for (let i = 0; i < 8; i++) { await step(60); tourMin = Math.min(tourMin, await depth()); }
  s = await snap();
  ok('tour keeps to the water and keeps moving', tourMin > -3 && s.speed > 2, `min offshore ${tourMin} ${JSON.stringify(s)}`);
  // land → you slip off into the water, it dives away
  await page.tap('.mount-btn');
  s = await waitPhase('off');
  const sw = await page.evaluate(() => { const g = window.game; for (let i = 0; i < 10; i++) g.step(1 / 30); return g.player.swimming; });
  ok('slip off into the sea, turtle swims away', s.phase === 'off' && !s.mounted && sw, JSON.stringify(s));

  // ---- inland: it won't come
  await page.evaluate(() => { window.game.player.teleport(0, 8); });
  await step(10);
  const inland = await page.evaluate(() => window.game.mount.call('sea_turtle'));
  s = await snap();
  ok('can\'t call the turtle inland', inland === false && s.phase === 'off', JSON.stringify(s));
  const eagle = await page.evaluate(() => window.game.mount.call('eagle'));
  ok('flying mounts still come inland', eagle === true);
  await waitPhase('wait');
  await page.evaluate(() => window.game.mount.dropNow()); await waitPhase('off');

  // ---- an old save that looted the chest before the pearl existed: chest closes again
  const old = await page.evaluate(() => {
    const g = window.game, d = g.play.save.data, w = g.wreck;
    d.treasures = d.treasures.filter((t) => t !== 'sea_pearl'); d.wreckChest = true; w.setOpened(false);
    for (let i = 0; i < 5; i++) g.step(1 / 30);
    const shut = !w.opened;
    d.treasures.push('sea_pearl'); w.setOpened(false); for (let i = 0; i < 5; i++) g.step(1 / 30);
    return { shut, restored: w.opened };
  });
  ok('old looted saves: chest shut until the pearl is found', old.shut && old.restored, JSON.stringify(old));
  ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
} catch (e) { console.error(e); results.push(false); } finally { clearTimeout(kill); await browser.close().catch(() => {}); }
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
