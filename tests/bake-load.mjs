// Load-time A/B for Order 48c (baked tiles). Serves a dist dir on a port (Cloudflare-like: /assets immutable,
// gzip on), loads the game N times in one browser context (1st = cold, rest = warm HTTP cache) and reports
// marks.gen (world grids ready), marks.firstFrame and islet grid times.
// Usage: node tests/bake-load.mjs <distDir> <port> [runs=4]
import { chromium, devices } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
const root = path.resolve(process.argv[2] ?? 'dist'), port = +(process.argv[3] ?? 4195), runs = +(process.argv[4] ?? 4);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.wasm': 'application/wasm', '.json': 'application/json', '.bin': 'application/octet-stream' };
const srv = http.createServer((req, res) => {
  let u = decodeURIComponent((req.url ?? '/').split('?')[0]); if (u.endsWith('/')) u += 'index.html';
  const f = path.join(root, u);
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  const imm = u.startsWith('/assets/') || u.startsWith('/tiles/');
  const h = { 'content-type': types[path.extname(f)] ?? 'application/octet-stream', 'cache-control': imm ? 'public, max-age=31536000, immutable' : 'no-cache' };
  const body = fs.readFileSync(f);
  if (/gzip/.test(req.headers['accept-encoding'] ?? '') && !/png|wasm/.test(h['content-type'])) { h['content-encoding'] = 'gzip'; res.writeHead(200, h); return res.end(zlib.gzipSync(body, { level: 6 })); }
  res.writeHead(200, h); res.end(body);
}).listen(port);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const kill = setTimeout(() => { console.log('TIMEOUT'); done(2); }, 400000);
async function done(c) { clearTimeout(kill); try { await browser.close(); } catch {} srv.close(); process.exit(c); }
const rows = [];
try {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], deviceScaleFactor: 1, viewport: { width: 1024, height: 768 } });
  for (let r = 0; r < runs; r++) {
    const page = await ctx.newPage(); page.setDefaultTimeout(150000);
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://localhost:${port}/?webgl&q=low&nonews&nosw&whatsnew=0`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.game?.ready === true && window.__loadTiming?.marks?.firstFrame > 0);
    await page.waitForFunction(() => window.game.islets?.stats?.[0]?.state === 'ready', undefined, { timeout: 60000 }).catch(() => {});
    const m = await page.evaluate(() => ({ gen: Math.round(window.__loadTiming.marks.gen), firstFrame: Math.round(window.__loadTiming.marks.firstFrame),
      genMode: window.game.genStats?.mode, islet0: window.game.islets?.stats?.[0] && { ms: window.game.islets.stats[0].genMs, mode: window.game.islets.stats[0].genMode } }));
    rows.push({ run: r === 0 ? 'cold' : 'warm', ...m, errors: errors.length });
    console.log(JSON.stringify(rows[rows.length - 1]));
    await page.close();
  }
  const w = rows.filter((x) => x.run === 'warm'), med = (a) => a.slice().sort((p, q) => p - q)[Math.floor(a.length / 2)];
  console.log('SUMMARY', JSON.stringify({ root, coldFirstFrame: rows[0].firstFrame, warmFirstFrameMedian: med(w.map((x) => x.firstFrame)), warmGenMedian: med(w.map((x) => x.gen)), errors: rows.reduce((a, x) => a + x.errors, 0) }));
  await done(0);
} catch (e) { console.log('ERR', e.message); await done(1); }
