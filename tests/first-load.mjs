// First-load hitch check (Order 30.5): ?debug overlay reports first-10 s frame stats; the settle pass
// (whole-scene compile + full-res primer frame) runs before reveal and the early frames stay smooth.
// Compares against ?nosettle. Pipelines created in the first frames after reveal are counted from three's pipeline cache. Usage: node tests/first-load.mjs [baseUrl]
import { chromium, devices } from 'playwright';

const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const kill = setTimeout(() => { console.error('TIMEOUT 230s'); browser.close().finally(() => process.exit(1)); }, 230_000);
let code = 1;
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n} ${x}`); return !!c; };
async function run(extra, shot) {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], deviceScaleFactor: 1, viewport: { width: 1024, height: 768 } });
  const page = await ctx.newPage();
  const errors = [], logs = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => logs.push(m.text()));
  // three.js render pipelines created per frame for the first 10 frames after reveal (each one is a shader link on the spot)
  await page.addInitScript(() => {
    const rec = (window.__pipes = []); let base = -1;
    const tick = () => { const g = window.game, p = g?.renderer?.renderer?._pipelines;
      if (g?.ready && p) { const n = p.caches.size; if (base < 0) base = n; rec.push(n - base); base = n; }
      if (rec.length < 10) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  await page.goto(`${base}?webgl&q=low&nonews&nosw&debug${extra}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.game?.ready === true, undefined, { timeout: 120_000 });
  await page.waitForFunction(() => window.__loadTiming?.frames?.done === true, undefined, { timeout: 40_000 });
  const r = await page.evaluate(() => {
    const L = window.__loadTiming, f = L.frames, d = f.deltas.slice();
    const sorted = d.slice().sort((a, b) => a - b), med = sorted[Math.floor(sorted.length / 2)];
    return { n: f.n, long: f.long, max: Math.round(f.max), avg: +(f.sum / f.n).toFixed(1), med, early: Math.round(Math.max(...d.slice(0, 5))), first5: d.slice(0, 5),
      pipes: window.__pipes.slice(), overlay: document.getElementById('load-timing')?.textContent ?? '' };
  });
  if (shot) await page.screenshot({ path: shot });
  await ctx.close();
  return { ...r, settle: logs.some((t) => t.includes('[warmup] settle')), errors };
}
try {
  const a = await run('', 'screenshots/order30_5-first-load.png');
  const b = await run('&nosettle');
  const { overlay, ...as } = a; const { overlay: _o, ...bs } = b;
  console.log('settle  ', JSON.stringify(as));
  console.log('nosettle', JSON.stringify(bs));
  let all = true;
  all = ok('settle pass ran before reveal (and not with ?nosettle)', a.settle && !b.settle) && all;
  all = ok('overlay shows first-10 s frame stats', /first 10 s\s+\d+ long/.test(overlay), overlay.split('\n').pop()) && all;
  // 2026-11-23: on the box's software GL the first frames after reveal are slow for the rasteriser's own reasons
  // (no new pipelines, no game work), so an absolute early-vs-median bound was flaky (3/5 since Nov 11). What the
  // settle pass must guarantee is that nothing compiles in those frames; early-vs-median stays in the output.
  const early5 = a.pipes.slice(0, 5).reduce((x, y) => x + y, 0);
  all = ok('no shader/pipeline compiles in the first 5 frames after reveal', a.pipes.length >= 5 && early5 === 0, `settle ${JSON.stringify(a.pipes)} vs nosettle ${JSON.stringify(b.pipes)}; early ${a.early} ms, median ${a.med} ms`) && all;
  const sum5 = (x) => x.pipes.slice(0, 5).reduce((p, q) => p + q, 0);
  all = ok('no more early compiles than without settle', sum5(a) <= sum5(b), `${sum5(a)} vs ${sum5(b)} pipelines; early frame ${a.early} vs ${b.early} ms (info: software-GL timing is noisy)`) && all;
  all = ok('no pageerror', a.errors.length === 0 && b.errors.length === 0, [...a.errors, ...b.errors].join(' | ')) && all;
  code = all ? 0 : 1;
} catch (e) { console.error(e); } finally { clearTimeout(kill); await browser.close(); }
process.exit(code);
