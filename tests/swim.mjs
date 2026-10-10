// Swimming + reef test: swim out to the soft limit and back, no stuck states at the shoreline,
// collect a sea item, sea bottles, screenshots (screenshots/24-*.png), iPad Low joystick swim + frame cost.
// Usage: node tests/swim.mjs [baseUrl] [--skip-ipad]
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const outDir = new URL('../screenshots/', import.meta.url).pathname;
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = []; const ok = (name, cond, extra = '') => { results.push([cond ? 'PASS' : 'FAIL', name, extra]); console.log(cond ? 'PASS' : 'FAIL', name, extra); };
const errFilter = (m) => (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|swiftshader|Automatic fallback/i.test(m.text())));
async function open(ctxOpts, q) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  page.setDefaultTimeout(300000);
  const errors = [];
  page.on('console', (m) => { if (errFilter(m)) errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => { errors.push(`[pageerror] ${e.message}`); console.log('STACK', e.stack); });
  await page.goto(base + `?webgl&q=${q}`);
  await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => localStorage.clear());
  await page.reload(); await page.waitForFunction(() => window.game?.ready);
  return { ctx, page, errors };
}
const frames = (page, n) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const shot = async (page, name) => { await frames(page, 3); await page.screenshot({ path: outDir + name + '.png' }); console.log('saved', name); };
const frame = (page, yaw, pitch, dist) => page.evaluate(([yaw, pitch, dist]) => { const g = window.game; g.rig.yaw = yaw; g.rig.pitch = pitch; g.rig.distance = dist; g.rig.target.copy(g.player.position).add({ x: 0, y: 1.1, z: 0 }); g.rig.apply(); }, [yaw, pitch, dist]);

// in-page helpers: swim along an angle (outward: dir=1, back: dir=-1) using keys or the joystick
const SWIM_FN = `window.__swim = (ang, dir, sec, stick) => {
  const g = window.game, k = g.input.keys;
  const ox = Math.cos(ang) * dir, oz = Math.sin(ang) * dir;
  const yaw = Math.atan2(-ox, -oz);
  let maxOff = -99, swam = false, path = 0, last = g.player.position.clone();
  for (let t = 0; t < sec; t += 1 / 30) {
    g.rig.yaw = yaw;
    if (stick) { g.input.stick.x = 0; g.input.stick.y = -1; } else k.add('w');
    g.step(1 / 30);
    const p = g.player.position;
    path += Math.hypot(p.x - last.x, p.z - last.z); last.copy(p);
    maxOff = Math.max(maxOff, g.coast.offshore(p.x, p.z)); swam ||= g.player.swimming;
  }
  k.delete('w'); g.input.stick.x = 0; g.input.stick.y = 0;
  for (let i = 0; i < 10; i++) g.step(1 / 30);
  const p = g.player.position;
  return { maxOff: +maxOff.toFixed(2), swam, swimming: g.player.swimming, off: +g.coast.offshore(p.x, p.z).toFixed(2), depth: +g.player.depth.toFixed(2), y: +p.y.toFixed(2), path: +path.toFixed(1), unstuck: g.player.unstuckCount, current: +g.player.current.toFixed(2) };
};`;

// pick a beach angle: wide sandy slope (tropical side), found in-page
const BEACH_FN = `window.__beach = () => {
  const g = window.game; let best = 0, bs = -1;
  for (let i = 0; i < 72; i++) { const a = i / 72 * Math.PI * 2; const p = g.coast.atOffshore(a, -3); const h = g.heightAt(p.x, p.z); const q = g.coast.atOffshore(a, 6); const d = -g.heightAt(q.x, q.z);
    const s = (h > 0.05 && h < 0.8 ? 1 : 0) + (d > 1.2 && d < 2.6 ? 1 : 0) - Math.abs(h - 0.35); if (s > bs) { bs = s; best = a; } }
  return best;
};`;

