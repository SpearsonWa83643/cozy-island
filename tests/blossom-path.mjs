// Blossom Isle petals + lantern path (Order 46b), iPad touch viewport: a stepping-stone path with stone lanterns runs
// from the landing to the hot spring, clear of plants; cherry petals drift down and recolour per theme; sitting in
// the spring plays the soak sound. Timeout + browser closed in finally.
// Usage: node tests/blossom-path.mjs [baseUrl] [--no-shots]
import { chromium, devices } from 'playwright';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4196/cozy-island/';
const kill = setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 360000);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = []; const ok = (n, c, x = '') => { results.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
const errFilter = (m) => (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|swiftshader|Automatic fallback|willReadFrequently/i.test(m.text())));
const shots = !process.argv.includes('--no-shots');
try {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], hasTouch: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(120000);
  const errors = []; page.on('console', (m) => { if (errFilter(m)) errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '?webgl&q=low&touch=1&whatsnew=0&theme=spring');
  await page.waitForFunction(() => window.game?.ready);
  const step = (n) => page.evaluate((n) => { for (let i = 0; i < n; i++) window.game.step(1 / 60); }, n);
  const fs = () => page.evaluate(() => window.game.islets.floraStats[0]);
  await page.evaluate(() => { const L = window.game.islets.list[0].flora.landing; window.game.player.teleport(L.x + 3, L.z - 3, 0); });
  for (let i = 0; i < 80 && (await page.evaluate(() => window.game.islets.stats[0].state)) !== 'ready'; i++) { await page.waitForTimeout(250); await step(4); }
  for (let i = 0; i < 80 && !(await fs()).built; i++) await step(2);
  const f = await fs();
  ok('path + lanterns planned', f.built && f.path >= 10 && f.lanterns >= 3, JSON.stringify({ path: f.path, lanterns: f.lanterns, built: f.built }));
  const geo = await page.evaluate(() => {
    const g = window.game, fl = g.islets.list[0].flora, S = fl.spring.pos, L = fl.landing, P = fl.path, m4 = new (g.scene.matrixWorld.constructor)();
    let near = 99, dry = 99;
    for (const im of fl.group.children) { if (!im.isInstancedMesh || im.name === 'cherry-petals') continue; for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, m4); for (const s of P) near = Math.min(near, Math.hypot(m4.elements[12] - s.x, m4.elements[14] - s.z)); } }
    for (const s of P) dry = Math.min(dry, g.heightAt(s.x, s.z));
    return { start: +Math.hypot(P[0].x - L.x, P[0].z - L.z).toFixed(1), end: +Math.hypot(P.at(-1).x - S.x, P.at(-1).z - S.z).toFixed(1), near: +near.toFixed(2), dry: +dry.toFixed(2), meshes: ['lantern-path', 'lantern-lights', 'cherry-petals'].filter((n) => fl.group.getObjectByName(n)) };
  });
  ok('path runs from the landing to the spring rim', geo.start < 6 && geo.end < 4.6, JSON.stringify(geo));
  ok('path stones clear of plants (>1 m) on dry ground', geo.near > 1 && geo.dry > 0.5, JSON.stringify(geo));
  ok('path, lantern lights and petal meshes present', geo.meshes.length === 3, geo.meshes.join());
  const pet = await page.evaluate(() => {
    const g = window.game, fl = g.islets.list[0].flora, im = fl.group.getObjectByName('cherry-petals'), m4 = new (g.scene.matrixWorld.constructor)();
    const pos = () => { const a = []; for (let i = 0; i < 5; i++) { im.getMatrixAt(i * 17, m4); a.push([m4.elements[12], m4.elements[13], m4.elements[14]]); } return a; };
    const t0 = fl.petalTicks, a = pos(); for (let i = 0; i < 30; i++) g.step(1 / 60); const b = pos();
    let above = true; for (const p of b) if (p[1] < g.heightAt(p[0], p[2]) - 0.05) above = false;
    return { n: im.count, ticks: fl.petalTicks - t0, moved: +Math.max(...a.map((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1], p[2] - b[i][2]))).toFixed(3), above };
  });
  ok('petals drift (animated, above ground)', pet.n >= 60 && pet.ticks >= 30 && pet.moved > 0.01 && pet.above, JSON.stringify(pet));
  const rc = await page.evaluate(() => { const g = window.game, m = g.islets.list[0].flora.group.getObjectByName('cherry-petals').material; const c0 = m.color.getHexString(); g.themes.set('autumn'); const c1 = m.color.getHexString(); g.themes.set('spring'); return { c0, c1 }; });
  ok('petals recolour per theme', rc.c0 !== rc.c1, JSON.stringify(rc));
  await step(60);
  // screenshot: on the path between lanterns, looking along it toward the spring
  if (shots) {
    await page.evaluate(() => { const g = window.game, fl = g.islets.list[0].flora, P = fl.path, a = P[3], b = P[P.length - 1]; const yaw = Math.atan2(b.x - a.x, b.z - a.z); g.player.teleport(a.x, a.z, yaw); g.rig.yaw = yaw + Math.PI; g.rig.pitch = 0.28; g.rig.distance = 8; });
    await step(90); await page.waitForTimeout(800);
    await page.screenshot({ path: 'screenshots/order46b-lantern-path.png' }).catch((e) => console.log('shot failed', e.message));
  }
  const snd = await page.evaluate(() => { const g = window.game, S = g.islets.list[0].flora.spring.pos, s0 = g.audio.springSoaks; g.player.teleport(S.x, S.z, 0); for (let i = 0; i < 200; i++) g.step(1 / 60); const r = { soaking: g.player.soaking, calls: g.audio.springSoaks - s0 }; g.player.teleport(S.x + 6, S.z, 0); return r; });
  ok('soak sound plays on sit + while soaking', snd.soaking && snd.calls >= 2, JSON.stringify(snd));
  ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) { ok('test ran', false, e.message); }
finally { clearTimeout(kill); await browser.close(); }
const pass = results.filter(Boolean).length; console.log(`${pass}/${results.length} passed`); process.exit(pass === results.length ? 0 : 1);
