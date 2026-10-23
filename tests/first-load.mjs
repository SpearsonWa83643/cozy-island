// First-load hitch check (Order 30.5): ?debug overlay reports first-10 s frame stats; the settle pass
// (whole-scene compile + full-res primer frame) runs before reveal and the early frames stay smooth.
// Compares against ?nosettle. Usage: node tests/first-load.mjs [baseUrl]
import { chromium, devices } from 'playwright';

const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const kill = setTimeout(() => { console.error('TIMEOUT 230s'); browser.close().finally(() => process.exit(1)); }, 230_000);
let code = 1;
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n} ${x}`); return !!c; };
async function run(extra, shot) {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], deviceScaleFactor: 1, viewport: { width: 1024, height: 768 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}?webgl&q=low&nonews&nosw&debug${extra}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.game?.ready === true, undefined, { timeout: 120_000 });
  await page.waitForFunction(() => window.__loadTiming?.frames?.done === true, undefined, { timeout: 40_000 });
  const r = await page.evaluate(() => {
    const L = window.__loadTiming, f = L.frames, d = f.deltas.slice();
    const sorted = d.slice().sort((a, b) => a - b), med = sorted[Math.floor(sorted.length / 2)];
    return { n: f.n, long: f.long, max: Math.round(f.max), avg: +(f.sum / f.n).toFixed(1), med, early: Math.round(Math.max(...d.slice(0, 5))), first5: d.slice(0, 5),
      settle: 'settle' in L.marks, overlay: document.getElementById('load-timing')?.textContent ?? '' };
  });
  if (shot) await page.screenshot({ path: shot });
  await ctx.close();
  return { ...r, errors };
}
try {
  const a = await run('', 'screenshots/order30_5-first-load.png');
  const b = await run('&nosettle');
  const { overlay, ...as } = a; const { overlay: _o, ...bs } = b;
  console.log('settle  ', JSON.stringify(as));
  console.log('nosettle', JSON.stringify(bs));
  let all = true;
  all = ok('settle pass ran before reveal', a.settle) && all;
  all = ok('overlay shows first-10 s frame stats', /first 10 s\s+\d+ long/.test(overlay), overlay.split('\n').pop()) && all;
  all = ok('early frames (first 5) not a hitch vs steady state', a.early <= Math.max(a.med * 4, 120), `early ${a.early} ms, median ${a.med} ms`) && all;
  all = ok('early frames no worse than without settle', a.early <= b.early * 1.25 + 30, `${a.early} vs ${b.early} ms`) && all;
  all = ok('no pageerror', a.errors.length === 0 && b.errors.length === 0, [...a.errors, ...b.errors].join(' | ')) && all;
  code = all ? 0 : 1;
} catch (e) { console.error(e); } finally { clearTimeout(kill); await browser.close(); }
process.exit(code);
