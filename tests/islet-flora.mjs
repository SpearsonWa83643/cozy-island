// Blossom Isle flora + visibility + map (Order 42b), iPad touch viewport: once the islet streams in, its cherry grove,
// meadow plants and landing pennant build a species per frame; the landing spot (facing home) is dry, gentle and clear;
// cherry canopies recolour on a theme switch; the islet's land gets the haze lift; the map shows an inset with the
// player marker inside it while you're on the islet. No console errors. Timeout + browser closed in finally.
// Usage: node tests/islet-flora.mjs [baseUrl] [--no-shots]
import { chromium, devices } from 'playwright';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4193/';
const kill = setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 420000);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = []; const ok = (n, c, x = '') => { results.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
const errFilter = (m) => (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|swiftshader|Automatic fallback/i.test(m.text())));
const shots = !process.argv.includes('--no-shots');
try {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], hasTouch: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(120000);
  const errors = []; page.on('console', (m) => { if (errFilter(m)) errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '?webgl&q=low&touch=1&whatsnew=0&theme=spring');
  await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => document.getElementById('whatsnew')?.querySelector('.w-ok')?.click());
  const step = (n) => page.evaluate((n) => { for (let i = 0; i < n; i++) window.game.step(1 / 60); }, n);
  const fs = () => page.evaluate(() => window.game.islets.floraStats[0]);
  await step(260);
  for (let i = 0; i < 60 && (await page.evaluate(() => window.game.islets.stats[0].state)) !== 'ready'; i++) { await page.waitForTimeout(250); await step(2); }
  for (let i = 0; i < 40 && !(await fs()).built; i++) await step(2);
  const f = await fs();
  ok('islet flora built after stream-in', f.built && f.visible && f.placed > 120, JSON.stringify(f));
  ok('cherry grove planted', f.cherries >= 20, String(f.cherries));
  const land = await page.evaluate(() => {
    const g = window.game, fl = g.islets.list[0].flora, L = fl.landing, m4 = new (g.scene.matrixWorld.constructor)();
    let near = 99;
    for (const im of fl.group.children) { if (!im.isInstancedMesh) continue; for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, m4); const x = m4.elements[12], z = m4.elements[14]; near = Math.min(near, Math.hypot(x - L.x, z - L.z)); } }
    const toHome = Math.hypot(L.x, L.z) < Math.hypot(190, 190);
    return { h: +g.heightAt(L.x, L.z).toFixed(2), near: +near.toFixed(1), toHome, pennant: !!fl.group.getObjectByName('landing-pennant') };
  });
  ok('landing spot is dry land facing home', land.h > 1 && land.toHome, JSON.stringify(land));
  ok('landing spot clear of plants (>6 m)', land.near > 6, JSON.stringify(land));
  ok('landing pennant placed', land.pennant, JSON.stringify(land));
  // theme switch recolours the cherry canopies
  const rc = await page.evaluate(() => { const g = window.game, fl = g.islets.list[0].flora, im = fl.group.getObjectByName('cherry'); const c0 = Array.from(im.geometry.attributes.color.array.slice(-3)); g.themes.set('halloween'); const c1 = Array.from(im.geometry.attributes.color.array.slice(-3)); return { c0, c1, rec: fl.recolours }; });
  ok('cherry blossoms recolour per theme', rc.rec >= 1 && rc.c0.join() !== rc.c1.join(), JSON.stringify(rc));
  await page.evaluate(() => window.game.themes.set('spring')); await step(120);
  ok('islet haze lift on', await page.evaluate(() => window.game.atmos.isletClear.value > 0.5));
  // (the islet seen from the main shore: screenshots/order42a-islet-from-shore.png; here the reverse view from its landing)
  // stand at the landing spot; the grove + pennant
  await page.evaluate(() => { const g = window.game, L = g.islets.list[0].flora.landing; g.player.teleport(L.x + 2, L.z + 2, 0); for (let i = 0; i < 90; i++) g.step(1 / 30); g.rig.yaw = -Math.PI * 0.25; g.rig.pitch = 0.3; g.rig.distance = 14; });
  await step(40);
  const st = await page.evaluate(() => { const g = window.game, p = g.player.position; return { y: +p.y.toFixed(2), h: +g.heightAt(p.x, p.z).toFixed(2), swimming: g.player.swimming }; });
  ok('player stands at the landing spot', !st.swimming && Math.abs(st.y - st.h) < 0.6, JSON.stringify(st));
  if (shots) { await page.waitForTimeout(700); await page.screenshot({ path: 'screenshots/order42b-blossom-grove.png' }).catch((e) => console.log('shot failed', e.message)); await page.evaluate(() => { window.game.rig.yaw += Math.PI; }); await step(20); await page.waitForTimeout(500); await page.screenshot({ path: 'screenshots/order42b-landing-looking-home.png' }).catch((e) => console.log('shot failed', e.message)); }
  // map: inset with the marker inside it
  await page.evaluate(() => window.game.play.toggleMap()); await page.waitForTimeout(900); await step(2);
  const mp = await page.evaluate(() => { const me = document.querySelector('.map-me'); return { open: document.querySelector('.map-overlay')?.classList.contains('open'), left: parseFloat(me.style.left), top: parseFloat(me.style.top) }; });
  ok('map marker sits in the Blossom Isle inset (top-right)', mp.open && mp.left > 70 && mp.top < 36, JSON.stringify(mp));
  if (shots) { await page.screenshot({ path: 'screenshots/order42b-map-inset.png' }).catch((e) => console.log('shot failed', e.message)); }
  ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) { ok('test ran', false, e.message); }
finally { clearTimeout(kill); await browser.close(); }
const pass = results.filter(Boolean).length; console.log(`${pass}/${results.length} passed`); process.exit(pass === results.length ? 0 : 1);
