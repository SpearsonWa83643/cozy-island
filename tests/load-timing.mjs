// ?debug load-timing overlay smoke (iPad-ish viewport).
// Usage: node tests/load-timing.mjs [baseUrl]
// Default: http://localhost:4181/cozy-island/ (tests/subpath-server.mjs on dist/)
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'screenshots');
fs.mkdirSync(outDir, { recursive: true });

const OVERALL_MS = 180_000;
const readyTimer = setTimeout(() => { console.error('TIMEOUT: overall 180s'); __closeBrowser(1); }, OVERALL_MS);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const __closeBrowser = async (code) => {
  clearTimeout(readyTimer);
  try { await browser.close(); } catch { /* */ }
  process.exit(code);
};
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => __closeBrowser(130));
process.on('uncaughtException', (e) => { console.error(e); __closeBrowser(1); });
process.on('unhandledRejection', (e) => { console.error(e); __closeBrowser(1); });

const results = {};
const ok = (name, cond, extra = '') => {
  results[name] = !!cond;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' ' + extra : ''}`);
};

let code = 0;
try {
  const dev = devices['iPad Pro 11 landscape'];
  const ctx = await browser.newContext({ ...dev, deviceScaleFactor: 1, viewport: { width: 1024, height: 768 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(150_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.text().startsWith('[warmup]')) console.log(m.text()); });

  await page.goto(`${base}?debug&webgl&q=low`, { waitUntil: 'domcontentloaded' });
  // cozy loader: progress bar + stage text visible while the island warms up
  await page.waitForFunction(() => {
    const v = +(document.getElementById('loading')?.getAttribute('aria-valuenow') ?? 0);
    return v >= 60 || window.game?.ready === true;
  }, { timeout: 120_000 });
  const ld = await page.evaluate(() => ({
    stage: document.getElementById('ld-stage')?.textContent ?? '',
    pct: +(document.getElementById('loading')?.getAttribute('aria-valuenow') ?? 0),
    ready: window.game?.ready === true,
  }));
  if (!ld.ready) await page.screenshot({ path: path.join(outDir, 'loading-screen-ipad.png') });
  console.log('loader', ld);
  await page.waitForFunction(() => window.game?.ready === true, { timeout: 150_000 });
  const done = await page.evaluate(() => +(document.getElementById('loading')?.getAttribute('aria-valuenow') ?? 0));
  // wait for first rendered frame marks
  await page.waitForFunction(() => {
    const m = window.__loadTiming?.marks;
    return m && typeof m.firstFrame === 'number' && m.firstFrame > 0;
  }, { timeout: 30_000 });

  const shot = path.join(outDir, 'load-timing-debug.png');
  await page.screenshot({ path: shot, fullPage: false });
  console.log('screenshot', shot);

  const info = await page.evaluate(() => {
    const el = document.getElementById('load-timing');
    const text = el?.textContent ?? '';
    const marks = window.__loadTiming?.marks ?? {};
    const msMatch = text.match(/(\d+)\s*ms/);
    return {
      hasOverlay: !!el,
      text,
      pointerEvents: el ? getComputedStyle(el).pointerEvents : null,
      marks,
      enabled: !!window.__loadTiming?.enabled,
      positiveMs: msMatch ? +msMatch[1] : 0,
    };
  });
  console.log('overlay text:\n' + info.text);
  console.log('marks', info.marks);

  ok('overlay exists', info.hasOverlay);
  ok('overlay shows positive ms', info.positiveMs > 0, `(${info.positiveMs})`);
  ok('pointer-events none', info.pointerEvents === 'none');
  ok('__loadTiming.enabled', info.enabled);
  ok('physics mark > 0', (info.marks.physics ?? 0) > 0, `(${info.marks.physics})`);
  ok('firstFrame mark > 0', (info.marks.firstFrame ?? 0) > 0, `(${info.marks.firstFrame})`);
  ok('loader shows stage text', ld.ready || ld.stage.length > 0, `(${ld.pct}% ${ld.stage})`);
  ok('loader reaches 100%', done === 100, `(${done})`);
  ok('no pageerror', errors.length === 0, errors.slice(0, 2).join('; '));

  // without ?debug, overlay should be absent
  await page.goto(`${base}?webgl&q=low`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.game?.ready === true, { timeout: 120_000 });
  const off = await page.evaluate(() => !!document.getElementById('load-timing'));
  ok('no overlay without debug', !off);

  await ctx.close();
  code = Object.values(results).every(Boolean) ? 0 : 1;
} catch (e) {
  console.error(e);
  code = 1;
} finally {
  await __closeBrowser(code);
}
