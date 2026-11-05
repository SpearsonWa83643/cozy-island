// Order 53a: cottage interiors on the iPad viewport. Build a 2x2 cottage (House kit), open the door,
// walk inside → camera pulls in and the roof hides; walk back out → roof returns and camera frees.
// Persist nothing new. Screenshot 106 optional.
// Usage: node tests/interior.mjs [baseUrl] [--no-shots]
import { chromium, devices } from 'playwright';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
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
  await page.waitForFunction(() => window.game.build, null, { timeout: 60000 });
  const step = (n) => page.evaluate((n) => { for (let i = 0; i < n; i++) window.game.step(1 / 60); }, n);
  const interior = () => page.evaluate(() => window.game.play.interior);

  // flat meadow spot near spawn (same idea as cottage.mjs)
  const C = await page.evaluate(() => {
    const g = window.game, H = g.heightAt, p0 = g.player.position;
    for (let r = 4; r < 40; r += 1) for (let a = 0; a < 24; a++) {
      const cx = Math.round(p0.x + Math.cos(a / 24 * 6.283) * r) + 0.5, cz = Math.round(p0.z + Math.sin(a / 24 * 6.283) * r) + 0.5;
      const hs = []; for (let i = -2; i <= 2; i++) for (let j = -3; j <= 2; j++) hs.push(H(cx + i, cz + j));
      if (Math.min(...hs) > 0.4 && Math.max(...hs) - Math.min(...hs) < 0.3) {
        // stand clear in front of the door and inside
        g.player.teleport(cx - 0.5, cz - 2.6);
        for (let i = 0; i < 12; i++) g.step(1 / 60);
        const p = g.player.position;
        if (Math.hypot(p.x - (cx - 0.5), p.z - (cz - 2.6)) < 0.35) return { x: cx, z: cz, h: H(cx, cz) };
      }
    }
    return null;
  });
  ok('found a flat building spot', !!C, JSON.stringify(C));
  if (!C) throw new Error('no building spot');

  // stand outside so placeAt isn't blocked by the player body, then drop a 2x2 cottage
  const built = await page.evaluate((C) => {
    const g = window.game, b = g.build, cx = C.x, cz = C.z;
    g.player.teleport(cx - 0.5, cz - 3.2);
    for (let i = 0; i < 20; i++) g.step(1 / 60);
    // BUILDABLES: wall=20 window=21 door=22 roof=23
    const edges = [
      [20, cx - 0.5, cz + 1, 0], [21, cx + 0.5, cz + 1, 0],
      [20, cx + 1, cz + 0.5, Math.PI / 2], [20, cx + 1, cz - 0.5, Math.PI / 2],
      [21, cx - 1, cz + 0.5, Math.PI / 2], [20, cx - 1, cz - 0.5, Math.PI / 2],
      [20, cx + 0.5, cz - 1, 0], [22, cx - 0.5, cz - 1, 0],
    ];
    let n = 0;
    for (const [t, x, z, r] of edges) { if (b.placeAt(x, z, t, r)) n++; }
    const roofOk = b.placeAt(cx, cz, 23, 0);
    const door = b.pieces.find((p) => p.def.id === 'door');
    b.toggleDoor(door, true);
    const cot = b.cottageAt(cx, cz);
    return {
      n, roofOk, count: b.count,
      ids: b.pieces.map((p) => p.def.id).sort().join(','),
      doorOpen: !!door?.obj.userData.open,
      cot: cot ? { cx: cot.cx, cz: cot.cz, roofY: cot.roofY } : null,
    };
  }, C);
  ok('2x2 cottage placed (8 walls/windows/door + roof)', built.n === 8 && built.roofOk && built.count === 9, JSON.stringify(built));
  ok('door opens for the walk-in', built.doorOpen);
  ok('cottageAt finds the roof under the footprint', !!built.cot && Math.abs(built.cot.cx - C.x) < 0.01 && Math.abs(built.cot.cz - C.z) < 0.01, JSON.stringify(built.cot));

  // outside: not in interior
  await step(30);
  const out0 = await interior();
  ok('standing outside: not in interior', !out0.inside && !out0.roofHidden && !out0.camCottage, JSON.stringify(out0));
  const distOut = out0.camDist;

  // walk in through the open door (tap-to-walk / go)
  const walked = await page.evaluate(async (C) => {
    const g = window.game;
    g.play.walk.cancel(false);
    g.player.teleport(C.x - 0.5, C.z - 2.4);
    for (let i = 0; i < 20; i++) g.step(1 / 60);
    g.play.walk.go({ pos: () => ({ x: C.x - 0.5, z: C.z - 0.15 }), reach: 0.2, key: '' }, false);
    for (let i = 0; i < 360 && g.play.walk.goal; i++) g.step(1 / 60);
    // keep stepping so interior update runs
    for (let i = 0; i < 90; i++) g.step(1 / 60);
    const p = g.player.position;
    return { x: +p.x.toFixed(2), z: +p.z.toFixed(2), arrived: !g.play.walk.goal, interior: g.play.interior };
  }, C);
  ok('player walks in through the open door', Math.abs(walked.x - (C.x - 0.5)) < 0.9 && Math.abs(walked.z - C.z) < 0.95, JSON.stringify(walked));
  ok('inside: interior.inside true', walked.interior.inside, JSON.stringify(walked.interior));
  ok('inside: roof is hidden', walked.interior.roofHidden, JSON.stringify(walked.interior));
  ok('inside: camera cottage mode on', walked.interior.camCottage, JSON.stringify(walked.interior));
  // ease a bit more so distance settles
  await step(90);
  const inside = await interior();
  ok('inside: camera pulled closer than outdoors', inside.camDist < distOut - 1.5 && inside.camDist <= 5.2, `out=${distOut} in=${inside.camDist}`);

  if (shots) {
    await page.evaluate((C) => {
      const g = window.game;
      g.rig.yaw = Math.PI + 0.4; g.rig.pitch = 0.55;
      g.rig.target.set(C.x, C.h + 1.0, C.z); g.rig.apply();
    }, C);
    await step(20);
    await page.screenshot({ path: 'screenshots/106-ipad-cottage-interior.png', timeout: 90000 }).catch((e) => console.log('shot failed', e.message));
  }

  // walk back out
  const exited = await page.evaluate(async (C) => {
    const g = window.game;
    g.play.walk.cancel(false);
    g.play.walk.go({ pos: () => ({ x: C.x - 0.5, z: C.z - 2.5 }), reach: 0.25, key: '' }, false);
    for (let i = 0; i < 360 && g.play.walk.goal; i++) g.step(1 / 60);
    for (let i = 0; i < 60; i++) g.step(1 / 60);
    const p = g.player.position;
    return { x: +p.x.toFixed(2), z: +p.z.toFixed(2), interior: g.play.interior, roofVis: g.build.pieces.find((p) => p.def.id === 'roof')?.obj.visible };
  }, C);
  ok('player walks back outside', Math.abs(exited.z - (C.z - 2.5)) < 0.8 || exited.z < C.z - 1.2, JSON.stringify(exited));
  ok('outside again: interior cleared', !exited.interior.inside && !exited.interior.camCottage, JSON.stringify(exited.interior));
  ok('outside again: roof visible', exited.roofVis === true && !exited.interior.roofHidden, JSON.stringify(exited));

  // teleport straight inside (no door walk) still enters — detect by footprint
  const tele = await page.evaluate((C) => {
    const g = window.game;
    g.player.teleport(C.x, C.z);
    for (let i = 0; i < 45; i++) g.step(1 / 60);
    return g.play.interior;
  }, C);
  ok('teleport into footprint also enters (doorway/footprint detect)', tele.inside && tele.roofHidden && tele.camCottage, JSON.stringify(tele));

  // nothing new persisted for interior (builds still save the cottage pieces only)
  const saveShape = await page.evaluate(() => {
    const d = window.game.play.save.data;
    return { hasInterior: 'interior' in d || 'inCottage' in d || 'cottage' in d, builds: d.builds?.length };
  });
  ok('save has no new interior flag (53a persists nothing new)', !saveShape.hasInterior && saveShape.builds === 9, JSON.stringify(saveShape));

  ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
} catch (e) { console.error(e); results.push(false); } finally { clearTimeout(kill); await browser.close().catch(() => {}); }
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
