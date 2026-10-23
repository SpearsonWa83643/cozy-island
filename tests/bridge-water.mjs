// Deferred Order 40 check: tap-to-place a bridge over REAL water (a stream/puddle gap), then walk across it.
// The player must stay on the deck (never swims, never sinks into the water) and reach the far bank.
// Usage: node tests/bridge-water.mjs [baseUrl] [--no-shots]
import { chromium, devices } from 'playwright';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4193/';
const shots = !process.argv.includes('--no-shots');
const kill = setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 600000);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = []; const ok = (n, c, x = '') => { results.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
try {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], deviceScaleFactor: 1, hasTouch: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(120000);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|swiftshader|Automatic fallback/i.test(m.text()))) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  const boot = async () => { await page.waitForFunction(() => window.game?.ready); await page.evaluate(() => document.getElementById('whatsnew')?.querySelector('.w-ok')?.click()); };
  await page.goto(base + '?webgl&q=low&touch=1&whatsnew=0'); await boot();
  await page.evaluate(() => localStorage.clear()); await page.reload(); await boot();
  const frames = (n) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

  // find a real water gap a bridge can span: deep water in the middle, both banks on land at similar height
  const gap = await page.evaluate(() => {
    const g = window.game, H = g.heightAt, span = 1.3, cands = [];
    for (let x = -60; x <= 60; x++) for (let z = -60; z <= 60; z++) {
      const c = H(x, z); if (c > -0.1) continue; // under water
      for (const rot of [0, Math.PI / 2]) {
        const dx = Math.sin(rot) * span, dz = Math.cos(rot) * span;
        const a = H(x - dx, z - dz), b = H(x + dx, z + dz);
        if (a >= -0.1 && b >= -0.1 && Math.abs(a - b) <= 0.3) cands.push({ x, z, rot, c: +c.toFixed(2), a: +a.toFixed(2), b: +b.toFixed(2), d: Math.hypot(x, z) });
      }
    }
    cands.sort((p, q) => p.c - q.c); return { n: cands.length, best: cands[0] };
  });
  ok('found a real water gap a bridge can span', gap.n > 0, JSON.stringify(gap));
  const G = gap.best;
  // stand on the near bank (beside the bridge axis, clear of the footprint), look across the gap; pick the camera yaw that frames it
  const view = await page.evaluate(async (G) => {
    const g = window.game, dx = Math.sin(G.rot), dz = Math.cos(G.rot), sx = Math.cos(G.rot), sz = -Math.sin(G.rot);
    let px = G.x - dx * 2.4, pz = G.z - dz * 2.4;
    for (const [ox, oz] of [[0, 0], [sx * 1.2, sz * 1.2], [-sx * 1.2, -sz * 1.2], [-dx, -dz]]) { if (g.heightAt(px + ox, pz + oz) > -0.3) { px += ox; pz += oz; break; } }
    g.player.teleport(px, pz);
    const fr = (n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    await fr(20);
    let best = null;
    for (let i = 0; i < 8; i++) {
      g.rig.yaw = (i / 8) * Math.PI * 2; g.rig.pitch = 0.8; g.rig.distance = 8; g.rig.apply?.(); await fr(8);
      const v = g.camera.position.clone().set(G.x, Math.max(0, g.heightAt(G.x, G.z)), G.z).project(g.camera);
      const off = Math.hypot(v.x, v.y); if (v.z < 1 && (!best || off < best.off)) best = { yaw: g.rig.yaw, off };
    }
    g.rig.yaw = best.yaw; g.rig.apply?.(); await fr(10);
    return { px, pz, best };
  }, G);
  console.log('view', JSON.stringify(view));
  const toScreen = (x, z, y) => page.evaluate(([x, z, y]) => { const g = window.game; const v = g.camera.position.clone().set(x, y ?? g.heightAt(x, z), z); v.project(g.camera); return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, inView: Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.95 }; }, [x, z, y]);
  const c = await page.evaluate(() => { const r = document.querySelector('.tbtn.build').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.touchscreen.tap(c.x, c.y); await frames(3);
  await page.evaluate((G) => { const b = window.game.build; b.select(19); while (Math.abs(b.rotation - G.rot) > 0.01) b.rotate(); }, G);
  await frames(20);
  const n0 = await page.evaluate(() => window.game.build.count);
  const p = await toScreen(G.x, G.z);
  ok('gap is on screen for the tap', p.inView, JSON.stringify(p));
  await page.touchscreen.tap(p.x, p.y); await frames(6);
  const br = await page.evaluate(([n0]) => { const g = window.game, b = g.build; const q = b.pieces[n0]; return q ? { placed: b.count === n0 + 1, id: q.def.id, x: q.obj.position.x, y: +q.obj.position.y.toFixed(2), z: q.obj.position.z, r: +q.obj.rotation.y.toFixed(2) } : { placed: false, count: b.count, ghostValid: b.ghostValid, target: b.target }; }, [n0]);
  ok('bridge tap-placed over the water gap', br.placed && br.id === 'bridge' && br.x === G.x && br.z === G.z, JSON.stringify(br));
  ok('bridge rests on the bank, above the water line', br.y >= 0.05, JSON.stringify(br));
  await frames(20);
  if (shots) await page.screenshot({ path: 'screenshots/order40-bridge-over-water.png', timeout: 90000 }).catch((e) => console.log('shot failed', e.message));
  await page.touchscreen.tap(c.x, c.y); await frames(3); // leave Build Mode
  const st = await page.evaluate(() => { const g = window.game; return { buildActive: g.build.active, enabled: g.player.enabled }; });
  console.log('after build', JSON.stringify(st));
  if (st.buildActive) { await page.evaluate(() => window.game.build.toggle(false)); await frames(5); }

  // walk across, both directions
  const walk = (fx, fz, tx, tz, n = 360) => page.evaluate(async ([fx, fz, tx, tz, n]) => {
    const g = window.game; g.play.walk.cancel(false); g.player.teleport(fx, fz);
    for (let i = 0; i < 40; i++) await new Promise((r) => requestAnimationFrame(r));
    g.play.walk.go({ pos: () => ({ x: tx, z: tz }), reach: 0.3, key: '' }, false);
    let swam = false, minMid = 1e9, maxY = -1e9, nMid = 0, fr = 0; const s0 = { ...g.play.walk.stats }; let P = g.player.position; const k = P.y - g.heightAt(P.x, P.z); // capsule centre above the feet
    for (let i = 0; i < n && g.play.walk.goal; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      fr++; P = g.player.position; swam ||= g.player.swimming; maxY = Math.max(maxY, P.y);
      const t = ((P.x - fx) * (tx - fx) + (P.z - fz) * (tz - fz)) / ((tx - fx) ** 2 + (tz - fz) ** 2);
      if (t > 0.2 && t < 0.8) { minMid = Math.min(minMid, P.y - k); nMid++; } // feet height over the water part of the span
    }
    return { fr, stats: [s0, { ...g.play.walk.stats }], enabled: g.player.enabled, build: g.build.active, swam, nMid, minMid: +minMid.toFixed(2), maxY: +maxY.toFixed(2), end: { x: +(P = g.player.position).x.toFixed(2), z: +P.z.toFixed(2) }, arrived: !g.play.walk.goal };
  }, [fx, fz, tx, tz, n]);
  const dx = Math.sin(G.rot), dz = Math.cos(G.rot), L = 1.9;
  const there = await walk(G.x - dx * L, G.z - dz * L, G.x + dx * L, G.z + dz * L);
  ok('player walks across the bridge to the far bank', there.arrived, JSON.stringify(there));
  ok('never falls into the water going over (feet stay on the deck, above the water line)', !there.swam && there.nMid > 0 && there.minMid > 0.03, JSON.stringify({ br, there }));
  const back = await walk(G.x + dx * L, G.z + dz * L, G.x - dx * L, G.z - dz * L);
  ok('walks back across, still dry', back.arrived && !back.swam && back.nMid > 0 && back.minMid > 0.03, JSON.stringify(back));
  ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
} catch (e) { console.error(e); results.push(false); } finally { clearTimeout(kill); await browser.close().catch(() => {}); }
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
