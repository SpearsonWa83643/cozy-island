// Terrain heightfield collider check (Order 19; streamed 3x3 ring since Order 36): Rapier ground matches the visual terrain, player stands on it.
// Usage: node tests/heightfield.mjs [baseUrl]   (default http://localhost:4181/cozy-island/)
import { chromium, devices } from 'playwright';

const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const kill = setTimeout(() => { console.error('TIMEOUT 420s'); browser.close().finally(() => process.exit(1)); }, 420_000);
let code = 1;
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n} ${x}`); return !!c; };
const probe = () => {
  const g = window.game, R = g.physics.R, w = g.physics.world;
  let maxErr = 0, n = 0, miss = 0, bad = 0;
  for (let i = 0; i < 60; i++) {
    const x = g.player.position.x + Math.sin(i * 12.9898) * 28, z = g.player.position.z + Math.cos(i * 78.233) * 28 + (i % 7) * 0.37;
    const o = g.player.position.clone().set(x, 40, z);
    const vis = g.terrain.raycast(o, o.clone().set(0, -1, 0), 120);
    const hit = w.castRay(new R.Ray({ x, y: 40, z }, { x: 0, y: -1, z: 0 }), 120, true, undefined, undefined, undefined, g.player.body);
    if (!vis) continue;
    if (!hit) { miss++; continue; }
    const y = 40 - hit.timeOfImpact;
    if (y > vis.y + 0.05) continue; // hit a tree/rock/building above ground: not terrain
    maxErr = Math.max(maxErr, Math.abs(y - vis.y)); if (Math.abs(y - vis.y) > 0.15) bad++; n++;
  }
  const p = g.player.position;
  return { maxErr, n, miss, bad, feet: p.y, ground: g.terrain.raycast(p.clone().setY(p.y + 5), p.clone().set(0, -1, 0), 20)?.y ?? null, marks: window.__loadTiming?.marks ?? {} };
};
try {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], deviceScaleFactor: 1, viewport: { width: 1024, height: 768 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}?webgl&q=low&nonews&nosw&debug`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.game?.ready === true, undefined, { timeout: 150_000 });
  await page.waitForTimeout(1500); // let the player settle
  const r = await page.evaluate(probe);
  const hf = () => page.evaluate(() => { let n = 0, rows = 0; window.game.physics.world.forEachCollider((c) => { const r = c.heightfieldNRows?.() ?? 0; if (r > 0) { n++; rows = r; } }); const pc = window.game.physChunks; return { n, rows, active: pc?.active ?? null, total: pc?.tiles.length ?? null }; });
  const h0 = await hf();
  const shape = h0.rows;
  console.log(JSON.stringify({ ...r, marks: undefined, terrainToWater: (r.marks.water - r.marks.terrain).toFixed(0) + 'ms', hfRows: shape }));
  const res = [
    ok('streamed: only the 3x3 ring of terrain tiles has colliders', h0.n === h0.active && h0.n >= 4 && h0.n <= 9 && h0.total >= 25, JSON.stringify(h0)),
    ok('collider matches visual terrain', r.n >= 20 && r.bad <= 1 && r.maxErr < 0.5 && r.miss === 0, `(max ${r.maxErr.toFixed(3)} m, ${r.bad} pts > 0.15 m over ${r.n} pts, miss ${r.miss}; one known spot at (-25.7, 2.4) differs by 0.34 m with ?fullphys too)`),
    ok('player stands on the ground', r.ground !== null && Math.abs(r.feet - r.ground) < 0.6, `(feet ${r.feet.toFixed(2)} ground ${r.ground?.toFixed(2)})`),
  ];
  // walk across tile borders + teleport far away: the ring follows, the player never falls through
  const walk = await page.evaluate(async () => {
    const g = window.game, out = [];
    const frames = (n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    const spots = [[-30, -6], [-33, 0], [20, -20], [32.6, -16], [-14, 30], [6, 33], [28, -10], [0, 6]];
    for (const [x, z] of spots) {
      g.player.teleport(x, z); await frames(40);
      const p = g.player.position, gr = g.terrain.raycast(p.clone().setY(p.y + 5), p.clone().set(0, -1, 0), 40)?.y ?? null;
      const t = g.physChunks.tileOf(p.x, p.z), act = g.physChunks.tiles.filter((q) => q.col).map((q) => [q.ci, q.cj]);
      const ringOk = act.length <= 9 && act.every(([ci, cj]) => Math.abs(ci - t.ci) <= 1 && Math.abs(cj - t.cj) <= 1);
      out.push({ x, z, feet: +p.y.toFixed(2), ground: gr === null ? null : +gr.toFixed(2), swim: g.player.swimming, ringOk });
    }
    // walk east over a border with the stick
    g.player.teleport(-2, 6); await frames(20);
    const key = () => { const t = g.physChunks.tileOf(g.player.position.x, g.player.position.z); return t.ci + ',' + t.cj; }; const t0 = key();
    g.input.stick.x = 1; g.input.stick.y = 0;
    let crossed = false; for (let k = 0; k < 60 && !crossed; k++) { await frames(5); crossed = key() !== t0; }
    await frames(20); g.input.stick.x = 0;
    const p = g.player.position, gr = g.terrain.raycast(p.clone().setY(p.y + 5), p.clone().set(0, -1, 0), 40)?.y ?? null;
    return { out, crossed, walkFeet: p.y, walkGround: gr, stats: g.physChunks.stats };
  });
  console.log(JSON.stringify(walk));
  res.push(ok('teleports across the island: feet on the ground, ring follows', walk.out.every((o) => o.ringOk && (o.swim || (o.ground !== null && Math.abs(o.feet - o.ground) < 0.7))), JSON.stringify(walk.out.filter((o) => !(o.ringOk && (o.swim || (o.ground !== null && Math.abs(o.feet - o.ground) < 0.7)))))));
  res.push(ok('walking over a tile border keeps the player on the ground', walk.crossed && walk.walkGround !== null && Math.abs(walk.walkFeet - walk.walkGround) < 0.7, `(crossed ${walk.crossed}, feet ${walk.walkFeet?.toFixed(2)} ground ${walk.walkGround?.toFixed(2)})`));
  res.push(ok('tiles stream in and out', walk.stats.removed > 0 && walk.stats.added > walk.stats.removed));
  res.push(ok('no pageerror', errors.length === 0, errors.slice(0, 2).join('; ')));
  code = res.every(Boolean) ? 0 : 1;
} catch (e) { console.error(e); } finally {
  clearTimeout(kill);
  try { await browser.close(); } catch { /* */ }
  process.exit(code);
}
