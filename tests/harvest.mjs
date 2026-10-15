// Tree chopping + fruit regrow. Usage: node tests/harvest.mjs [baseUrl]
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const __closeBrowser = async (code) => { try { await browser.close(); } catch { /* ignore */ } process.exit(code); };
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => __closeBrowser(130));
process.on('uncaughtException', (e) => { console.error(e); __closeBrowser(1); });
process.on('unhandledRejection', (e) => { console.error(e); __closeBrowser(1); });
const results = []; const ok = (n, c, x = '') => { results.push(!!c); console.log(c ? 'PASS' : 'FAIL', n, x); };
const errFilter = (m) => (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|swiftshader|Automatic fallback/i.test(m.text())));
const shotDir = path.resolve('screenshots');
fs.mkdirSync(shotDir, { recursive: true });

async function open(dev, q) {
  const ctx = await browser.newContext(dev);
  const page = await ctx.newPage(); page.setDefaultTimeout(120000);
  const errors = []; page.on('console', (m) => { if (errFilter(m)) errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + `?webgl&q=${q}`); await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForFunction(() => window.game?.ready);
  return { ctx, page, errors };
}

async function frameTree(page, tree) {
  return page.evaluate((tree) => {
    const g = window.game;
    g.player.teleport(tree.x + 2.0, tree.z + 3.2, Math.PI);
    for (let i = 0; i < 6; i++) g.step(1 / 30);
    g.rig.locked = true;
    const y = tree.h + (1.8 + tree.sc * 1.6) * 0.55;
    g.camera.position.set(tree.x + 0.3, y + 1.1, tree.z + 6.2);
    g.camera.lookAt(tree.x, y, tree.z);
    g.camera.updateMatrixWorld();
    const v = g.player.position.clone().set(tree.x, y, tree.z);
    return g.play.juice.project(v);
  }, tree);
}

async function run(label, dev, q) {
  const { ctx, page, errors } = await open(dev, q);

  const prep = await page.evaluate(() => {
    const g = window.game;
    const wood = g.flora.spots.find((s) => ['birch', 'maple', 'pine', 'willow', 'palm'].includes(s.name));
    const fruit = g.flora.spots.find((s) => s.name === 'oak' || s.name === 'blossom');
    if (!wood || !fruit) return { ok: false, why: 'missing tree' };
    g.play.harvest.setStumpS(1.0);
    g.play.harvest.setFruitRegrowS(9999);
    return {
      ok: true,
      wood: { name: wood.name, x: wood.x, z: wood.z, h: wood.h, sc: wood.sc },
      fruit: { name: fruit.name, x: fruit.x, z: fruit.z, h: fruit.h, sc: fruit.sc },
    };
  });
  ok(`${label}: has wood + fruit trees`, prep.ok, JSON.stringify(prep));
  if (!prep.ok) { await ctx.close(); return; }

  // ---- wood: drive Harvest API (same path as tap) ----
  const chop = await page.evaluate((t) => {
    const g = window.game, H = g.play.harvest;
    const sp = g.flora.spots.find((s) => s.name === t.name && Math.hypot(s.x - t.x, s.z - t.z) < 0.05);
    g.player.teleport(t.x + 1.5, t.z + 1.5, Math.PI);
    const wood0 = g.play.save.data.food.wood ?? 0;
    let hits = 0;
    for (let i = 0; i < 8; i++) {
      // clear tap cool by advancing harvest + react clock via tiny steps
      for (let k = 0; k < 3; k++) g.step(1 / 30);
      if (H.onTreeTap(sp, g.player.position)) hits++;
      H.update(0.05);
      if (H.woodLeft(sp) <= 0) break;
    }
    // finish fall → stump
    for (let i = 0; i < 30; i++) H.update(0.05);
    const stump = H.stumpDebug().find((s) => Math.hypot(s[0] - t.x, s[1] - t.z) < 0.5);
    return {
      wood0, wood: g.play.save.data.food.wood ?? 0, hits, chops: H.chops,
      left: H.woodLeft(sp), stump, gone: g.flora.gone.has(`${t.name}|${t.x.toFixed(2)}|${t.z.toFixed(2)}`),
    };
  }, prep.wood);
  ok(`${label}: chopping grants 5 wood`, chop.wood >= chop.wood0 + 5 && chop.hits >= 5, JSON.stringify(chop));
  ok(`${label}: empty tree becomes a stump`, chop.gone && stumpOk(chop.stump), JSON.stringify(chop.stump));

  await frameTree(page, prep.wood);
  await page.screenshot({ path: path.join(shotDir, `71-harvest-stump-${label}.png`) });

  const grass = await page.evaluate((t) => {
    const H = window.game.play.harvest;
    for (let i = 0; i < 25; i++) H.update(0.1);
    return H.stumpDebug().find((s) => Math.hypot(s[0] - t.x, s[1] - t.z) < 0.5)?.[2] ?? null;
  }, prep.wood);
  ok(`${label}: stump fades to grass`, grass === 'grass', JSON.stringify({ grass }));
  await frameTree(page, prep.wood);
  await page.screenshot({ path: path.join(shotDir, `72-harvest-grass-${label}.png`) });

  // ---- fruit deplete (regrow paused) ----
  const fruit = await page.evaluate((t) => {
    const g = window.game, H = g.play.harvest;
    const sp = g.flora.spots.find((s) => s.name === t.name && Math.hypot(s.x - t.x, s.z - t.z) < 0.05);
    g.player.teleport(t.x + 1.5, t.z + 1.5, Math.PI);
    H.setFruitRegrowS(9999);
    const apples0 = g.play.save.data.food.apple ?? 0;
    const cherries0 = g.play.save.data.food.cherry ?? 0;
    for (let i = 0; i < 6; i++) {
      H.onTreeTap(sp, g.player.position);
      H.update(0.7); // clear FRUIT_TAP cool without regrowing (9999)
    }
    const row = H.fruitDebug().find((r) => Math.hypot(r[0] - t.x, r[1] - t.z) < 0.5);
    // empty tap
    const bagBefore = (g.play.save.data.food.apple ?? 0) + (g.play.save.data.food.cherry ?? 0);
    H.onTreeTap(sp, g.player.position);
    H.update(0.7);
    const bagAfter = (g.play.save.data.food.apple ?? 0) + (g.play.save.data.food.cherry ?? 0);
    return {
      row, picks: H.fruitPicks,
      gained: ((g.play.save.data.food.apple ?? 0) - apples0) + ((g.play.save.data.food.cherry ?? 0) - cherries0),
      emptyTapOk: bagAfter === bagBefore,
    };
  }, prep.fruit);
  ok(`${label}: fruit tree depletes`, fruit.row && fruit.row[3] === 0 && fruit.row[4] === 0, JSON.stringify(fruit));
  ok(`${label}: fruit goes to bag`, fruit.gained >= 4, JSON.stringify(fruit));
  ok(`${label}: empty fruit tree grants nothing`, fruit.emptyTapOk, JSON.stringify(fruit));
  await frameTree(page, prep.fruit);
  await page.screenshot({ path: path.join(shotDir, `73-harvest-fruit-empty-${label}.png`) });

  // ---- regrow ----
  const regrown = await page.evaluate((t) => {
    const H = window.game.play.harvest;
    H.setFruitRegrowS(0.4);
    for (let i = 0; i < 50; i++) H.update(0.1);
    return H.fruitDebug().find((r) => Math.hypot(r[0] - t.x, r[1] - t.z) < 0.5);
  }, prep.fruit);
  ok(`${label}: fruit regrows`, regrown && regrown[3] >= 1 && regrown[4] >= 1, JSON.stringify(regrown));
  await frameTree(page, prep.fruit);
  await page.screenshot({ path: path.join(shotDir, `74-harvest-fruit-regrow-${label}.png`) });

  // one real screen tap still works (iPad / click path)
  const tap = await page.evaluate(async (t) => {
    const g = window.game;
    // find a fresh wood tree far from the felled one
    const wood = g.flora.spots.find((s) =>
      ['birch', 'maple', 'pine', 'willow', 'palm'].includes(s.name)
      && !g.flora.gone.has(`${s.name}|${s.x.toFixed(2)}|${s.z.toFixed(2)}`)
      && Math.hypot(s.x - t.x, s.z - t.z) > 3);
    if (!wood) return { ok: false, why: 'no fresh wood tree' };
    g.player.teleport(wood.x + 2, wood.z + 3, Math.PI);
    for (let i = 0; i < 6; i++) g.step(1 / 30);
    g.rig.locked = true;
    const y = wood.h + (1.8 + wood.sc * 1.6) * 0.55;
    g.camera.position.set(wood.x + 0.3, y + 1.1, wood.z + 6.2);
    g.camera.lookAt(wood.x, y, wood.z);
    g.camera.updateMatrixWorld();
    const s = g.play.juice.project(g.player.position.clone().set(wood.x, y, wood.z));
    return { ok: s.vis, x: s.x, y: s.y, wood0: g.play.save.data.food.wood ?? 0, name: wood.name };
  }, prep.wood);
  if (tap.ok) {
    if (label === 'ipad') await page.touchscreen.tap(tap.x, tap.y);
    else await page.mouse.click(tap.x, tap.y);
    await page.waitForTimeout(250);
    await page.evaluate(() => { for (let i = 0; i < 20; i++) window.game.step(1 / 30); });
    const after = await page.evaluate(() => ({
      wood: window.game.play.save.data.food.wood ?? 0,
      chops: window.game.play.harvest.chops,
    }));
    ok(`${label}: real screen tap chops wood`, after.wood > tap.wood0, JSON.stringify({ tap, after }));
  } else {
    ok(`${label}: real screen tap chops wood`, false, JSON.stringify(tap));
  }

  ok(`${label}: no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

function stumpOk(s) { return s && (s[2] === 'stump' || s[2] === 'falling' || s[2] === 'grass'); }

await run('desktop', { viewport: { width: 1280, height: 720 } }, 'high');
if (!process.argv.includes('--skip-ipad')) {
  await run('ipad', { ...devices['iPad Pro 11'], hasTouch: true }, 'low');
}
await browser.close();
const f = results.filter((r) => !r).length;
console.log(`\n${results.length - f}/${results.length} passed`);
process.exit(f ? 1 : 0);
