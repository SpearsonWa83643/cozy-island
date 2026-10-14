// Tap reactions: plants/trees, animals, rocks, water ripples, props. Usage: node tests/react.mjs [baseUrl]
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const __closeBrowser = async (code) => { try { await browser.close(); } catch { /* ignore */ } process.exit(code); };
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => __closeBrowser(130));
process.on('uncaughtException', (e) => { console.error(e); __closeBrowser(1); });
process.on('unhandledRejection', (e) => { console.error(e); __closeBrowser(1); });
const results = []; const ok = (n, c, x = '') => { results.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
const errFilter = (m) => (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|swiftshader|Automatic fallback/i.test(m.text())));
const steps = (page, n) => page.evaluate((n) => { for (let i = 0; i < n; i++) window.game.step(1 / 30); }, n);
const shotDir = path.resolve('screenshots');
fs.mkdirSync(shotDir, { recursive: true });

async function clickAt(page, label, x, y) {
  if (label === 'ipad') await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

async function run(label, dev, q) {
  const ctx = await browser.newContext(dev);
  const page = await ctx.newPage(); page.setDefaultTimeout(300000);
  const errors = []; page.on('console', (m) => { if (errFilter(m)) errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + `?webgl&q=${q}`); await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForFunction(() => window.game?.ready);

  // pick a known tree spot near spawn (meadow oaks / blossoms)
  const prep = await page.evaluate(() => {
    const g = window.game;
    const trees = ['oak', 'blossom', 'birch', 'maple', 'pine', 'palm', 'willow'];
    const plants = ['bush', 'lupine', 'sunflower', 'fern', 'berry', 'hibiscus', 'foxglove'];
    const rocks = ['rock', 'snowrock', 'sandstone'];
    const tree = g.flora.spots.find((s) => trees.includes(s.name));
    const plant = g.flora.spots.find((s) => plants.includes(s.name));
    const rock = g.flora.spots.find((s) => rocks.includes(s.name));
    if (!tree) return { ok: false, why: 'no tree spot' };
    g.player.teleport(tree.x + 2.2, tree.z + 3.5, Math.PI);
    for (let i = 0; i < 8; i++) g.step(1 / 30);
    g.rig.locked = true;
    return {
      ok: true,
      tree: { name: tree.name, x: tree.x, z: tree.z, h: tree.h, sc: tree.sc },
      plant: plant ? { name: plant.name, x: plant.x, z: plant.z, h: plant.h, sc: plant.sc } : null,
      rock: rock ? { name: rock.name, x: rock.x, z: rock.z, h: rock.h, sc: rock.sc } : null,
      r0: g.flora.reactions,
    };
  });
  ok(`${label}: has a tree spot`, prep.ok, JSON.stringify(prep));
  if (!prep.ok) { await ctx.close(); return; }

  const scr = await page.evaluate((tree) => {
    const g = window.game;
    const y = tree.h + (1.8 + tree.sc * 1.6) * 0.65;
    g.rig.locked = true;
    g.camera.position.set(tree.x + 0.4, y + 1.2, tree.z + 6.5);
    g.camera.lookAt(tree.x, y, tree.z);
    g.camera.updateMatrixWorld();
    const v = g.player.position.clone();
    v.set(tree.x, y, tree.z);
    const s = g.play.juice.project(v);
    return { x: s.x, y: s.y, vis: s.vis, r0: g.flora.reactions };
  }, prep.tree);
  ok(`${label}: tree projects on screen`, scr.vis && Number.isFinite(scr.x), JSON.stringify(scr));

  await clickAt(page, label, scr.x, scr.y);
  await page.waitForTimeout(180);
  await steps(page, 20);

  const after = await page.evaluate(() => {
    const g = window.game;
    return {
      r: g.flora.reactions,
      walkKey: g.play.walk.goal?.key ?? null,
      walkActive: g.play.walk.active,
      burstKids: g.play.react.group.children.length,
    };
  });
  ok(`${label}: tapping a tree increments flora.reactions`, after.r === scr.r0 + 1, JSON.stringify({ scr, after }));
  ok(`${label}: tree tap does not start a ground walk`, !after.walkActive, JSON.stringify(after));

  if (prep.plant) {
    const pr = await page.evaluate((plant) => {
      const g = window.game;
      g.player.teleport(plant.x + 1.6, plant.z + 2.2, Math.PI);
      for (let i = 0; i < 6; i++) g.step(1 / 30);
      g.rig.locked = true;
      const y = plant.h + 0.35 + plant.sc * 0.55;
      g.camera.position.set(plant.x, y + 1.4, plant.z + 4.2);
      g.camera.lookAt(plant.x, y, plant.z);
      g.camera.updateMatrixWorld();
      const v = g.player.position.clone(); v.set(plant.x, y, plant.z);
      const s = g.play.juice.project(v);
      return { x: s.x, y: s.y, vis: s.vis, r0: g.flora.reactions };
    }, prep.plant);
    if (pr.vis) {
      await clickAt(page, label, pr.x, pr.y);
      await page.waitForTimeout(150);
      await steps(page, 12);
      const pr2 = await page.evaluate(() => window.game.flora.reactions);
      ok(`${label}: tapping a plant increments reactions`, pr2 === pr.r0 + 1, JSON.stringify({ pr, pr2 }));
    } else {
      ok(`${label}: plant on screen (skip if off)`, true, 'skipped off-screen');
    }
  }

  // ---- rock wobble ----
  if (prep.rock) {
    const rk = await page.evaluate((rock) => {
      const g = window.game;
      g.player.teleport(rock.x + 1.8, rock.z + 2.4, Math.PI);
      for (let i = 0; i < 6; i++) g.step(1 / 30);
      g.rig.locked = true;
      const y = rock.h + 0.25 + rock.sc * 0.45;
      g.camera.position.set(rock.x, y + 1.5, rock.z + 4.5);
      g.camera.lookAt(rock.x, y, rock.z);
      g.camera.updateMatrixWorld();
      const v = g.player.position.clone(); v.set(rock.x, y, rock.z);
      const s = g.play.juice.project(v);
      return { x: s.x, y: s.y, vis: s.vis, r0: g.play.react.rockHits };
    }, prep.rock);
    if (rk.vis) {
      await clickAt(page, label, rk.x, rk.y);
      await page.waitForTimeout(150);
      await steps(page, 14);
      const rk2 = await page.evaluate(() => window.game.play.react.rockHits);
      ok(`${label}: tapping a rock increments rockHits`, rk2 === rk.r0 + 1, JSON.stringify({ rk, rk2 }));
    } else {
      ok(`${label}: rock on screen (skip if off)`, true, 'skipped');
    }
  } else {
    ok(`${label}: rock spot available`, false, 'no rock');
  }

  // ---- animal reaction (teleport a bunny near the camera) ----
  const an = await page.evaluate(() => {
    const g = window.game;
    const herd = g.fauna.herds.find((h) => h.k.name === 'bunny');
    if (!herd || !herd.agents.length) return { ok: false, why: 'no bunny' };
    const a = herd.agents[0];
    a.friend = false; a.state = 0; a.timer = 5;
    const x = 2, z = 8;
    a.x = x; a.z = z; a.tx = x; a.tz = z; a.hx = x; a.hz = z; a.y = 1;
    g.player.teleport(x + 2.2, z + 3.2, Math.PI);
    for (let i = 0; i < 10; i++) g.step(1 / 30);
    g.rig.locked = true;
    const y = a.y + 0.35;
    g.camera.position.set(a.x, y + 1.4, a.z + 4.5);
    g.camera.lookAt(a.x, y, a.z);
    g.camera.updateMatrixWorld();
    const v = g.player.position.clone(); v.set(a.x, y, a.z);
    const s = g.play.juice.project(v);
    return { ok: true, x: s.x, y: s.y, vis: s.vis, r0: g.play.react.animalHits, ax: a.x, az: a.z };
  });
  ok(`${label}: bunny available for tap`, an.ok && an.vis, JSON.stringify(an));
  if (an.ok && an.vis) {
    await clickAt(page, label, an.x, an.y);
    await page.waitForTimeout(180);
    await steps(page, 18);
    const an2 = await page.evaluate(() => ({ hits: window.game.play.react.animalHits, walkKey: window.game.play.walk.goal?.key ?? null }));
    ok(`${label}: tapping an animal increments animalHits`, an2.hits === an.r0 + 1, JSON.stringify({ an, an2 }));
    if (label === 'desktop') {
      await page.screenshot({ path: path.join(shotDir, '60-tap-animal.png') });
    }
  }

  // ---- water ripple (pond) ----
  const wat = await page.evaluate(() => {
    const g = window.game;
    // shove pond ducks / fish far away so they don't steal the water tap
    for (const h of g.fauna.herds) {
      if (h.k.name !== 'duck') continue;
      for (const a of h.agents) { a.x = 80; a.z = 80; a.tx = 80; a.tz = 80; a.hx = 80; a.hz = 80; }
    }
    for (const f of g.fauna.school.fish) { f.hx = 90; f.hz = 90; f.r = 0.2; }
    const candidates = [];
    // shallow lagoon / offshore water clear of flora
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2, r = 48 + (i % 5);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = g.heightAt(x, z);
      if (h < -0.4 && h > -2.5) candidates.push({ x, z, h });
    }
    const pondX = -12 * 1.15, pondZ = 25 * 1.15, pondR = 5.5 * 1.15;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2, r = Math.sqrt((i % 5) / 5) * pondR * 0.6;
      const x = pondX + Math.cos(a) * r, z = pondZ + Math.sin(a) * r;
      if (g.heightAt(x, z) < 0.05) candidates.push({ x, z, h: g.heightAt(x, z) });
    }
    if (!candidates.length) return { ok: false, why: 'no water' };
    const w = candidates[0];
    g.player.teleport(w.x + 3.2, w.z + 4.2, Math.PI);
    for (let i = 0; i < 8; i++) g.step(1 / 30);
    g.rig.locked = true;
    g.camera.position.set(w.x, 3.0, w.z + 7.5);
    g.camera.lookAt(w.x, 0.05, w.z);
    g.camera.updateMatrixWorld();
    const v = g.player.position.clone(); v.set(w.x, 0.08, w.z);
    const s = g.play.juice.project(v);
    return { ok: true, x: s.x, y: s.y, vis: s.vis, r0: g.play.react.waterHits, wx: w.x, wz: w.z, h: w.h };
  });
  ok(`${label}: water sample found`, wat.ok, JSON.stringify(wat));
  if (wat.ok && wat.vis) {
    await clickAt(page, label, wat.x, wat.y);
    await page.waitForTimeout(180);
    await steps(page, 16);
    const w2 = await page.evaluate(() => window.game.play.react.waterHits);
    ok(`${label}: tapping water increments waterHits`, w2 === wat.r0 + 1, JSON.stringify({ wat, w2 }));
    if (label === 'desktop') {
      await page.screenshot({ path: path.join(shotDir, '61-water-ripple.png') });
    }
  } else if (wat.ok) {
    ok(`${label}: water on screen`, false, JSON.stringify(wat));
  }

  // ---- prop squash ----
  const prop = await page.evaluate(() => {
    const g = window.game;
    const x = 4, z = 10;
    g.build.placeAt(x, z, 0, 0);
    g.player.teleport(x + 2, z + 3, Math.PI);
    for (let i = 0; i < 8; i++) g.step(1 / 30);
    g.rig.locked = true;
    const p = g.build.pieces[g.build.pieces.length - 1];
    const y = p.obj.position.y + 0.5;
    g.camera.position.set(x, y + 1.6, z + 4.5);
    g.camera.lookAt(x, y, z);
    g.camera.updateMatrixWorld();
    const v = g.player.position.clone(); v.set(x, y, z);
    const s = g.play.juice.project(v);
    return { ok: true, x: s.x, y: s.y, vis: s.vis, r0: g.play.react.propHits };
  });
  if (prop.vis) {
    await clickAt(page, label, prop.x, prop.y);
    await page.waitForTimeout(150);
    await steps(page, 14);
    const p2 = await page.evaluate(() => window.game.play.react.propHits);
    ok(`${label}: tapping a prop increments propHits`, p2 === prop.r0 + 1, JSON.stringify({ prop, p2 }));
  } else {
    ok(`${label}: prop on screen`, false, JSON.stringify(prop));
  }

  // dress taps still work when halloween is forced (don't break seasonal path)
  await page.goto(base + `?webgl&q=${q}&theme=halloween`); await page.waitForFunction(() => window.game?.ready);
  const dress = await page.evaluate(() => {
    const g = window.game;
    if (!g.dress?.ghosts?.length) return { ok: false };
    const gh = g.dress.ghosts[0], o = gh.obj.position;
    g.player.teleport(o.x, o.z + 4, Math.PI);
    for (let i = 0; i < 4; i++) g.step(1 / 30);
    g.rig.locked = true;
    g.camera.position.set(o.x, o.y + 2, o.z + 7);
    g.camera.lookAt(o.x, o.y + 0.5, o.z);
    g.camera.updateMatrixWorld();
    const v = o.clone(); v.y += 0.55; const s = g.play.juice.project(v);
    return { ok: true, x: s.x, y: s.y, r0: g.dress.reactions };
  });
  if (dress.ok) {
    await clickAt(page, label, dress.x, dress.y);
    await page.waitForTimeout(150);
    const d2 = await page.evaluate(() => window.game.dress.reactions);
    ok(`${label}: dress ghost tap still works`, d2 === dress.r0 + 1, JSON.stringify({ dress, d2 }));
  } else {
    ok(`${label}: dress ghosts available`, false, 'no ghosts');
  }

  ok(`${label}: no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

try {
  if (!process.argv.includes('--skip-desktop')) await run('desktop', { viewport: { width: 1280, height: 800 } }, 'high');
  if (!process.argv.includes('--skip-ipad')) await run('ipad', { ...devices['iPad Pro 11'], hasTouch: true }, 'low');
} finally { await browser.close(); }
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
