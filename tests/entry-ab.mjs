// A/B cold-load timing of two dist folders (iPad viewport, 20 Mbps/60 ms): physics, gameplay marks and when the entry card is up.
// Usage: node tests/entry-ab.mjs <distA> <distB>
import { chromium, devices } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
const dirs = process.argv.slice(2, 4), runs = 3;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.wasm': 'application/wasm', '.json': 'application/json' };
const serve = (root, port) => http.createServer((req, res) => {
  let u = decodeURIComponent((req.url ?? '/').split('?')[0]); if (u.endsWith('/')) u += 'index.html';
  const f = path.join(root, u); if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  const h = { 'content-type': types[path.extname(f)] ?? 'application/octet-stream', 'cache-control': 'no-cache' }; const body = fs.readFileSync(f);
  if (!/png|wasm/.test(h['content-type'])) { h['content-encoding'] = 'gzip'; res.writeHead(200, h); return res.end(zlib.gzipSync(body, { level: 6 })); }
  res.writeHead(200, h); res.end(body);
}).listen(port);
const srvs = dirs.map((d, i) => serve(path.resolve(d), 4196 + i));
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const out = {};
try {
  for (let r = 0; r < runs; r++) for (let i = 0; i < dirs.length; i++) {
    const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], deviceScaleFactor: 1 });
    const page = await ctx.newPage(); page.setDefaultTimeout(150000);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 60, downloadThroughput: 20e6 / 8, uploadThroughput: 5e6 / 8 });
    await page.goto(`http://localhost:${4196 + i}/?webgl&q=low&nosw&whatsnew=0&entry=1&debug`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__loadTiming?.marks?.gameplay > 0 && document.querySelector('#entry'));
    const m = await page.evaluate(() => { const k = window.__loadTiming.marks; const e = performance.getEntriesByType('resource').find((x) => /Entry-/.test(x.name)); return { physics: Math.round(k.physics), gameplay: Math.round(k.gameplay), entryAt: Math.round(performance.now()) }; });
    (out[dirs[i]] ??= []).push(m); console.log(dirs[i], JSON.stringify(m));
    await ctx.close();
  }
  const med = (a) => a.slice().sort((p, q) => p - q)[Math.floor(a.length / 2)];
  for (const d of dirs) console.log('MEDIAN', d, 'physics', med(out[d].map((x) => x.physics)), 'gameplay', med(out[d].map((x) => x.gameplay)));
} finally { await browser.close(); srvs.forEach((s) => s.close()); }