if (!process.argv.includes('--skip-desktop')) {
  const { ctx, page, errors } = await open({ viewport: { width: 1280, height: 720 } }, 'high');
  await page.evaluate(SWIM_FN + BEACH_FN);
  const ang = await page.evaluate(() => window.__beach());
  await page.evaluate((a) => { const g = window.game, p = g.coast.atOffshore(a, -3); g.player.teleport(p.x, p.z); for (let i = 0; i < 20; i++) g.step(1 / 30); }, ang);
  // 1. swim out
  const out = await page.evaluate((a) => window.__swim(a, 1, 26), ang);
  ok('swims out from the beach', out.swam && out.swimming, JSON.stringify(out));
  ok('soft limit: current holds you near 12-19 m past shore (no wall, no escape)', out.maxOff > 11 && out.maxOff < 23 && out.current > 0.3, `maxOff=${out.maxOff} current=${out.current}`);
  ok('floats at the surface (head above water)', out.y > -1.0 && out.y < -0.5, `feet y=${out.y}`);
  await frame(page, Math.atan2(-Math.cos(ang), -Math.sin(ang)) + Math.PI + 0.5, 0.32, 7.5);
  await page.evaluate(() => { const g = window.game; g.input.keys.add('w'); for (let i = 0; i < 4; i++) g.step(1 / 30); g.input.keys.delete('w'); });
  const meter = await page.evaluate(() => document.querySelector('.swim-meter')?.classList.contains('show'));
  ok('current / stamina ring shows far out', meter);
  await shot(page, '24-swim-limit');
  // 2. swim back and climb out
  const back = await page.evaluate((a) => window.__swim(a, -1, 22), ang);
  ok('swims back and climbs out onto the beach', !back.swimming && back.depth < 0.5 && back.off < 0.5, JSON.stringify(back));
  // 3. shoreline stuck regression: wade in shallows in 4 directions
  const moves = await page.evaluate((a) => {
    const g = window.game, res = [];
    for (const off of [0.5, 1.5, 3]) for (let d = 0; d < 4; d++) {
      const p = g.coast.atOffshore(a, off); g.player.teleport(p.x, p.z);
      for (let i = 0; i < 6; i++) g.step(1 / 30);
      const s = g.player.position.clone(), yaw = d * Math.PI / 2;
      for (let t = 0; t < 1.6; t += 1 / 30) { g.rig.yaw = yaw; g.input.keys.add('w'); g.step(1 / 30); }
      g.input.keys.delete('w');
      const e = g.player.position; res.push(+Math.hypot(e.x - s.x, e.z - s.z).toFixed(2));
    }
    return res;
  }, ang);
  ok('never stuck in the shallows (moves ≥1.5 m every direction)', moves.every((m) => m > 1.5), JSON.stringify(moves));
  // also from a "trapped" spot: deep-ish water start where the old code froze the player
  const trapped = await page.evaluate((a) => {
    const g = window.game; const p = g.coast.atOffshore(a, 1.0);
    g.player.teleport(p.x, p.z); for (let i = 0; i < 4; i++) g.step(1 / 30);
    return window.__swim(a, -1, 4);
  }, ang);
  ok('walks out of the water from waist depth', trapped.path > 4 && !trapped.swimming, JSON.stringify(trapped));
  // 4. collect a sea item
  const sea = await page.evaluate(() => {
    const g = window.game, f = g.play.forage;
    const it = f.items.filter((i) => i.active && i.y < -0.8 && (i.id === 'conch' || i.id === 'starfish' || i.id === 'seaglass' || i.id === 'pearl'))[0];
    if (!it) return null;
    g.player.teleport(it.x + 0.7, it.z); for (let i = 0; i < 12; i++) g.step(1 / 30);
    const t = g.play.target; const before = g.play.save.data.food[it.id] ?? 0;
    const r = { id: it.id, key: t?.key, label: t?.label, swimming: g.player.swimming, before };
    g.play.act(); for (let i = 0; i < 6; i++) g.step(1 / 30);
    r.after = g.play.save.data.food[it.id] ?? 0; window.__seaIt = it; return r;
  });
  ok('sea item targeted while swimming (Collect …)', sea && sea.key === `pick:${sea.id}` && /^Collect /.test(sea.label), JSON.stringify(sea));
  ok('collected sea item lands in the bag', sea && sea.after === sea.before + 1, JSON.stringify(sea));
  await frame(page, 0.4, 0.75, 6.5);
  await shot(page, '25-reef-collect');
  // 5. floating bottles: first gives the treasure map (fresh save), next a seaside wearable
  const bot = await page.evaluate(() => {
    const g = window.game, p = g.player.position, r = [];
    for (let k = 0; k < 2; k++) {
      const b = g.reef.bottles[0]; b.active = true; b.x = p.x + 0.8; b.z = p.z; g.step(1 / 30); g.step(1 / 30);
      const t = g.play.target, owned = Object.keys(g.play.save.data.owned).length, st = g.play.save.data.map.state;
      g.play.act(); for (let i = 0; i < 8; i++) g.step(1 / 30);
      r.push({ key: t?.key, label: t?.label, stateBefore: st, state: g.play.save.data.map.state, owned: Object.keys(g.play.save.data.owned).length - owned });
    }
    return r;
  });
  ok('sea bottle → treasure map on a fresh save', bot[0].key === 'take:seabottle' && bot[0].state === 'active', JSON.stringify(bot[0]));
  ok('sea bottle → new seaside wearable', bot[1].key === 'take:seabottle' && bot[1].owned === 1, JSON.stringify(bot[1]));
  // 6. trade sea treasures in the bag
  const trade = await page.evaluate(() => { const g = window.game, d = g.play.save.data; d.food.pearl = 2; const s0 = d.shells; g.play.panels.toggle('bag'); const b = document.querySelector('.trade[data-id="pearl"]'); b?.click(); const r = { had: !!b, gained: d.shells - s0, left: d.food.pearl }; g.play.panels.toggle(null); return r; });
  ok('bag trades sea treasures for shells', trade.had && trade.gained === 12 && trade.left === 0, JSON.stringify(trade));
  // 7. reef views
  const rv = await page.evaluate((a) => { const g = window.game, p = g.coast.atOffshore(a, 6); g.player.teleport(p.x, p.z); for (let i = 0; i < 60; i++) g.step(1 / 30); return { sectorsVisible: g.reef.group.children.filter((c) => c.name === 'reef-sector' && c.visible).length, ...g.reef.stats }; }, ang);
  ok('reef sectors drawn near the player', rv.sectorsVisible > 0 && rv.coral > 50, JSON.stringify(rv));
  await frame(page, Math.atan2(Math.cos(ang), Math.sin(ang)) + 0.6, 0.62, 9);
  await shot(page, '26-reef');
  const dyaw = await page.evaluate(() => { const g = window.game, d = g.reef.dolphins[0], p = g.player.position; d.th = Math.atan2(p.z, p.x) + 0.05; d.off = 20; d.jumpT = 0.4; for (let i = 0; i < 2; i++) g.step(1 / 30); return Math.atan2(p.x - d.x, p.z - d.z); });
  await frame(page, dyaw, 0.12, 6);
  await shot(page, '27-dolphins');
  ok('desktop: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

if (!process.argv.includes('--skip-ipad')) {
  const { ctx, page, errors } = await open({ ...devices['iPad Pro 11'], hasTouch: true }, 'low');
  await page.evaluate(SWIM_FN + BEACH_FN);
  const ang = await page.evaluate(() => window.__beach());
  await page.evaluate((a) => { const g = window.game, p = g.coast.atOffshore(a, -3); g.player.teleport(p.x, p.z); for (let i = 0; i < 20; i++) g.step(1 / 30); }, ang);
  const out = await page.evaluate((a) => window.__swim(a, 1, 12, true), ang);
  ok('iPad: joystick swims out', out.swam && out.swimming, JSON.stringify(out));
  await frame(page, Math.atan2(-Math.cos(ang), -Math.sin(ang)) + Math.PI + 0.4, 0.4, 8);
  await shot(page, '28-ipad-swim');
  const perf = await page.evaluate(async () => {
    const g = window.game, r = g.renderer.renderer, ts = [];
    for (let i = 0; i < 12; i++) { const t0 = performance.now(); g.step(1 / 30); r.render(g.scene, g.camera); ts.push(performance.now() - t0); }
    ts.sort((a, b) => a - b);
    const info = r.info.render;
    return { medianMs: +ts[6].toFixed(1), drawCalls: info.drawCalls ?? info.calls, triangles: info.triangles };
  });
  console.log('iPad Low at reef:', JSON.stringify(perf));
  const back = await page.evaluate((a) => window.__swim(a, -1, 18, true), ang);
  ok('iPad: joystick swims back to the beach', !back.swimming && back.off < 0.5, JSON.stringify(back));
  ok('iPad: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}
await browser.close();
const fails = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
