// Order 48c: baked islet tiles. Against a built dist (npm run build, served e.g. by `npx vite preview --port 4196`):
// every islet's grid comes from its baked .tile (mode 'baked', fetched 200), heights are bit-identical to the
// worker-generated grids (?bake=off), and the tiles are small. Usage: node tests/bake.mjs [baseUrl]
import { chromium, devices } from 'playwright';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4196/';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const kill = setTimeout(() => { console.log('TIMEOUT'); browser.close().finally(() => process.exit(2)); }, 420000);
const res = []; const ok = (n, c, x = '') => { res.push(!!c); console.log(c ? 'PASS' : 'FAIL', n, x); };
async function run(q) {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], hasTouch: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(180000);
  const errors = [], tiles = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => { if (r.url().endsWith('.tile')) tiles.push({ url: r.url().split('/').pop(), status: r.status() }); });
  await page.goto(`${base}?webgl&q=low&touch=1&whatsnew=0&nosw&nonews${q}`);
  await page.waitForFunction(() => window.game?.ready);
  // step the sim until every islet grid is in (islets start generating near the camera)
  for (let i = 0; i < 120; i++) {
    const s = await page.evaluate(() => { for (let k = 0; k < 30; k++) window.game.step(1 / 60); return window.game.islets.list.every((it) => it.state === 'ready'); });
    if (s) break; await page.waitForTimeout(250);
  }
  const r = await page.evaluate(() => {
    const g = window.game, out = { stats: g.islets.list.map((it) => ({ id: it.def.id, state: it.state, mode: it.stats.genMode, ms: it.stats.genMs })), h: [] };
    let a = 12345; const rnd = () => ((a = (a * 1103515245 + 12345) >>> 0) / 4294967296);
    for (const it of g.islets.list) for (let i = 0; i < 300; i++) out.h.push(g.heightAt(it.def.x + (rnd() - 0.5) * 180, it.def.z + (rnd() - 0.5) * 180));
    return out;
  });
  await ctx.close();
  return { ...r, errors, tiles };
}
try {
  const a = await run('');
  const b = await run('&bake=off');
  console.log('baked ', JSON.stringify(a.stats), JSON.stringify(a.tiles));
  console.log('worker', JSON.stringify(b.stats));
  ok('all islets ready', a.stats.every((s) => s.state === 'ready') && b.stats.every((s) => s.state === 'ready'));
  ok('every islet grid came from its baked tile', a.stats.length >= 4 && a.stats.every((s) => s.mode === 'baked'));
  ok('one .tile fetched per islet, all 200', a.tiles.length === a.stats.length && a.tiles.every((t) => t.status === 200), a.tiles.length);
  ok('?bake=off falls back to the gen worker, no tile fetch', b.stats.every((s) => s.mode === 'worker') && b.tiles.length === 0);
  let diff = 0; for (let i = 0; i < a.h.length; i++) diff = Math.max(diff, Math.abs(a.h[i] - b.h[i]));
  ok('baked heights bit-identical to worker heights', diff === 0 && a.h.length === b.h.length, `max diff ${diff} over ${a.h.length} pts`);
  ok('no pageerror', a.errors.length + b.errors.length === 0, [...a.errors, ...b.errors].join(' | '));
} catch (e) { ok('run', false, e.message); }
clearTimeout(kill); await browser.close();
const pass = res.filter(Boolean).length; console.log(`${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1);
