// Tap reactions: plants + trees sway / petal-burst on click/tap. Usage: node tests/react.mjs [baseUrl]
import { chromium, devices } from 'playwright';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const __closeBrowser = async (code) => { try { await browser.close(); } catch { /* ignore */ } process.exit(code); };
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => __closeBrowser(130));
process.on('uncaughtException', (e) => { console.error(e); __closeBrowser(1); });
process.on('unhandledRejection', (e) => { console.error(e); __closeBrowser(1); });
const results = []; const ok = (n, c, x = '') => { results.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
const errFilter = (m) => (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|swiftshader|Automatic fallback/i.test(m.text())));
const steps = (page, n) => page.evaluate((n) => { for (let i = 0; i < n; i++) window.game.step(1 / 30); }, n);

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
    const tree = g.flora.spots.find((s) => trees.includes(s.name)) || g.flora.spots.find((s) => trees.some((t) => s.name === t));
    const plant = g.flora.spots.find((s) => plants.includes(s.name));
    if (!tree) return { ok: false, why: 'no tree spot' };
    g.player.teleport(tree.x + 2.2, tree.z + 3.5, Math.PI);
    for (let i = 0; i < 8; i++) g.step(1 / 30);
    g.rig.locked = true;
    return {
      ok: true,
      tree: { name: tree.name, x: tree.x, z: tree.z, h: tree.h, sc: tree.sc },
      plant: plant ? { name: plant.name, x: plant.x, z: plant.z, h: plant.h, sc: plant.sc } : null,
      r0: g.flora.reactions,
    };
  });
  ok(`${label}: has a tree spot`, prep.ok, JSON.stringify(prep));
  if (!prep.ok) { await ctx.close(); return; }

  // project tree canopy to screen and click/tap
  const scr = await page.evaluate((tree) => {
    const g = window.game;
    const y = tree.h + (1.8 + tree.sc * 1.6) * 0.65; // mid-canopy
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

  if (label === 'ipad') await page.touchscreen.tap(scr.x, scr.y);
  else await page.mouse.click(scr.x, scr.y);
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

  // plant squash if we have one nearby
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
      if (label === 'ipad') await page.touchscreen.tap(pr.x, pr.y);
      else await page.mouse.click(pr.x, pr.y);
      await page.waitForTimeout(150);
      await steps(page, 12);
      const pr2 = await page.evaluate(() => window.game.flora.reactions);
      ok(`${label}: tapping a plant increments reactions`, pr2 === pr.r0 + 1, JSON.stringify({ pr, pr2 }));
    } else {
      ok(`${label}: plant on screen (skip if off)`, true, 'skipped off-screen');
    }
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
    if (label === 'ipad') await page.touchscreen.tap(dress.x, dress.y);
    else await page.mouse.click(dress.x, dress.y);
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
