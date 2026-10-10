// Rough frame-time probe on Low (software rendering on the box: compare runs back-to-back, not absolute numbers).
// Usage: node tests/perf.mjs [baseUrl ...]   (several URLs are measured alternately for A/B)
import { chromium, devices } from 'playwright';
const urls = process.argv.filter((a) => a.startsWith('http'));
if (!urls.length) urls.push('http://localhost:4181/cozy-island/');
const rounds = +(process.argv.find((a) => a.startsWith('--rounds='))?.slice(9) ?? 1);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const __closeBrowser = async (code) => { try { await browser.close(); } catch { /* ignore */ } process.exit(code); };
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => __closeBrowser(130));
process.on('uncaughtException', (e) => { console.error(e); __closeBrowser(1); });
process.on('unhandledRejection', (e) => { console.error(e); __closeBrowser(1); });
for (let r = 0; r < rounds; r++) for (const base of urls) {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(300000);
  await page.goto(`${base}?webgl&q=low`);
  await page.waitForFunction(() => window.game?.ready);
  const res = await page.evaluate(async () => {
    const g = window.game;
    g.player.teleport(0, 6, Math.PI); g.rig.yaw = 0.3; g.rig.pitch = 0.35; g.rig.distance = 9;
    const frames = (n) => new Promise((res) => { const ts = []; let k = 0; const f = (t) => { ts.push(t); (++k >= n ? res(ts) : requestAnimationFrame(f)); }; requestAnimationFrame(f); });
    await frames(30);
    const ts = await frames(25);
    const d = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b);
    const t1 = performance.now(); for (let i = 0; i < 120; i++) g.step(1 / 60); const sim = (performance.now() - t1) / 120;
    const info = g.renderer.renderer.info.render;
    return { medianFrameMs: +d[Math.floor(d.length / 2)].toFixed(1), simMs: +sim.toFixed(2), drawCalls: info.drawCalls ?? info.calls, triangles: info.triangles };
  });
  console.log(base, res);
  await ctx.close();
}
await browser.close();
