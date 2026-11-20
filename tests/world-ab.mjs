// A/B of world-build stage timings for two dist folders (iPad viewport, software render, no throttle), runs alternate.
// Usage: node tests/world-ab.mjs <distA> <distB> [runs=5]
import { chromium, devices } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const dirs = process.argv.slice(2, 4), runs = Number(process.argv[4] ?? 5);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.wasm': 'application/wasm', '.json': 'application/json' };
const serve = (root, port) => http.createServer((req, res) => {
  let u = decodeURIComponent((req.url ?? '/').split('?')[0]); if (u.endsWith('/')) u += 'index.html';
  const f = path.join(root, u); if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] ?? 'application/octet-stream', 'cache-control': 'no-cache' }); res.end(fs.readFileSync(f));
}).listen(port);
const srvs = dirs.map((d, i) => serve(path.resolve(d), 4198 + i));
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const order = ['gen', 'physics', 'terrain', 'water', 'flora', 'cave', 'fauna', 'reef', 'renderer', 'gameplay', 'dress'];
const out = {};
try {
  for (let r = 0; r < runs; r++) for (let i = 0; i < dirs.length; i++) {
    const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], deviceScaleFactor: 1 });
    try {
      const page = await ctx.newPage(); page.setDefaultTimeout(180000);
      await page.goto(`http://localhost:${4198 + i}/?webgl&q=low&nosw&whatsnew=0&debug`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__loadTiming?.marks?.dress > 0);
      const k = await page.evaluate(() => ({ ...window.__loadTiming.marks }));
      const st = {}; for (let j = 1; j < order.length; j++) st[order[j]] = Math.round(k[order[j]] - k[order[j - 1]]);
      st.world = Math.round(k.dress - k.gen); st.renderer_at = Math.round(k.renderer); st.dress_at = Math.round(k.dress);
      (out[dirs[i]] ??= []).push(st); console.log(r, dirs[i], JSON.stringify(st));
    } finally { await ctx.close(); }
  }
  const med = (a) => a.slice().sort((p, q) => p - q)[Math.floor(a.length / 2)];
  for (const d of dirs) { const keys = Object.keys(out[d][0]); console.log('MEDIAN', d, JSON.stringify(Object.fromEntries(keys.map((x) => [x, med(out[d].map((s) => s[x]))])))); }
} finally { await browser.close(); srvs.forEach((s) => s.close()); }
