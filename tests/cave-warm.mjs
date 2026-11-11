// Hidden-scenery precompile (polish Nov 10): the cave interior, rainbow, night beams etc. compile in the
// background after first play, so the first trip underground doesn't stall on shader compile.
// iPad viewport. Usage: node tests/cave-warm.mjs [baseUrl]  (default: subpath-server on dist/)
import { chromium, devices } from 'playwright';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const kill = setTimeout(() => { console.error('TIMEOUT 240s'); browser.close().finally(() => process.exit(1)); }, 240_000);
let fails = 0;
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${x ? ' ' + x : ''}`); if (!c) fails++; };
try {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'] });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(base + '?webgl');
  await page.waitForFunction(() => window.game?.ready, null, { timeout: 200_000 });
  const warm = await page.waitForFunction(() => window.game.caveWarm === true, null, { timeout: 60_000 }).then(() => true, () => false);
  ok('cave interior precompiled in the background', warm);
  const rb = await page.evaluate(() => {
    const g = window.game, m = g.scene.getObjectByName('rainbow'); if (!m) return null;
    m.visible = true; const a = performance.now(); g.renderer.render(g.scene, g.camera); const first = performance.now() - a;
    const b = performance.now(); g.renderer.render(g.scene, g.camera); const second = performance.now() - b; m.visible = false;
    return { first: +first.toFixed(1), second: +second.toFixed(1), warmed: g.hiddenWarmed };
  });
  console.log('first rainbow frame', rb);
  ok('first rainbow frame has no compile stall', rb && rb.first < rb.second * 3 + 40 && rb.warmed > 0, JSON.stringify(rb));
  ok('interior stays hidden outside', await page.evaluate(() => window.game.cave.interior.visible === false));
  const t = await page.evaluate(() => {
    const g = window.game; g.setCave(true);
    const a = performance.now(); g.renderer.render(g.scene, g.camera); const first = performance.now() - a;
    const b = performance.now(); g.renderer.render(g.scene, g.camera); const second = performance.now() - b;
    g.setCave(false); return { first: +first.toFixed(1), second: +second.toFixed(1) };
  });
  console.log('first cave frame', t);
  ok('first cave frame has no compile stall (< 3x a warm frame + 40 ms)', t.first < t.second * 3 + 40, JSON.stringify(t));
  ok('no pageerror', errs.length === 0, errs.join(' | '));
} catch (e) { console.error(e); fails++; }
finally { clearTimeout(kill); await browser.close(); }
process.exit(fails ? 1 : 0);
