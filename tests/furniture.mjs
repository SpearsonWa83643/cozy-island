// Order 53b: cottage furniture on the iPad viewport. Build a 2x2 cottage, place bed/table/chair/rug/
// floor-lamp/shelves/plant inside (floor + wall snap), rotate, move (pick up + re-place), remove;
// reject outside the cottage and on the door threshold. Screenshot 107 optional.
// Usage: node tests/furniture.mjs [baseUrl] [--no-shots]
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

  const C = await page.evaluate(() => {
    const g = window.game, H = g.heightAt, p0 = g.player.position;
    for (let r = 4; r < 40; r += 1) for (let a = 0; a < 24; a++) {
      const cx = Math.round(p0.x + Math.cos(a / 24 * 6.283) * r) + 0.5, cz = Math.round(p0.z + Math.sin(a / 24 * 6.283) * r) + 0.5;
      const hs = []; for (let i = -2; i <= 2; i++) for (let j = -3; j <= 2; j++) hs.push(H(cx + i, cz + j));
      if (Math.min(...hs) > 0.4 && Math.max(...hs) - Math.min(...hs) < 0.3) {
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

  // BUILDABLES append order: wall=20..roof=23, balloonpad=24, bed=25..plant=31
  const idx = { bed: 25, table: 26, chair: 27, rug: 28, furnlamp: 29, shelves: 30, plant: 31 };

  const built = await page.evaluate((C) => {
    const g = window.game, b = g.build, cx = C.x, cz = C.z;
    g.player.teleport(cx - 0.5, cz - 3.2);
    for (let i = 0; i < 20; i++) g.step(1 / 60);
    const edges = [
      [20, cx - 0.5, cz + 1, 0], [21, cx + 0.5, cz + 1, 0],
      [20, cx + 1, cz + 0.5, Math.PI / 2], [20, cx + 1, cz - 0.5, Math.PI / 2],
      [21, cx - 1, cz + 0.5, Math.PI / 2], [20, cx - 1, cz - 0.5, Math.PI / 2],
      [20, cx + 0.5, cz - 1, 0], [22, cx - 0.5, cz - 1, 0],
    ];
    let n = 0;
    for (const [t, x, z, r] of edges) { if (b.placeAt(x, z, t, r)) n++; }
    const roofOk = b.placeAt(cx, cz, 23, 0);
    b.toggleDoor(b.pieces.find((p) => p.def.id === 'door'), true);
    return { n, roofOk, cot: !!b.cottageAt(cx, cz) };
  }, C);
  ok('2x2 cottage ready', built.n === 8 && built.roofOk && built.cot, JSON.stringify(built));

  // stand clear outside
  await page.evaluate((C) => {
    const g = window.game;
    g.player.teleport(C.x - 0.5, C.z - 3.5);
    for (let i = 0; i < 20; i++) g.step(1 / 60);
  }, C);

  // Floor cells: NE (cx+0.5,cz+0.5), NW (cx-0.5,cz+0.5), SE (cx+0.5,cz-0.5); SW is door threshold
  const placed = await page.evaluate((arg) => {
    const { C, idx } = arg, b = window.game.build, cx = C.x, cz = C.z;
    const out = {
      bed: b.placeAt(cx + 0.5, cz + 0.5, idx.bed, 0),
      table: b.placeAt(cx - 0.5, cz + 0.5, idx.table, Math.PI / 2),
      chair: b.placeAt(cx + 0.5, cz - 0.5, idx.chair, Math.PI),
    };
    // shelves against the north wall (inward from cz+1)
    const cot = b.cottageAt(cx, cz);
    const north = b.pieces.find((q) => q.def.snap === 'edge' && Math.abs(q.obj.position.z - (cz + 1)) < 0.05 && Math.abs(q.obj.position.x - (cx + 0.5)) < 0.05)
      || b.pieces.find((q) => q.def.snap === 'edge' && Math.abs(q.obj.position.z - (cz + 1)) < 0.05);
    const wx = north.obj.position.x, wz = north.obj.position.z;
    const ix = Math.sign(cot.cx - wx) || 0, iz = Math.sign(cot.cz - wz) || 0;
    const sx = wx + ix * 0.22, sz = wz + iz * 0.22;
    out.shelves = b.placeAt(sx, sz, idx.shelves, Math.atan2(ix, iz));
    out.shelvesAt = { x: +sx.toFixed(2), z: +sz.toFixed(2) };
    // free SE for lamp: remove chair, place lamp + plant sequentially on NW after clearing table
    const chair = b.pieces.find((p) => p.def.id === 'chair');
    b.removePiece(chair);
    out.lamp = b.placeAt(cx + 0.5, cz - 0.5, idx.furnlamp, 0);
    const table = b.pieces.find((p) => p.def.id === 'table');
    b.removePiece(table);
    out.plant = b.placeAt(cx - 0.5, cz + 0.5, idx.plant, 0);
    b.removePiece(b.pieces.find((p) => p.def.id === 'plant'));
    out.rug = b.placeAt(cx - 0.5, cz + 0.5, idx.rug, 0);
    // put chair back on a free cell — SE has lamp, so after removing lamp briefly for rotate test later
    const furn = b.pieces.filter((p) => p.def.snap === 'floor' || p.def.snap === 'wall').map((p) => ({
      id: p.def.id, x: +p.obj.position.x.toFixed(2), z: +p.obj.position.z.toFixed(2),
      y: +p.obj.position.y.toFixed(2), snap: p.def.snap,
    }));
    return { out, furn };
  }, { C, idx });
  ok('bed places on floor grid', placed.out.bed);
  ok('table places (rotated)', placed.out.table);
  ok('chair places on floor', placed.out.chair);
  ok('floor lamp places', placed.out.lamp);
  ok('plant places on floor', placed.out.plant);
  ok('rug places on floor', placed.out.rug);
  ok('shelves place against a wall', placed.out.shelves, JSON.stringify(placed.out.shelvesAt));
  ok('furniture list has floor + wall pieces', placed.furn.some((f) => f.snap === 'floor') && placed.furn.some((f) => f.snap === 'wall'), JSON.stringify(placed.furn));

  const outside = await page.evaluate((arg) => {
    const { C, idx } = arg, b = window.game.build;
    return { far: b.placeAt(C.x + 5, C.z + 5, idx.chair, 0), near: b.placeAt(C.x + 2.5, C.z, idx.chair, 0) };
  }, { C, idx });
  ok('rejects furniture outside the cottage', !outside.far && !outside.near, JSON.stringify(outside));

  const doorBlock = await page.evaluate((arg) => {
    const { C, idx } = arg;
    return window.game.build.placeAt(C.x - 0.5, C.z - 0.5, idx.chair, 0);
  }, { C, idx });
  ok('rejects furniture on the door threshold', !doorBlock);

  // rotate + move + remove
  const rot = await page.evaluate((arg) => {
    const { C, idx } = arg, b = window.game.build;
    // clear SE (lamp) and place rotated chair
    const lamp = b.pieces.find((p) => p.def.id === 'furnlamp');
    if (lamp) b.removePiece(lamp);
    const ok1 = b.placeAt(C.x + 0.5, C.z - 0.5, idx.chair, Math.PI / 2);
    const chair = b.pieces.find((p) => p.def.id === 'chair');
    const r0 = chair?.obj.rotation.y ?? null;
    // move: clear NW (rug), pick up chair, re-place at NW with new rot
    const rug = b.pieces.find((p) => p.def.id === 'rug');
    if (rug) b.removePiece(rug);
    b.removePiece(chair);
    const ok2 = b.placeAt(C.x - 0.5, C.z + 0.5, idx.chair, Math.PI);
    const moved = b.pieces.find((p) => p.def.id === 'chair');
    const movedZ = moved?.obj.position.z ?? null;
    const movedR = moved?.obj.rotation.y ?? null;
    b.removePiece(moved);
    const gone = !b.pieces.some((p) => p.def.id === 'chair');
    return { ok1, r0, ok2, movedZ, movedR, gone };
  }, { C, idx });
  ok('chair places with rotation', rot.ok1 && Math.abs(rot.r0 - Math.PI / 2) < 0.01, JSON.stringify(rot));
  ok('move: pick up + re-place at new cell', rot.ok2 && Math.abs(rot.movedZ - (C.z + 0.5)) < 0.05 && Math.abs(rot.movedR - Math.PI) < 0.01, JSON.stringify(rot));
  ok('remove clears the piece', rot.gone);

  // Furnish tab
  const tab = await page.evaluate(() => {
    const g = window.game;
    g.build.toggle(true);
    g.build.select(25);
    for (let i = 0; i < 4; i++) g.step(1 / 60);
    const furnBtn = document.querySelector('.btab[data-tab="furn"]');
    const slots = Array.from(document.querySelectorAll('.hotbar .slot'))
      .filter((s) => getComputedStyle(s).display !== 'none')
      .map((s) => s.textContent.replace(/\d+/g, '').trim());
    g.build.toggle(false);
    return { hasFurnBtn: !!furnBtn, on: !!furnBtn?.classList.contains('on'), slots };
  });
  ok('Furnish tab shows furniture slots', tab.hasFurnBtn && tab.on && tab.slots.length >= 7, JSON.stringify(tab));

  // re-place a couple pieces for the interior shot
  await page.evaluate((arg) => {
    const { C, idx } = arg, g = window.game, b = g.build;
    b.placeAt(C.x + 0.5, C.z + 0.5, idx.bed, 0);
    b.placeAt(C.x - 0.5, C.z + 0.5, idx.table, 0);
    b.placeAt(C.x + 0.5, C.z - 0.5, idx.chair, Math.PI / 2);
    g.player.teleport(C.x, C.z);
    for (let i = 0; i < 40; i++) g.step(1 / 60);
  }, { C, idx });
  const inside = await page.evaluate(() => window.game.play.interior);
  ok('inside furnished cottage (roof hidden)', inside.inside && inside.roofHidden, JSON.stringify(inside));

  if (shots) {
    await page.screenshot({ path: 'test-results/107-ipad-cottage-furniture.png', timeout: 90000 }).catch((e) => console.log('shot failed', e.message));
  }

  ok('no console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  console.error(e);
  results.push(false);
} finally {
  await browser.close(); clearTimeout(kill);
  const pass = results.filter(Boolean).length, total = results.length;
  console.log(`\n${pass}/${total} passed`);
  process.exit(pass === total && total > 0 ? 0 : 1);
}
