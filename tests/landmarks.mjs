// Order 48d: islet landmarks. Every generated islet gets its kind's landmark (Heron Stones / Juniper Lookout /
// Driftwood Arch) on high gentle ground away from the landing, built in the lazy flora build, solid, with flora
// kept clear of it. Saves screenshots/order48d-<kind>.png. Usage: node tests/landmarks.mjs [baseUrl] [--shots]
import { chromium, devices } from 'playwright';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4231/';
const shots = process.argv.includes('--shots');
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const kill = setTimeout(() => { console.log('TIMEOUT'); browser.close().finally(() => process.exit(2)); }, 400000);
const res = []; const ok = (n, c, x = '') => { res.push(!!c); console.log(c ? 'PASS' : 'FAIL', n, x); };
try {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], hasTouch: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(180000);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}?webgl&q=low&touch=1&whatsnew=0&nosw&nonews`);
  await page.waitForFunction(() => window.game?.ready);
  const step = (n) => page.evaluate((n) => { for (let i = 0; i < n; i++) window.game.step(1 / 60); }, n);
  for (let i = 0; i < 150; i++) {
    await step(30);
    if (await page.evaluate(() => window.game.islets.list.every((it) => it.state === 'ready' && it.flora.built))) break;
    await page.waitForTimeout(200);
  }
  const L = await page.evaluate(() => window.game.islets.list.map((it) => {
    const lm = it.flora.landmark, d = it.def;
    if (!lm) return { id: d.id, kind: d.kind ?? null, none: true };
    const p = lm.pos, inScene = !!lm.mesh && it.flora.group.children.includes(lm.mesh);
    // nearest flora instance to the landmark centre
    let near = Infinity;
    for (const o of it.flora.group.children) if (o.isInstancedMesh) { const a = o.instanceMatrix.array; for (let i = 0; i < o.count; i++) near = Math.min(near, Math.hypot(a[i * 16 + 12] - p.x, a[i * 16 + 14] - p.z)); }
    return { id: d.id, kind: d.kind, name: lm.name, found: lm.found, inScene, top: +lm.top.toFixed(1), h: +p.y.toFixed(2), fromCentre: +Math.hypot(p.x - d.x, p.z - d.z).toFixed(1), r: d.r,
      fromLanding: +Math.hypot(p.x - it.flora.landing.x, p.z - it.flora.landing.z).toFixed(1), nearestFlora: +near.toFixed(1), tris: lm.mesh ? lm.mesh.geometry.attributes.position.count / 3 : 0, x: p.x, z: p.z, solid: lm.solids[0] ?? null };
  }));
  for (const l of L) console.log(JSON.stringify(l));
  const gen = L.filter((l) => l.id !== 'blossom');
  ok('Blossom Isle keeps its hot spring, no generated landmark', L.find((l) => l.id === 'blossom')?.none === true);
  ok('every generated islet has its landmark built and in the scene', gen.length >= 3 && gen.every((l) => l.found && l.inScene));
  ok('landmark names match the islet kinds', gen.every((l) => ({ wood: 'Heron Stones', pine: 'Juniper Lookout', palm: 'Driftwood Arch' })[l.kind] === l.name), gen.map((l) => l.name).join(', '));
  ok('sited on dry high ground inside the islet', gen.every((l) => l.h > 1.5 && l.fromCentre < l.r * 0.6), gen.map((l) => `${l.h} m @ ${l.fromCentre} m`).join(', '));
  ok('well away from the landing spot', gen.every((l) => l.fromLanding >= 14), gen.map((l) => l.fromLanding).join(', '));
  ok('flora kept clear of the landmark (>= 5 m)', gen.every((l) => l.nearestFlora >= 5), gen.map((l) => l.nearestFlora).join(', '));
  ok('tall enough to read from afar (>= 3 m) and cheap (< 3000 tris, one mesh)', gen.every((l) => l.top >= 3 && l.tris < 3000), gen.map((l) => `${l.top} m/${l.tris}`).join(', '));
  // solid: walk the player into the landmark centre from 8 m out; they must stop short
  for (const l of gen) {
    const r = await page.evaluate((l) => {
      const g = window.game, S = l.solid, dx = S.x - l.x || 1, dz = S.z - l.z, n = Math.hypot(dx, dz), ux = dx / n, uz = dz / n;
      g.player.teleport(S.x + ux * 7, S.z + uz * 7, 0); for (let i = 0; i < 30; i++) g.step(1 / 60);
      const p0 = g.player.position.clone();
      g.player.autoDir = { x: -ux, z: -uz, s: 1 };
      let minD = Infinity; for (let i = 0; i < 300; i++) { g.step(1 / 60); const q = g.player.position; minD = Math.min(minD, Math.hypot(q.x - S.x, q.z - S.z) - S.r); }
      g.player.autoDir = null; const p = g.player.position;
      return { minD: +minD.toFixed(2), moved: +Math.hypot(p.x - p0.x, p.z - p0.z).toFixed(2) };
    }, l).catch((e) => ({ error: e.message }));
    ok(`${l.name} is solid (walking into a post/stone stops at it)`, !r.error && r.moved > 2 && r.minD > 0.15, JSON.stringify(r));
  }
  if (shots) for (const [k, l] of L.entries()) {
    if (l.none) continue;
    await page.evaluate(({ k, l }) => { const g = window.game, dx = -l.x, dz = -l.z, n = Math.hypot(dx, dz);
      g.player.teleport(l.x + (dx / n) * 11, l.z + (dz / n) * 11, 0); for (let i = 0; i < 60; i++) g.step(1 / 30);
      g.rig.yaw = Math.atan2(dx, dz); g.rig.pitch = 0.22; g.rig.distance = 13; }, { k, l });
    await step(40); await page.waitForTimeout(800);
    await page.screenshot({ path: `screenshots/order48d-${l.kind}.png` });
    console.log('shot', `screenshots/order48d-${l.kind}.png`);
  }
  ok('no pageerror', errors.length === 0, errors.join(' | '));
} catch (e) { ok('run', false, e.message); }
clearTimeout(kill); await browser.close();
const pass = res.filter(Boolean).length; console.log(`${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1);
