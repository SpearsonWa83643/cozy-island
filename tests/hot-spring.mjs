// Blossom Isle hot spring (Order 46a), iPad touch viewport: the pool is built on flat dry meadow, clear of the
// landing and the cherry grove; steam rises; walking in makes you sit and soak (body sinks, first-time toast,
// ♨️/💗 bubbles); walking out stands you back up; islet treasure spots avoid the pool. Timeout + browser closed in finally.
// Usage: node tests/hot-spring.mjs [baseUrl] [--no-shots]
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
  await page.goto(base + '?webgl&q=low&touch=1&whatsnew=0&theme=winter');
  await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => document.getElementById('whatsnew')?.querySelector('.w-ok')?.click());
  const step = (n) => page.evaluate((n) => { for (let i = 0; i < n; i++) window.game.step(1 / 60); }, n);
  const fs = () => page.evaluate(() => window.game.islets.floraStats[0]);
  const s0 = (await fs()).spring;
  ok('hot spring site found on Blossom Isle', !!s0 && Math.hypot(s0.x - 190, s0.z + 190) < 50, JSON.stringify(s0));
  await page.evaluate(([x, z]) => window.game.player.teleport(x + 6, z + 6, 0), [s0.x, s0.z]);
  for (let i = 0; i < 80 && (await page.evaluate(() => window.game.islets.stats[0].state)) !== 'ready'; i++) { await page.waitForTimeout(250); await step(4); }
  for (let i = 0; i < 60 && !(await fs()).built; i++) await step(2);
  const f = await fs();
  ok('pool built with the islet flora', f.built && f.spring?.built, JSON.stringify(f.spring));
  const site = await page.evaluate(() => {
    const g = window.game, fl = g.islets.list[0].flora, S = fl.spring, L = fl.landing, m4 = new (g.scene.matrixWorld.constructor)();
    let near = 99;
    for (const im of fl.group.children) { if (!im.isInstancedMesh) continue; for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, m4); near = Math.min(near, Math.hypot(m4.elements[12] - S.pos.x, m4.elements[14] - S.pos.z)); } }
    let lo = 99, hi = -99; for (let i = 0; i < 16; i++) { const a = i / 16 * 6.283; const h = g.heightAt(S.pos.x + Math.cos(a) * 2.4, S.pos.z + Math.sin(a) * 2.4); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    return { near: +near.toFixed(1), land: +Math.hypot(L.x - S.pos.x, L.z - S.pos.z).toFixed(1), flat: +(hi - lo).toFixed(2), dry: lo > 0.7, waterAbove: S.water > hi, parts: S.group.children.map((c) => c.name) };
  });
  ok('pool on flat dry meadow, water covers its floor', site.dry && site.flat < 0.65 && site.waterAbove, JSON.stringify(site));
  ok('clear of plants (>3 m) and the landing (>10 m)', site.near > 3 && site.land > 10, JSON.stringify(site));
  ok('rocks + water + steam meshes', ['hot-spring-rocks', 'hot-spring-water', 'hot-spring-steam'].every((n) => site.parts.includes(n)), site.parts.join());
  const steam = await page.evaluate(() => { const st = window.game.islets.list[0].flora.spring.group.getObjectByName('hot-spring-steam'), m4 = new (window.game.scene.matrixWorld.constructor)(); st.getMatrixAt(3, m4); const y0 = m4.elements[13]; for (let i = 0; i < 20; i++) window.game.step(1 / 60); st.getMatrixAt(3, m4); return { y0, y1: m4.elements[13] }; });
  ok('steam drifts', Math.abs(steam.y1 - steam.y0) > 0.005, JSON.stringify(steam));
  // walk in (teleport to the edge, then autowalk into the centre via the joystick-free path: teleport inside)
  await page.evaluate(() => { const g = window.game, S = g.islets.list[0].flora.spring; g.player.teleport(S.pos.x, S.pos.z, Math.PI * 0.75); g.rig.yaw = Math.PI * 0.75 + Math.PI; g.rig.pitch = 0.32; g.rig.distance = 9; });
  await step(200);
  const soak = await page.evaluate(() => { const g = window.game; return { soaking: g.player.soaking, blend: +g.player.soakBlend.toFixed(2), soaked: !!g.play.save.data.soaked, soaks: g.play.soaks, toast: document.body.innerText.includes('hot spring'), swimming: g.player.swimming }; });
  ok('standing in the pool → soaking (body sinks)', soak.soaking && soak.blend > 0.8 && !soak.swimming, JSON.stringify(soak));
  ok('first soak: toast + saved', soak.soaked && soak.toast, JSON.stringify(soak));
  ok('soak bubbles while you stay', soak.soaks >= 1, JSON.stringify(soak));
  if (shots) { await page.waitForTimeout(800); await page.screenshot({ path: 'screenshots/order46a-hot-spring.png' }).catch((e) => console.log('shot failed', e.message)); }
  await page.evaluate(() => { const g = window.game, S = g.islets.list[0].flora.spring; g.player.teleport(S.pos.x + 6, S.pos.z - 1, 0); });
  await step(90);
  ok('out of the pool → stands up', await page.evaluate(() => !window.game.player.soaking && window.game.player.soakBlend < 0.1));
  // islet treasure never lands in the pool
  const tr = await page.evaluate(() => { const p = window.game.play, d = p.save.data, S = p.g.islets.list[0].flora.spring.pos; d.treasures = ['pterodactyl_egg', 'cloud_puppy_tuft', 'rainbow_horseshoe', 'shimmer_wing', 'sea_pearl']; let min = 99;
    for (let s = 0; s < 40; s++) { d.map.seed = 500 + s * 977; d.map.n = 3 + 4 * (s % 5); d.map.x = 0; d.map.z = 0; p.treasure.newSpot(); if (Math.hypot(d.map.x - 190, d.map.z + 190) < 70) min = Math.min(min, Math.hypot(d.map.x - S.x, d.map.z - S.z)); } return +min.toFixed(1); });
  ok('islet treasure spots keep clear of the pool (>5 m)', tr > 5, String(tr));
  ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) { ok('test ran', false, e.message); }
finally { clearTimeout(kill); await browser.close(); }
const pass = results.filter(Boolean).length; console.log(`${pass}/${results.length} passed`); process.exit(pass === results.length ? 0 : 1);
