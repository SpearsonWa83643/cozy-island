// Order 48e: distant-forest impostors. Far from an islet its full instanced flora is hidden and one merged canopy
// mesh draws instead; walking back in swaps the full flora back (with hysteresis). Saves screenshots/order48e-far.png.
// Usage: node tests/impostor.mjs [baseUrl] [--shots]
import { chromium, devices } from 'playwright';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4231/';
const shots = process.argv.includes('--shots');
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const kill = setTimeout(() => { console.log('TIMEOUT'); browser.close().finally(() => process.exit(2)); }, 400000);
const res = []; const ok = (n, c, x = '') => { res.push(!!c); console.log(c ? 'PASS' : 'FAIL', n, x); };
try {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], hasTouch: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(180000);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}?webgl&q=low&touch=1&whatsnew=0&nosw&nonews`);
  await page.waitForFunction(() => window.game?.ready);
  const step = (n) => page.evaluate((n) => { for (let i = 0; i < n; i++) window.game.step(1 / 60); }, n);
  for (let i = 0; i < 150; i++) {
    await step(30);
    if (await page.evaluate(() => window.game.islets.list.every((it) => it.state === 'ready' && it.flora.built))) break;
    await page.waitForTimeout(200);
  }
  const snap = () => page.evaluate(() => window.game.islets.list.map((it) => {
    const f = it.flora, vis = f.group.children.filter((o) => o.visible && (o.isMesh || o.isInstancedMesh)).length;
    let tris = 0; for (const o of f.group.children) if (o.visible && o.geometry) { const n = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; tris += n * (o.isInstancedMesh ? o.count : 1); }
    return { id: it.def.id, lod: f.lodMode, swaps: f.lodSwaps, trees: f.trees.length, impTris: f.stats.impostorTris, impVis: !!f.impostor?.visible, visMeshes: vis, tris: Math.round(tris), landmark: f.landmark ? !!f.landmark.mesh?.visible : null };
  }));
  const go = (x, z) => page.evaluate(({ x, z }) => { const g = window.game; g.player.teleport(x, z, 0); for (let i = 0; i < 90; i++) g.step(1 / 60); }, { x, z });
  // far: main island centre (every islet is 160+ m past its shore from here)
  await go(0, 0); await step(30);
  const far = await snap(); for (const l of far) console.log('far', JSON.stringify(l));
  ok('every islet has an impostor with all its trees', far.every((l) => l.trees > 10 && l.impTris > 0), far.map((l) => `${l.id}:${l.trees}`).join(', '));
  ok('far from home every islet shows only its impostor', far.every((l) => l.lod === 'far' && l.impVis), far.map((l) => l.lod).join(', '));
  ok('far islet draws <= 3 meshes (impostor + landmark + pennant)', far.every((l) => l.visMeshes <= 3), far.map((l) => l.visMeshes).join(', '));
  ok('generated islets keep their landmark visible from afar', far.filter((l) => l.landmark !== null).every((l) => l.landmark));
  if (shots) {
    const L = await page.evaluate(() => { const d = window.game.islets.list[2].def; return { x: d.x, z: d.z }; });
    await page.evaluate((L) => { const g = window.game; g.rig.yaw = Math.atan2(L.x - g.player.position.x, L.z - g.player.position.z) + Math.PI; g.rig.pitch = 0.12; g.rig.distance = 10; }, L);
    await step(20); await page.waitForTimeout(800); await page.screenshot({ path: 'screenshots/order48e-far.png' }); console.log('shot screenshots/order48e-far.png');
  }
  // near: walk to each islet's landing; it swaps back to the full flora
  const near = [];
  for (const id of far.map((l) => l.id)) {
    const p = await page.evaluate((id) => { const it = window.game.islets.list.find((i) => i.def.id === id); return { x: it.flora.landing.x, z: it.flora.landing.z }; }, id);
    await go(p.x, p.z); await step(30);
    near.push((await snap()).find((l) => l.id === id));
  }
  for (const l of near) console.log('near', JSON.stringify(l));
  ok('on each islet the full flora is back and the impostor hidden', near.every((l) => l.lod === 'near' && !l.impVis && l.visMeshes > 5), near.map((l) => `${l.id}:${l.visMeshes}`).join(', '));
  const saved = far.map((l, i) => Math.round(near[i].tris / Math.max(1, l.tris)));
  ok('impostor is at least 5x cheaper than the full flora', saved.every((r) => r >= 5), saved.map((r) => `${r}x`).join(', '));
  // hysteresis: hovering at the threshold does not flicker
  const sw0 = await page.evaluate(() => window.game.islets.list.reduce((a, it) => a + it.flora.lodSwaps, 0));
  await step(120);
  const sw1 = await page.evaluate(() => window.game.islets.list.reduce((a, it) => a + it.flora.lodSwaps, 0));
  ok('no LOD flicker while standing still', sw1 === sw0, `${sw0} -> ${sw1}`);
  ok('no pageerror', errors.length === 0, errors.join(' | '));
} catch (e) { ok('run', false, e.message); }
clearTimeout(kill); await browser.close();
const pass = res.filter(Boolean).length; console.log(`${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1);
