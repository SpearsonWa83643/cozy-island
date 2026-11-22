// A/B steady-state render cost for two dist folders (iPad viewport, software GL), runs alternate:
// draw calls (main + shadow pass), triangles, CPU ms inside renderer.render, median frame time, from a fixed overview camera.
// Saves that view per dist to tmp-shots/draw-ab-A.png / -B.png.
// Usage: node tests/draw-ab.mjs <distA> <distB> [runs=3] [extraQuery e.g. &q=low]
import { chromium, devices } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const dirs = process.argv.slice(2, 4), runs = Number(process.argv[4] ?? 3), q = process.argv[5] ?? '';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.wasm': 'application/wasm', '.json': 'application/json' };
const serve = (root, port) => http.createServer((req, res) => {
  let u = decodeURIComponent((req.url ?? '/').split('?')[0]); if (u.endsWith('/')) u += 'index.html';
  const f = path.join(root, u); if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] ?? 'application/octet-stream', 'cache-control': 'no-cache' }); res.end(fs.readFileSync(f));
}).listen(port);
const srvs = dirs.map((d, i) => serve(path.resolve(d), 4240 + i));
const shots = new URL('../tmp-shots/', import.meta.url).pathname; fs.mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const out = dirs.map(() => []);
try {
  for (let r = 0; r < runs; r++) for (let i = 0; i < dirs.length; i++) {
    const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], deviceScaleFactor: 1 });
    try {
      const page = await ctx.newPage(); page.setDefaultTimeout(400000);
      await page.goto(`http://localhost:${4240 + i}/?webgl&nosw&whatsnew=0&debug${q}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__loadTiming?.marks?.interactive > 0, null, { timeout: 400000 });
      const st = await page.evaluate(async () => {
        const g = window.game, R = g.renderer.renderer;
        const frames = (n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
        g.rig.locked = true; g.camera.position.set(38, 26, 46); g.camera.lookAt(0, 0, 0);
        await frames(20);
        let n = 0, tot = 0; const orig = R.render;
        R.render = function () { const t = performance.now(); const v = orig.apply(this, arguments); tot += performance.now() - t; n++; return v; };
        const t = []; await new Promise((res) => { let last = performance.now(); const f = (now) => { t.push(now - last); last = now; if (t.length < 40) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
        R.render = orig; t.sort((a, b) => a - b);
        const info = R.info.render;
        return { draws: info.drawCalls, tris: info.triangles, renderCpuMs: +(tot / Math.max(1, n)).toFixed(1), frameMs: +t[20].toFixed(1) };
      });
      if (r === runs - 1) await page.screenshot({ path: `${shots}draw-ab-${i ? 'B' : 'A'}.png` });
      out[i].push(st); console.log(r, dirs[i], JSON.stringify(st));
    } finally { await ctx.close(); }
  }
  const med = (a) => a.slice().sort((p, q) => p - q)[Math.floor(a.length / 2)];
  dirs.forEach((d, i) => console.log('MEDIAN', i ? 'B' : 'A', d, JSON.stringify(Object.fromEntries(['draws', 'tris', 'renderCpuMs', 'frameMs'].map((x) => [x, med(out[i].map((s) => s[x]))])))));
} finally { await browser.close(); srvs.forEach((s) => s.close()); }
