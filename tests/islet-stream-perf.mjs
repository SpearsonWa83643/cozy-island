// Blossom Isle stream-in memory + frame-time check (Order 42c), iPad touch viewport, real-time loop.
// A scripted flight (player + camera teleported along a path every rAF) goes from the main island's NE shore to the
// islet landing spot and back, 3 loops, with a small islet stream radius so its tiles really load/unload each loop and
// its heightfield colliders swap. Measures: main-thread time of every streaming job (tile build/unload, flora step,
// collider swap, grid upload), long tasks overlapping a streaming job vs. a no-streaming baseline flight over the
// main island (separates the software renderer's noise), and the JS heap + GPU geometry count after GC at the end of
// loops 2 and 3 (stable = no growth). Acceptance: no streaming hitch over 100 ms. Writes /tmp/islet-stream-perf.json.
// Usage: node tests/islet-stream-perf.mjs [baseUrl]
import { chromium, devices } from 'playwright';
import { writeFileSync } from 'node:fs';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4193/';
const kill = setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 600000);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const results = []; const ok = (n, c, x = '') => { results.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
const out = {};
try {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], hasTouch: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(180000);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => { window.__lt = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push({ t: e.startTime, d: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch {} });
  await page.goto(base + '?webgl&q=low&touch=1&whatsnew=0&nosw');
  await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => document.getElementById('whatsnew')?.querySelector('.w-ok')?.click());
  await page.waitForFunction(() => window.game.islets.ready && window.game.islets.list[0].flora.built, undefined, { timeout: 180000 });
  const boot = await page.evaluate(() => window.game.islets.log.filter((e) => e.kind !== 'phys').map((e) => ({ kind: e.kind, ms: +e.ms.toFixed(1) })));
  out.boot = boot;
  const bootMax = Math.max(...boot.map((e) => e.ms));
  ok('boot stream-in jobs (grid upload, 4 tiles, flora species) each < 100 ms', bootMax < 100, JSON.stringify(boot));
  const cdp = await ctx.newCDPSession(page);
  const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); await page.waitForTimeout(300); await cdp.send('HeapProfiler.collectGarbage'); return page.evaluate(() => ({ heapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(2), geos: window.game.renderer.renderer.info.memory.geometries, tex: window.game.renderer.renderer.info.memory.textures, isletBytes: window.game.islets.stats[0].bytes, sceneGeos: (() => { const m = {}; window.game.scene.traverse((o) => { if (o.geometry) { const k = (o.parent?.name || '?') + '/' + (o.name || o.type); m[k] = (m[k] ?? 0) + 1; } }); return m; })(), isletGeos: (() => { let n = 0; window.game.islets.group.traverse((o) => { if (o.geometry && o.visible && o.geometry.attributes.position) n++; }); return n; })(), loaded: window.game.islets.stats[0].loaded })); };
  // a flight: from A to B and back over `secs` seconds of wall time, altitude-free (player teleported, camera follows)
  const fly = (a, b, secs) => page.evaluate(({ a, b, secs }) => new Promise((res) => {
    const g = window.game, t0 = performance.now(), dts = []; let last = t0, ev0 = g.islets.log.length;
    const lt0 = window.__lt.length;
    const tick = () => {
      const now = performance.now(), u = Math.min(1, (now - t0) / (secs * 1000)), k = u < 0.35 ? u / 0.35 : u < 0.65 ? 1 : (1 - u) / 0.35;
      const x = a.x + (b.x - a.x) * k, z = a.z + (b.z - a.z) * k;
      g.player.teleport(x, z, Math.atan2(b.x - a.x, b.z - a.z) + (u < 0.5 ? 0 : Math.PI));
      dts.push(now - last); last = now;
      if (u < 1) requestAnimationFrame(tick);
      else try {
        const evs = g.islets.log.slice(ev0).filter((e) => e.t >= t0);
        const lts = window.__lt.slice(lt0).filter((l) => l.t >= t0);
        const streamLT = lts.filter((l) => evs.some((e) => e.kind !== 'phys' || e.ms > 2 ? e.t >= l.t - 1 && e.t <= l.t + l.d : false));
        const ds = dts.slice(1).sort((p, q) => p - q);
        res({ frames: dts.length, maxDt: +(ds[ds.length - 1] ?? 0).toFixed(1), p50: +(ds[Math.floor(ds.length * 0.5)] ?? 0).toFixed(1), p95: +(ds[Math.min(ds.length - 1, Math.floor(ds.length * 0.95))] ?? 0).toFixed(1),
          evs: evs.length, evMax: +Math.max(0, ...evs.map((e) => e.ms)).toFixed(1), kinds: evs.reduce((m, e) => (m[e.kind] = (m[e.kind] ?? 0) + 1, m), {}),
          lt: lts.length, ltMax: +Math.max(0, ...lts.map((l) => l.d)).toFixed(0), streamLT: streamLT.length, streamLTMax: +Math.max(0, ...streamLT.map((l) => l.d)).toFixed(0),
          streamShareMax: +Math.max(0, ...lts.map((l) => evs.filter((e) => e.t >= l.t - 1 && e.t <= l.t + l.d).reduce((a, e) => a + e.ms, 0))).toFixed(1) });
      } catch (e) { res({ error: String(e), frames: dts.length, kinds: {}, evMax: 0, streamLTMax: 0, ltMax: 0 }); }
    };
    requestAnimationFrame(tick);
  }), { a, b, secs });
  // the same path stepped deterministically at 60 Hz (no render): every streaming job runs, then settles at the shore
  const stepFly = (a, b) => page.evaluate(({ a, b }) => {
    const g = window.game, t0 = performance.now(), ev0 = g.islets.log.length, N = 300; let worst = 0;
    const at = (k) => g.player.teleport(a.x + (b.x - a.x) * k, a.z + (b.z - a.z) * k);
    const st = () => { const s0 = performance.now(); g.step(1 / 60); worst = Math.max(worst, performance.now() - s0); };
    for (let i = 0; i <= N; i++) { at(i / N); st(); }
    for (let i = 0; i < 90; i++) { at(1); st(); }
    for (let i = N; i >= 0; i--) { at(i / N); st(); }
    for (let i = 0; i < 90; i++) { at(0); st(); }
    const evs = g.islets.log.slice(ev0).filter((e) => e.t >= t0);
    return { steps: 2 * N + 182, worstStepMs: +worst.toFixed(1), evMax: +Math.max(0, ...evs.map((e) => e.ms)).toFixed(1), kinds: evs.reduce((m, e) => (m[e.kind] = (m[e.kind] ?? 0) + 1, m), {}) };
  }, { a, b });
  const L = await page.evaluate(() => { const l = window.game.islets.list[0].flora.landing; return { x: l.x, z: l.z }; });
  const shore = { x: 20, z: -20 };
  // baseline: same-length flight over the main island only (no islet work), streaming radius small so nothing loads
  await page.evaluate(() => { window.game.islets.radius = 70; });
  await fly({ x: 30, z: -30 }, { x: 31, z: -31 }, 3); // let the islet unload at the new radius
  const baseline = await fly({ x: -40, z: 30 }, { x: 30, z: -30 }, 12);
  out.baseline = baseline; console.log('baseline', JSON.stringify(baseline));
  const loops = [], heaps = [];
  for (let i = 0; i < 3; i++) {
    const r = await fly(shore, L, 16); console.log(`loop ${i + 1} real-time`, JSON.stringify(r));
    const sf = await stepFly(shore, L); console.log(`loop ${i + 1} stepped`, JSON.stringify(sf));
    r.stepped = sf; r.evMax = Math.max(r.evMax, sf.evMax); loops.push(r);
    heaps.push(await heap()); console.log(`heap ${i + 1}`, JSON.stringify({ ...heaps[i], sceneGeos: Object.values(heaps[i].sceneGeos).reduce((a, b) => a + b, 0) }));
  }
  out.loops = loops; out.heaps = heaps;
  const st = await page.evaluate(() => window.game.islets.stats[0]); out.stats = st;
  ok('streaming exercised every loop (tiles loaded + unloaded)', loops.every((r) => (r.stepped.kinds.load ?? 0) >= 4 && (r.stepped.kinds.unload ?? 0) >= 4), JSON.stringify(loops.map((r) => r.stepped.kinds)));
  const evMax = Math.max(...loops.map((r) => r.evMax));
  ok('every in-flight streaming job < 100 ms of main thread', evMax < 100, `max ${evMax} ms`);
  // swiftshader renders take seconds, so every long task is mostly renderer; the hitch streaming adds is the streaming
  // work that ran inside it (sum of logged jobs in that task's window)
  const share = Math.max(...loops.map((r) => r.streamShareMax ?? 0));
  ok('no stream-attributable hitch > 100 ms (streaming work inside any long task)', share < 100, `max ${share} ms of streaming inside a long task; long tasks overlapping streaming max ${Math.max(...loops.map((r) => r.streamLTMax))} ms vs no-streaming baseline max ${baseline.ltMax} ms (software renderer)`);
  const worstStep = Math.max(...loops.map((r) => r.stepped.worstStepMs));
  ok('worst whole sim step (incl. streaming) on the stepped flights < 100 ms', worstStep < 100, `${worstStep} ms`);
  const dHeap = heaps[2].heapMB - heaps[1].heapMB;
  ok('JS heap stable after 2 loops (loop 3 - loop 2 < 2 MB)', dHeap < 2, `${heaps.map((h) => h.heapMB).join(' → ')} MB`);
  const diff = {}; for (const k of new Set([...Object.keys(heaps[1].sceneGeos), ...Object.keys(heaps[2].sceneGeos)])) { const d = (heaps[2].sceneGeos[k] ?? 0) - (heaps[1].sceneGeos[k] ?? 0); if (d) diff[k] = d; }
  console.log('scene geometry diff loop2→3', JSON.stringify(diff));
  ok('islet geometry + bytes stable after 2 loops (nothing islet-side retained)', heaps[2].isletGeos === heaps[1].isletGeos && heaps[2].isletBytes === heaps[1].isletBytes, JSON.stringify(heaps.map((h) => [h.geos, h.isletGeos, h.isletBytes])));
  ok('renderer geometry count ~flat after 2 loops (≤ 2 new)', heaps[2].geos - heaps[1].geos <= 2, `${heaps.map((h) => h.geos).join(' → ')}`);
  ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) { ok('test ran', false, e.message); }
finally { clearTimeout(kill); writeFileSync('/tmp/islet-stream-perf.json', JSON.stringify(out, null, 1)); await browser.close(); }
const pass = results.filter(Boolean).length; console.log(`${pass}/${results.length} passed`); process.exit(pass === results.length ? 0 : 1);
