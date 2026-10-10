// Rough frame-time probe (software rendering on the box: compare runs, not absolute numbers).
// Usage: node tests/perf.mjs [baseUrl]
import { chromium, devices } from 'playwright';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const out = {};
for (const [name, opts, q] of [
  ['ipad-low', { ...devices['iPad Pro 11 landscape'], deviceScaleFactor: 1 }, 'low'],
  ['desktop-low', { viewport: { width: 1440, height: 810 } }, 'low'],
]) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.setDefaultTimeout(240000);
  await page.goto(`${base}?webgl&q=${q}`);
  await page.waitForFunction(() => window.game?.ready);
  const ms = await page.evaluate(async () => {
    const g = window.game;
    g.player.teleport(0, 6, Math.PI); g.rig.yaw = 0.3; g.rig.pitch = 0.35; g.rig.distance = 9;
    const frames = (n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    await frames(5);
    const t0 = performance.now(); await frames(12); const raf = (performance.now() - t0) / 12;
    // CPU-side sim cost
    const t1 = performance.now(); for (let i = 0; i < 120; i++) g.step(1 / 60); const sim = (performance.now() - t1) / 120;
    return { frameMs: +raf.toFixed(1), simMs: +sim.toFixed(2), calls: g.renderer.renderer.info.render.drawCalls ?? g.renderer.renderer.info.render.calls };
  });
  out[name] = ms;
  console.log(name, ms);
  await ctx.close();
}
await browser.close();
