// A/B of shader/pipeline warm-up for two dist folders (iPad viewport, software render), runs alternate.
// Reports compile time (dress -> compile mark), interactive mark, unique vertex/fragment programs and render pipelines,
// plus median frame time over 60 frames from a fixed overview camera; saves that view per dist to tmp-shots/.
// Usage: node tests/compile-ab.mjs <distA> <distB> [runs=3]
import { chromium, devices } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const dirs = process.argv.slice(2, 4), runs = Number(process.argv[4] ?? 3);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.wasm': 'application/wasm', '.json': 'application/json' };
const serve = (root, port) => http.createServer((req, res) => {
  let u = decodeURIComponent((req.url ?? '/').split('?')[0]); if (u.endsWith('/')) u += 'index.html';
  const f = path.join(root, u); if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] ?? 'application/octet-stream', 'cache-control': 'no-cache' }); res.end(fs.readFileSync(f));
}).listen(port);
const srvs = dirs.map((d, i) => serve(path.resolve(d), 4230 + i));
const shots = new URL('../tmp-shots/', import.meta.url).pathname; fs.mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const out = dirs.map(() => []);
try {
  for (let r = 0; r < runs; r++) for (let i = 0; i < dirs.length; i++) {
    const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], deviceScaleFactor: 1 });
    try {
      const page = await ctx.newPage(); page.setDefaultTimeout(400000);
      await page.goto(`http://localhost:${4230 + i}/?webgl&q=low&nosw&whatsnew=0&debug`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__loadTiming?.marks?.interactive > 0, null, { timeout: 400000 });
      const st = await page.evaluate(() => {
        const k = window.__loadTiming.marks, P = window.game.renderer.renderer._pipelines;
        return { compile: Math.round(k.compile - k.dress), interactive: Math.round(k.interactive), vert: P.programs.vertex.size, frag: P.programs.fragment.size, pipelines: P.caches.size };
      });
      if (r === runs - 1) {
        await page.evaluate(() => { const g = window.game; g.rig.locked = true; g.camera.position.set(38, 26, 46); g.camera.lookAt(0, 0, 0); });
        st.frameMs = await page.evaluate(() => new Promise((res) => { const t = []; let last = performance.now(); const f = (now) => { t.push(now - last); last = now; if (t.length < 60) requestAnimationFrame(f); else { t.sort((a, b) => a - b); res(Math.round(t[30] * 10) / 10); } }; requestAnimationFrame(f); }));
        await page.screenshot({ path: `${shots}compile-ab-${i ? 'B' : 'A'}.png` });
      }
      out[i].push(st); console.log(r, dirs[i], JSON.stringify(st));
    } finally { await ctx.close(); }
  }
  const med = (a) => a.slice().sort((p, q) => p - q)[Math.floor(a.length / 2)];
  dirs.forEach((d, i) => { const keys = ['compile', 'interactive', 'vert', 'frag', 'pipelines']; console.log('MEDIAN', i ? 'B' : 'A', d, JSON.stringify(Object.fromEntries(keys.map((x) => [x, med(out[i].map((s) => s[x]))]))), 'frameMs', out[i].at(-1).frameMs); });
} finally { await browser.close(); srvs.forEach((s) => s.close()); }
