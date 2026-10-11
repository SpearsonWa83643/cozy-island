// Friend close-up screen: tap a follower → studio view; pet (purr, hearts, eyes close, sleepy), tickle (giggle),
// tap (quirk), clean (scrub dirt → shake-off), feed (dislike head-shake, liked chomp), level-up reward + trick,
// rename, close, reload → names/meters/friendship + follower persist. Desktop (mouse) + iPad (touch).
// Screenshots: screenshots/43-47-*.png. Usage: node tests/friend.mjs [baseUrl] [--skip-desktop] [--skip-ipad]
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const outDir = new URL('../screenshots/', import.meta.url).pathname;
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const __closeBrowser = async (code) => { try { await browser.close(); } catch { /* ignore */ } process.exit(code); };
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => __closeBrowser(130));
process.on('uncaughtException', (e) => { console.error(e); __closeBrowser(1); });
process.on('unhandledRejection', (e) => { console.error(e); __closeBrowser(1); });
const results = []; const ok = (n, c, x = '') => { results.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
const errFilter = (m) => (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|swiftshader|Automatic fallback/i.test(m.text())));
async function open(opts, q) {
  const ctx = await browser.newContext(opts); const page = await ctx.newPage(); page.setDefaultTimeout(300000);
  const errors = []; page.on('console', (m) => { if (errFilter(m)) errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + `?webgl&q=${q}`); await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForFunction(() => window.game?.ready);
  return { ctx, page, errors };
}
const frames = (page, n) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

const shot = async (page, n) => { await frames(page, 3); await page.screenshot({ path: outDir + n + '.png' }); console.log('saved', n); };

// make the nearest bunny a follower next to the player and frame it
const befriend = (page) => page.evaluate(() => {
  const g = window.game, d = g.play.save.data;
  g.player.teleport(2, 9, Math.PI); for (let i = 0; i < 6; i++) g.step(1 / 30);
  const h = g.fauna.herds.find((q) => q.k.name === 'bunny'), a = h.agents[0], ref = { species: 'bunny', a };
  const p = g.player.position;
  g.fauna.befriend(ref, 300, p.x + 1.2, p.z - 0.6);
  d.food = { carrot: 3, coconut: 2, berry: 1 };
  for (let i = 0; i < 90; i++) g.step(1 / 30); // let it settle into its follow slot
  return g.fauna.keyOf(ref);
});
// THREE isn't global: project manually
const friendScreenPos = (page) => page.evaluate(() => {
  const g = window.game, f = g.fauna.friends()[0].a;
  g.rig.locked = true;
  g.camera.position.set(f.x + 2.6, f.y + 1.6, f.z + 2.6); g.camera.lookAt(f.x, f.y + 0.3, f.z); g.camera.updateMatrixWorld();
  const v = g.camera.position.clone().set(f.x, f.y + 0.3, f.z).project(g.camera);
  return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
});
const fst = (page) => page.evaluate(() => { const f = window.game.play.friend; return { open: f.open, stats: { ...f.stats }, pet: f.pet ? { ...f.pet } : null, full: f.fullness(), mode: f.mode }; });
const where = (page) => page.evaluate(() => window.game.play.friend.where());
const steps = (page, n) => page.evaluate((n) => { for (let i = 0; i < n; i++) window.game.step(1 / 30); }, n);

async function flow(page, inp, label, full) {
  const key = await befriend(page);
  const sp = await friendScreenPos(page);
  await inp.tap(sp.x, sp.y);
  await page.evaluate(() => { window.game.play.friend.update(0); window.game.rig.locked = false; });
  let s = await fst(page);
  if (!s.open) { // a follower may have hopped a little: retry once at its new spot
    const sp2 = await friendScreenPos(page); await inp.tap(sp2.x, sp2.y); await page.evaluate(() => { window.game.rig.locked = false; }); s = await fst(page);
  }
  const name = await page.evaluate(() => document.querySelector('.fs-name').textContent);
  const hidden = await page.evaluate(() => !window.game.terrain.mesh.visible && getComputedStyle(document.querySelector('.friend-screen')).display !== 'none');
  ok(`${label}: tapping a follower opens the friend screen (world hidden, name shown)`, s.open && s.pet?.name.length > 1 && hidden, `name="${name.trim()}" key=${key}`);
  if (!s.open) return null;
  // make it a bit muddy for the clean step (re-open so the dirt shows)
  await page.evaluate(() => { const f = window.game.play.friend; f.pet.clean = 0.3; f.hide(); f.show(window.game.fauna.friends()[0]); });
  await steps(page, 15);
  // ---- pet: slow strokes over the body
  let w = await where(page);
  const love0 = (await fst(page)).pet.love;
  await inp.down(w.body.x - 40, w.body.y);
  let eyes = 1;
  for (let i = 0; i < 36; i++) {
    await inp.move(w.body.x - 40 + (i % 12) * 7, w.body.y + Math.sin(i / 2) * 6);
    eyes = Math.min(eyes, await page.evaluate(() => { const f = window.game.play.friend; for (let k = 0; k < 2; k++) f.update(1 / 30); return f['rig'].eyes[0].scale.y; }));
  }
  if (full) await shot(page, '43-friend-pet');
  // keep petting → sleepy
  for (let i = 0; i < 90; i++) { await inp.move(w.body.x - 30 + (i % 10) * 6, w.body.y); await page.evaluate(() => { const f = window.game.play.friend; for (let k = 0; k < 3; k++) f.update(1 / 30); }); }
  await inp.up(w.body.x, w.body.y);
  s = await fst(page);
  ok(`${label}: petting → purr, hearts, eyes close, friendship grows`, s.stats.purr > 2 && s.stats.hearts > 2 && eyes < 0.5 && s.pet.love > love0, JSON.stringify({ purr: s.stats.purr, hearts: s.stats.hearts, eyes: +eyes.toFixed(2), love: +s.pet.love.toFixed(2) }));
  ok(`${label}: long petting makes it sleepy 💤`, s.stats.sleepy >= 1);
  // ---- tickle: fast rubbing → giggle
  await steps(page, 1);
  w = await where(page);
  await inp.down(w.body.x - 60, w.body.y);
  for (let i = 0; i < 24; i++) { await inp.move(w.body.x + (i % 2 ? 32 : -32), w.body.y + (i % 3) * 4); await page.waitForTimeout(16); }
  await inp.up(w.body.x, w.body.y);
  // ---- quick tap: says hi (quirk)
  const q0 = (await fst(page)).stats.quirk;
  await page.evaluate(() => window.game.play.friend.update(1 / 30));
  w = await where(page);
  await inp.tap(w.body.x, w.body.y);
  s = await fst(page);
  ok(`${label}: tickle → giggle; tap → species quirk; looks at the finger; blinks`, s.stats.giggle >= 1 && s.stats.quirk > q0 && s.stats.look > 0 && s.stats.blink > 0, JSON.stringify({ giggle: s.stats.giggle, quirk: [q0, s.stats.quirk], look: s.stats.look, blink: s.stats.blink }));
  // ---- clean
  await inp.click('.fs-tool[data-mode="clean"]');
  await steps(page, 2);
  w = await where(page);
  const dirt0 = await page.evaluate(() => window.game.play.friend['dirt'].filter((q) => q.dirt > 0).length);
  for (let pass = 0; pass < 4 && !(await fst(page)).stats.shake; pass++) {
    await inp.down(w.body.x - 70, w.body.y - 40);
    for (let i = 0; i < 40; i++) {
      await inp.move(w.body.x - 70 + (i % 10) * 15, w.body.y - 50 + Math.floor(i / 10) * 25 + (i % 2) * 8);
      if (i === 20 && pass === 0 && full) await shot(page, '44-friend-clean');
      if (i % 4 === 0) await page.evaluate(() => window.game.play.friend.update(1 / 30));
    }
    await inp.up(w.body.x, w.body.y);
    // finish any stubborn spots by scrubbing right on them
    const spots = await page.evaluate(() => { const f = window.game.play.friend; return f['dirt'].filter((q) => q.dirt > 0).map((q) => f.screenOf(f['rig'].body.localToWorld(q.p.clone()))); });
    for (const p of spots) { await inp.down(p.x - 12, p.y); for (let i = 0; i < 10; i++) await inp.move(p.x + (i % 2 ? 12 : -12), p.y + (i % 3) * 3); await inp.up(p.x, p.y); }
  }
  await page.waitForTimeout(1200); await steps(page, 5);
  s = await fst(page);
  ok(`${label}: scrubbing washes off the dirt → shake-off, squeaky clean`, dirt0 > 0 && s.stats.shake >= 1 && s.pet.clean >= 0.999, JSON.stringify({ dirt0, shake: s.stats.shake, clean: s.pet.clean }));
  // ---- feed: a dislike, then a favourite
  await inp.click('.fs-tool[data-mode="feed"]');
  await page.waitForTimeout(300);
  const tray = await page.evaluate(() => [...document.querySelectorAll('.fs-food')].map((b) => b.dataset.id));
  await page.evaluate(() => { const a = window.game.fauna.friends()[0].a; a.hunger = 20; });
  await inp.click('.fs-food[data-id="coconut"]');
  await page.waitForTimeout(700); await steps(page, 6);
  const afterBad = await page.evaluate(() => window.game.play.save.data.food.coconut);
  await page.waitForTimeout(600); await steps(page, 10);
  await inp.click('.fs-food[data-id="carrot"]');
  await page.waitForTimeout(800); await steps(page, 8);
  if (full) await shot(page, '45-friend-feed');
  await page.waitForTimeout(900); await steps(page, 8);
  s = await fst(page);
  const food = await page.evaluate(() => ({ ...window.game.play.save.data.food }));
  ok(`${label}: feed tray; disliked food → head shake (kept); favourite → chomp, fuller`, tray[0] === 'carrot' && s.stats.dislike >= 1 && afterBad === 2 && s.stats.eat >= 1 && food.carrot === 2 && s.full > 0.8, JSON.stringify({ tray, dislike: s.stats.dislike, coconut: afterBad, eat: s.stats.eat, carrot: food.carrot, full: +s.full.toFixed(2) }));
  // ---- friendship level up → trick, then use it
  const lv0 = await page.evaluate(() => { const f = window.game.play.friend, l = f.pet.lvl; f.pet.love = 4 * (l + 1) * l - 0.15; return f.stats.levelUp; });
  await inp.click('.fs-tool[data-mode="pet"]');
  w = await where(page);
  await inp.down(w.body.x - 30, w.body.y);
  for (let i = 0; i < 30; i++) {
    await inp.move(w.body.x - 30 + (i % 8) * 8, w.body.y);
    const up = await page.evaluate(() => { const f = window.game.play.friend; for (let k = 0; k < 2; k++) f.update(1 / 30); return f.stats.levelUp; });
    if (up > lv0) { await inp.up(w.body.x, w.body.y); if (full) { await page.waitForTimeout(350); await page.screenshot({ path: outDir + '46-friend-levelup.png' }); console.log('saved 46-friend-levelup'); } break; }
  }
  await inp.up(w.body.x, w.body.y);
  await inp.click('.fs-tool.trick');
  await steps(page, 4);
  s = await fst(page);
  ok(`${label}: friendship level up → learns a trick, Trick button performs it`, s.pet.lvl >= 2 && s.stats.levelUp >= 1 && s.pet.tricks.includes('spin') && s.stats.trick >= 1, JSON.stringify({ lvl: s.pet.lvl, tricks: s.pet.tricks, trick: s.stats.trick }));
  // ---- rename
  await inp.click('.fs-name');
  await page.fill('.fs-input', 'Marshmallow');
  await page.press('.fs-input', 'Enter');
  s = await fst(page);
  ok(`${label}: rename`, s.pet.name === 'Marshmallow');
  // ---- close
  await inp.click('.fs-close');
  await frames(page, 2);
  const closed = await page.evaluate(() => ({ open: window.game.play.friend.open, terrain: window.game.terrain.mesh.visible, ui: getComputedStyle(document.querySelector('.friend-screen')).display }));
  ok(`${label}: close returns to the world`, !closed.open && closed.terrain && closed.ui === 'none', JSON.stringify(closed));
  return key;
}

if (!process.argv.includes('--skip-desktop')) {
  const { ctx, page, errors } = await open({ viewport: { width: 1280, height: 800 } }, 'low');
  const inp = {
    tap: (x, y) => page.mouse.click(x, y),
    down: async (x, y) => { await page.mouse.move(x, y); await page.mouse.down(); },
    move: (x, y) => page.mouse.move(x, y),
    up: (x, y) => page.mouse.up(),
    click: (sel) => page.click(sel),
  };
  const key = await flow(page, inp, 'desktop', true);
  if (key) {
    await page.evaluate(() => window.game.play.save.flush());
    await page.reload(); await page.waitForFunction(() => window.game?.ready);
    const r = await page.evaluate((k) => { const g = window.game, d = g.play.save.data; return { pet: d.pets?.[k], followers: d.followers, friends: g.fauna.friends().map((f) => g.fauna.keyOf(f)) }; }, key);
    ok('desktop: reload keeps name, friendship, cleanliness + the follower', r.pet?.name === 'Marshmallow' && r.pet.lvl >= 2 && r.pet.clean > 0.9 && r.pet.tricks.includes('spin') && r.friends.includes(key), JSON.stringify(r));
    // visit from the bag
    await page.keyboard.press('i'); await page.waitForTimeout(400);
    await page.evaluate(() => document.querySelector('.friend-row .visit')?.click()); await page.waitForTimeout(200);
    ok('desktop: 💗 Visit in the bag opens the friend screen', await page.evaluate(() => window.game.play.friend.open));
    await page.keyboard.press('Escape');
  }
  ok('desktop: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}
if (!process.argv.includes('--skip-ipad')) {
  const { ctx, page, errors } = await open({ ...devices['iPad Pro 11'], hasTouch: true }, 'low');
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: 1, radiusX: 4, radiusY: 4, force: 1 })) });
  const inp = {
    tap: (x, y) => page.touchscreen.tap(x, y),
    down: (x, y) => touch('touchStart', [{ x, y }]),
    move: (x, y) => touch('touchMove', [{ x, y }]),
    up: () => touch('touchEnd', []),
    click: (sel) => page.tap(sel),
  };
  // iPad: open, pet, clean, feed, then screenshot the friend screen
  const key = await befriend(page);
  const sp = await friendScreenPos(page);
  await inp.tap(sp.x, sp.y);
  let s = await fst(page);
  for (let k = 0; k < 2 && !s.open; k++) { const p2 = await friendScreenPos(page); await inp.tap(p2.x, p2.y); s = await fst(page); }
  await page.evaluate(() => { window.game.rig.locked = false; });
  ok('iPad: tap a follower opens the friend screen', s.open);
  if (s.open) {
    await page.evaluate(() => { const f = window.game.play.friend; f.pet.clean = 0.4; f.hide(); f.show(window.game.fauna.friends()[0]); });
    await steps(page, 10);
    const w = await where(page);
    await inp.down(w.body.x - 40, w.body.y);
    for (let i = 0; i < 30; i++) { await inp.move(w.body.x - 40 + (i % 10) * 8, w.body.y); await page.evaluate(() => { const f = window.game.play.friend; for (let k = 0; k < 2; k++) f.update(1 / 30); }); }
    await inp.up();
    await inp.click('.fs-tool[data-mode="clean"]');
    await inp.down(w.body.x - 60, w.body.y - 30);
    for (let i = 0; i < 30; i++) await inp.move(w.body.x - 60 + (i % 10) * 12, w.body.y - 40 + Math.floor(i / 10) * 25);
    await inp.up();
    await inp.click('.fs-tool[data-mode="feed"]');
    await page.waitForTimeout(250);
    await inp.click('.fs-food[data-id="carrot"]');
    await page.waitForTimeout(800); await steps(page, 6);
    await shot(page, '47-ipad-friend');
    await page.waitForTimeout(800);
    s = await fst(page);
    const sizes = await page.evaluate(() => [...document.querySelectorAll('.fs-tool, .fs-close, .fs-food')].map((b) => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); }));
    ok('iPad: pet (touch) + clean scrub + feed work; buttons 44pt+', s.stats.purr > 0 && s.pet.clean > 0.45 && s.stats.eat >= 1 && Math.min(...sizes) >= 44, JSON.stringify({ purr: s.stats.purr, clean: +s.pet.clean.toFixed(2), eat: s.stats.eat, minBtn: Math.min(...sizes) }));
    await inp.click('.fs-close');
    ok('iPad: close', !(await fst(page)).open);
  }
  ok('iPad: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
}
const failed = results.filter((r) => !r).length;
console.log(failed ? `${failed} FAILED` : `ALL ${results.length} CHECKS PASSED`);
await browser.close();
process.exit(failed ? 1 : 0);
