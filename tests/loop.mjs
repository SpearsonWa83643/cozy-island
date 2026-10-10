// Full cozy-loop test: bottle → map → forage → feed (follower) → dig → open chest → equip → reload persists.
// Also iPad emulation: wardrobe sheet, action button, map. Screenshots: screenshots/14-*.png …
// Usage: node tests/loop.mjs [baseUrl] [--skip-ipad]
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const outDir = new URL('../screenshots/', import.meta.url).pathname;
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = []; const ok = (name, cond, extra = '') => { results.push([cond ? 'PASS' : 'FAIL', name, extra]); console.log(cond ? 'PASS' : 'FAIL', name, extra); };
const errFilter = (m) => (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|swiftshader|Automatic fallback/i.test(m.text())));

async function open(ctxOpts, q = 'high') {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  page.setDefaultTimeout(300000);
  const errors = [];
  page.on('console', (m) => { if (errFilter(m)) errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  await page.goto(base + `?webgl&q=${q}`);
  await page.waitForFunction(() => window.game?.ready);
  return { ctx, page, errors };
}
const sim = (page, sec) => page.evaluate((sec) => { const g = window.game; for (let t = 0; t < sec; t += 1 / 30) g.step(1 / 30); }, sec);
const frames = (page, n) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const shot = async (page, name) => { await frames(page, 3); await page.screenshot({ path: outDir + name + '.png' }); console.log('saved', name); };
/** put the camera at an explicit framing around the player */
const frame = (page, yaw, pitch, dist) => page.evaluate(([yaw, pitch, dist]) => { const g = window.game; g.rig.yaw = yaw; g.rig.pitch = pitch; g.rig.distance = dist; g.rig.target.copy(g.player.position).add({ x: 0, y: 1.1, z: 0 }); g.rig.apply(); }, [yaw, pitch, dist]);
const targetKind = (page) => page.evaluate(() => { const g = window.game; g.play.target = null; g.step(1 / 30); g.step(1 / 30); g.step(1 / 30); g.step(1 / 30); return g.play.target?.kind ?? null; });

// ---------------- desktop ----------------
if (!process.argv.includes('--skip-desktop')) {
  let { ctx, page, errors } = await open({ viewport: { width: 1280, height: 720 } });
  await page.evaluate(() => localStorage.clear());
  await page.reload(); await page.waitForFunction(() => window.game?.ready);
  // 1. message bottle
  const st0 = await page.evaluate(() => window.game.play.save.data.map.state);
  ok('fresh save starts with a bottle', st0 === 'bottle', st0);
  await page.evaluate(() => { const g = window.game, b = g.play.treasure.bottlePos; g.player.teleport(b.x + 1.0, b.z, -Math.PI / 2); });
  await sim(page, 0.5);
  ok('near bottle → Take', (await targetKind(page)) === 'take');
  await page.keyboard.press('e'); await sim(page, 0.2);
  await page.waitForTimeout(1200);
  const m1 = await page.evaluate(() => ({ st: window.game.play.save.data.map.state, open: window.game.play.map.open, hint: window.game.play.save.data.map.hint }));
  ok('bottle gives map + opens overlay', m1.st === 'active' && m1.open, m1.hint);
  await page.waitForTimeout(700);
  await shot(page, '14-map-overlay');
  await page.keyboard.press('Escape');
  // 1b. glowing guide trail toward the X
  const gyaw = await page.evaluate(() => { const g = window.game, s = g.play.treasure.spot, p = g.player.position;
    const d = Math.hypot(s.x - p.x, s.z - p.z); if (d < 16 || d > 30) { const ux = (p.x - s.x) / d, uz = (p.z - s.z) / d; g.player.teleport(s.x + ux * 20, s.z + uz * 20); }
    const q = g.player.position; return Math.atan2(q.x - s.x, q.z - s.z); });
  await sim(page, 1.5);
  ok('guide trail visible with an active map', await page.evaluate(() => window.game.play.guide.mesh.visible));
  await frame(page, gyaw + 0.15, 0.62, 9);
  await shot(page, '23-guide-trail');
  await page.keyboard.press('g'); await sim(page, 2.5);
  ok('G hides the trail', !(await page.evaluate(() => window.game.play.guide.mesh.visible)));
  await page.keyboard.press('g'); await sim(page, 0.5);
  // 2. forage: pick 2 carrots/clover (bunny favourites) + an apple
  const picked = [];
  for (const want of ['carrot', 'clover', 'apple', 'berry']) {
    const r = await page.evaluate((want) => {
      const g = window.game, p = g.player.position;
      const it = g.play.forage.items.filter((i) => i.id === want && i.active).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
      if (!it) return null;
      g.player.teleport(it.x + 0.9, it.z, -Math.PI / 2);
      return [it.x, it.z];
    }, want);
    if (!r) continue;
    await sim(page, 0.3);
    const k = await targetKind(page);
    if (k !== 'pick') { ok(`pick target for ${want}`, false, String(k)); continue; }
    if (want === 'apple') { await frame(page, 0.9, 0.35, 5.5); }
    await page.keyboard.press('e'); await sim(page, 0.05);
    if (want === 'apple') { await page.waitForTimeout(150); await shot(page, '15-foraging'); }
    await page.waitForTimeout(900);
    picked.push(want);
  }
  const food = await page.evaluate(() => window.game.play.save.data.food);
  ok('foraged food lands in the bag', Object.values(food).reduce((a, b) => a + b, 0) >= 3, JSON.stringify(food));
  // 3. feed a bunny → follower
  const fed = await page.evaluate(() => {
    const g = window.game, h = g.fauna.herds.find((x) => x.k.name === 'bunny');
    const a = h.agents[0]; g.player.teleport(a.x + 1.4, a.z, -Math.PI / 2); return [a.x, a.z];
  });
  await sim(page, 0.2);
  let k = await targetKind(page);
  ok('near bunny with carrot → Feed', k === 'feed', String(k));
  await page.keyboard.press('e'); await sim(page, 0.1);
  let fc = await page.evaluate(() => window.game.fauna.friendCount());
  if (fc === 0) { await sim(page, 0.3); await targetKind(page); await page.keyboard.press('e'); await sim(page, 0.1); fc = await page.evaluate(() => window.game.fauna.friendCount()); }
  ok('fed animal becomes a follower', fc >= 1, `friends=${fc}`);
  // feed a deer too (apple) for a little parade
  await page.evaluate(() => { const g = window.game; g.play.save.data.food.apple = (g.play.save.data.food.apple ?? 0) + 2; g.play.save.data.food.coconut = 1; const d = g.fauna.herds.find((x) => x.k.name === 'deer').agents[0]; g.player.teleport(d.x + 1.5, d.z, -Math.PI / 2); });
  await sim(page, 0.2); if ((await targetKind(page)) === 'feed') { await page.keyboard.press('e'); await sim(page, 0.1); }
  // walk: followers should trail behind without clipping
  await page.evaluate(() => { const g = window.game; g.player.teleport(4, 2, 0); });
  await page.keyboard.down('w'); await sim(page, 2.5); await page.keyboard.up('w'); await sim(page, 1.2);
  const fol = await page.evaluate(() => { const g = window.game, p = g.player.position; return g.fauna.friends().map((f) => +Math.hypot(f.a.x - p.x, f.a.z - p.z).toFixed(2)); });
  ok('followers trail at a polite distance', fol.length >= 1 && fol.every((d) => d > 0.7 && d < 8), JSON.stringify(fol));
  await page.evaluate(() => { const g = window.game; g.rig.yaw = g.player.facingYaw + 2.2; });
  await frame(page, await page.evaluate(() => window.game.player.facingYaw + 2.3), 0.38, 7);
  await shot(page, '16-followers');
  // 4. treasure: dig + open
  const spot = await page.evaluate(() => { const g = window.game, s = g.play.treasure.spot; g.player.teleport(s.x + 1.0, s.z + 0.3, -Math.PI / 2); return [s.x, s.z, g.play.save.data.map.biome]; });
  await sim(page, 0.4);
  ok('at the X → Dig', (await targetKind(page)) === 'dig', JSON.stringify(spot));
  await page.keyboard.press('e'); await sim(page, 2.2);
  ok('dug up a chest', (await page.evaluate(() => window.game.play.save.data.map.state)) === 'dug');
  ok('chest → Open', (await targetKind(page)) === 'open');
  const camYaw = await page.evaluate(() => { const g = window.game, s = g.play.treasure.spot, p = g.player.position; g.play.rewardDelay = 90000; return Math.atan2(p.x - s.x, p.z - s.z) + 0.7; });
  await page.evaluate(() => { const g = window.game; for (const f of g.fauna.friends()) { f.a.x += 3; f.a.z += 3; } });
  await frame(page, camYaw, 0.5, 6.5);
  await page.keyboard.press('e'); await sim(page, 0.05);
  await page.evaluate(() => { const g = window.game; for (let n = 0; n < 32; n++) g.step(1 / 60); });
  await shot(page, '17-chest-open');
  await page.evaluate(() => { window.game.play.showRewardNow(); });
  await page.waitForSelector('.reward.show', { timeout: 120000 });
  await page.waitForTimeout(700);
  await shot(page, '17b-reward-card');
  const reward = await page.evaluate(() => window.game.play.lastReward);
  await page.click('.btn-equip');
  await page.waitForTimeout(500);
  const eq = await page.evaluate(() => ({ eq: window.game.play.save.data.equipped, map: window.game.play.save.data.map, chests: window.game.play.save.data.chests }));
  const slotOf = await page.evaluate((id) => { return window.game.play.save.data.owned[id] ? Object.entries(window.game.play.save.data.equipped).find(([, v]) => v === id)?.[0] : null; }, reward);
  ok('reward equipped', !!slotOf, `${reward} → ${slotOf}`);
  ok('new map after chest', eq.map.n === 1 && eq.map.state === 'active', eq.map.hint);
  // textured terrain close-up (desert strata + sand)
  await page.evaluate(() => { const g = window.game; g.player.teleport(-24, 9, -1.2); });
  await sim(page, 0.3); await frame(page, 1.9, 0.5, 8);
  await shot(page, '21-textured-terrain');
  // 5. reload → persisted
  await page.evaluate(() => { const g = window.game; g.build.placeAt(3, 9, 0, 0); g.build.placeAt(4, 9, 1, Math.PI / 2); });
  await page.evaluate(() => window.game.play.save.flush());
  await page.reload(); await page.waitForFunction(() => window.game?.ready);
  const after = await page.evaluate(() => ({ d: window.game.play.save.data, kids: window.game.player.object.children[0].children.length }));
  ok('reload: equipped item persists', Object.values(after.d.equipped).includes(reward), JSON.stringify(after.d.equipped));
  ok('reload: placed builds persist', (await page.evaluate(() => window.game.build.count)) >= 2);
  ok('reload: inventory/map/chests persist', after.d.chests === 1 && after.d.map.n === 1 && Object.keys(after.d.owned).length >= 4, `chests=${after.d.chests} n=${after.d.map.n}`);
  ok('desktop: no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  await ctx.close();
}

// ---------------- iPad ----------------
if (!process.argv.includes('--skip-ipad')) {
  const { ctx, page, errors } = await open({ ...devices['iPad Pro 11'], hasTouch: true }, 'low');
  await page.evaluate(() => localStorage.clear());
  await page.reload(); await page.waitForFunction(() => window.game?.ready);
  // give a few items so the wardrobe has things to show
  await page.evaluate(() => { const d = window.game.play.save.data; Object.assign(d.owned, { straw: 1, flowercrown: 1, roundglasses: 1, redscarf: 1, crown: 1, leafwings: 1 }); d.food = { apple: 3, carrot: 2, berry: 4 }; d.shells = 24; window.game.play.panels.refreshBadges(); });
  // action button near food
  await page.evaluate(() => { const g = window.game, p = g.player.position; const it = g.play.forage.items.filter((i) => i.active).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0]; g.player.teleport(it.x + 0.9, it.z, -Math.PI / 2); });
  await sim(page, 0.3); await targetKind(page);
  await frame(page, await page.evaluate(() => window.game.player.facingYaw + 2.5), 0.4, 6);
  const shown = await page.evaluate(() => document.querySelector('.action-btn').classList.contains('show'));
  ok('iPad: contextual action button appears', shown);
  await shot(page, '19-ipad-action');
  const before = await page.evaluate(() => Object.values(window.game.play.save.data.food).reduce((a, b) => a + b, 0));
  await page.tap('.action-btn'); await page.waitForTimeout(1400);
  const after = await page.evaluate(() => Object.values(window.game.play.save.data.food).reduce((a, b) => a + b, 0));
  ok('iPad: tapping action picks food', after === before + 1, `${before}→${after}`);
  // the button must always describe the exact item that gets collected, even when switching between foods
  for (const want of ['cherry', 'apple', 'carrot']) {
    const info = await page.evaluate((want) => {
      const g = window.game, p = g.player.position;
      const it = g.play.forage.items.filter((i) => i.id === want && i.active).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
      if (!it) return null;
      g.player.teleport(it.x + 0.8, it.z, -Math.PI / 2);
      for (let i = 0; i < 6; i++) g.step(1 / 30);
      const t = g.play.target, b = document.querySelector('.action-btn'), q = g.player.position;
      // independently find what should be picked: nearest active item within reach
      const near = g.play.forage.items.filter((i) => i.active && Math.hypot(i.x - q.x, i.z - q.z) < 1.5).sort((a, b) => Math.hypot(a.x - q.x, a.z - q.z) - Math.hypot(b.x - q.x, b.z - q.z))[0];
      const ICON = { apple: '🍎', cherry: '🍒', berry: '🍓', blueberry: '🫐', acorn: '🌰', mushroom: '🍄', pinecone: '🌲', coconut: '🥥', cactusfruit: '🌵', seeds: '🌻', clover: '☘️', carrot: '🥕', reed: '🌾' };
      window.__near = near;
      return { want, nearId: near?.id, key: t?.key, label: b.querySelector('.al').textContent, icon: b.querySelector('.ai').textContent, data: b.dataset.target, expectIcon: ICON[near?.id], count: g.play.save.data.food[near?.id] ?? 0 };
    }, want);
    if (!info) { ok(`iPad: ${want} available`, false); continue; }
    const match = info.key === `pick:${info.nearId}` && info.data === info.key && info.icon === info.expectIcon && info.label.startsWith('Pick ');
    ok(`iPad: action button matches nearest item (${info.nearId})`, match, JSON.stringify(info));
    await page.tap('.action-btn'); await page.waitForTimeout(1300);
    const r = await page.evaluate((id) => ({ n: window.game.play.save.data.food[id] ?? 0, gone: !window.__near.active }), info.nearId);
    ok(`iPad: tap collected exactly the ${info.nearId} shown`, r.n === info.count + 1 && r.gone, JSON.stringify(r));
  }
  // wardrobe bottom sheet with live preview
  await page.tap('.gbtn.ward'); await page.waitForTimeout(400);
  await page.evaluate(() => new Promise((r) => { let n = 0; const f = () => (++n > 50 ? r() : requestAnimationFrame(f)); f(); }));
  await page.evaluate(() => { const g = window.game; for (let i = 0; i < 40; i++) g.step(1 / 30); });
  await page.tap('.wcard[data-id="flowercrown"]'); await page.waitForTimeout(300);
  await page.evaluate(() => { const g = window.game; for (let i = 0; i < 20; i++) g.step(1 / 30); });
  await shot(page, '18-ipad-wardrobe');
  ok('iPad: wardrobe equips', (await page.evaluate(() => window.game.play.save.data.equipped.hat)) === 'flowercrown');
  await page.tap('.sheet-wardrobe .sheet-close'); await page.waitForTimeout(1500);
  // bag sheet
  await page.tap('.gbtn.bag'); await page.waitForTimeout(600);
  await shot(page, '20-ipad-bag');
  await page.tap('.sheet-bag .sheet-close'); await page.waitForTimeout(1500);
  // map overlay on iPad
  await page.tap('.gbtn.map', { force: true }); await page.waitForTimeout(900);
  await shot(page, '22-ipad-map');
  ok('iPad: map opens from button', await page.evaluate(() => window.game.play.map.open));
  await page.tap('.map-close');
  ok('iPad: no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  await ctx.close();
}
await browser.close();
const fails = results.filter((r) => r[0] === 'FAIL');
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
