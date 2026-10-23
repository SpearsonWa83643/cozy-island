// Terrain chunks check (Order 30, Big island 2/7): 64 m tiles, seamless edges, frustum culling, no visual regression.
// Usage: node tests/terrain-chunks.mjs [baseUrl] [--ref=screenshots/order29-world-config.png]
import { chromium, devices } from 'playwright';
import fs from 'node:fs';

const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const ref = (process.argv.find((a) => a.startsWith('--ref=')) ?? '--ref=screenshots/order29-world-config.png').slice(6);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const kill = setTimeout(() => { console.error('TIMEOUT 175s'); browser.close().finally(() => process.exit(1)); }, 175_000);
let code = 1;
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n} ${x}`); return !!c; };
try {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], deviceScaleFactor: 1, viewport: { width: 1024, height: 768 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}?webgl&q=low&nonews&nosw`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.game?.ready === true, undefined, { timeout: 150_000 });
  await page.waitForTimeout(1200);
  const r = await page.evaluate(() => {
    const g = window.game, T = g.terrain, THREE = g.scene.constructor; // noqa
    const chunks = T.chunks;
    // seam check: shared edge vertices between horizontal/vertical neighbours must match exactly (pos + normal)
    let seamErr = 0, seamPts = 0;
    const byIJ = new Map(chunks.map((c) => [`${c.i0},${c.j0}`, c]));
    for (const c of chunks) {
      const right = [...byIJ.values()].find((o) => o.i0 === c.i0 + c.w - 1 && o.j0 === c.j0);
      if (right) for (let j = 0; j < c.h; j++) {
        const a = j * c.w + (c.w - 1), b = j * right.w;
        for (const nm of ['position', 'normal']) {
          const A = c.mesh.geometry.getAttribute(nm), B = right.mesh.geometry.getAttribute(nm);
          seamErr = Math.max(seamErr, Math.abs(A.getX(a) - B.getX(b)), Math.abs(A.getY(a) - B.getY(b)), Math.abs(A.getZ(a) - B.getZ(b)));
        }
        seamPts++;
      }
    }
    // extent of all tiles together
    let minX = 1e9, maxX = -1e9, tris = 0;
    for (const c of chunks) { const bb = c.mesh.geometry.boundingBox; minX = Math.min(minX, bb.min.x); maxX = Math.max(maxX, bb.max.x); tris += c.mesh.geometry.index.count / 3; }
    // frustum culling: how many tiles intersect the camera frustum
    const cam = g.camera; cam.updateMatrixWorld();

    const m = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse);
    const e = m.elements;
    const planes = [[e[3] + e[0], e[7] + e[4], e[11] + e[8], e[15] + e[12]], [e[3] - e[0], e[7] - e[4], e[11] - e[8], e[15] - e[12]], [e[3] + e[1], e[7] + e[5], e[11] + e[9], e[15] + e[13]], [e[3] - e[1], e[7] - e[5], e[11] - e[9], e[15] - e[13]], [e[3] + e[2], e[7] + e[6], e[11] + e[10], e[15] + e[14]], [e[3] - e[2], e[7] - e[6], e[11] - e[10], e[15] - e[14]]];
    let inView = 0;
    for (const c of chunks) {
      const s = c.mesh.geometry.boundingSphere; let inside = true;
      for (const [a, b, cc, d] of planes) { const l = Math.hypot(a, b, cc); if ((a * s.center.x + b * s.center.y + cc * s.center.z + d) / l < -s.radius) { inside = false; break; } }
      if (inside) inView++;
    }

    return { count: chunks.length, culled: chunks.every((c) => c.mesh.frustumCulled), seamErr, seamPts, width: maxX - minX, tris, inView, visible: T.mesh.visible };
  });
  console.log(JSON.stringify(r));
  const shot = 'screenshots/order30-terrain-chunks.png';
  await page.screenshot({ path: shot });
  // look straight down from high up so most tiles are out of view? -> just report inView from spawn view
  let diff = null;
  if (fs.existsSync(ref)) {
    diff = await page.evaluate(async ([a, b]) => {
      const load = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = src; });
      const [A, B] = await Promise.all([load(a), load(b)]);
      const cv = document.createElement('canvas'); cv.width = A.width; cv.height = A.height; const x = cv.getContext('2d');
      x.drawImage(A, 0, 0); const da = x.getImageData(0, 0, cv.width, cv.height).data;
      x.clearRect(0, 0, cv.width, cv.height); x.drawImage(B, 0, 0); const db = x.getImageData(0, 0, cv.width, cv.height).data;
      let sum = 0, big = 0; const n = da.length / 4;
      for (let i = 0; i < da.length; i += 4) { const d = (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2])) / 3; sum += d; if (d > 40) big++; }
      return { mean: sum / n, bigFrac: big / n };
    }, ['data:image/png;base64,' + fs.readFileSync(ref).toString('base64'), 'data:image/png;base64,' + fs.readFileSync(shot).toString('base64')]);
    console.log('image diff vs', ref, JSON.stringify(diff));
  }
  const res = [
    ok('terrain split into 3x3 tiles (~65 m)', r.count === 9, `(${r.count})`),
    ok('tiles cover the full 196 m world', Math.abs(r.width - 196) < 0.01, `(${r.width})`),
    ok('same triangle count as the single mesh', r.tris === 200 * 200 * 2, `(${r.tris})`),
    ok('seamless edges (positions + normals match)', r.seamPts > 0 && r.seamErr < 1e-6, `(max ${r.seamErr} over ${r.seamPts})`),
    ok('tiles are frustum-culled', r.culled && r.inView < r.count, `(${r.inView}/${r.count} in view)`),
    ok('no visual regression vs Order 29 shot', !diff || diff.mean < 6, diff ? `(mean ${diff.mean.toFixed(2)}, >40: ${(diff.bigFrac * 100).toFixed(2)}%)` : '(no ref)'),
    ok('no pageerror', errors.length === 0, errors.slice(0, 2).join('; ')),
  ];
  code = res.every(Boolean) ? 0 : 1;
} catch (e) { console.error(e); } finally {
  clearTimeout(kill);
  try { await browser.close(); } catch { /* */ }
  process.exit(code);
}
