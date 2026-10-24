// Order 44: cottage kit on the iPad viewport. Open the House tab, build a 2x2 cottage by touch
// (edge-snapped walls + window + door, corner-snapped roof), the closed door blocks the way,
// tap the door to open it, walk inside, and the cottage survives a reload.
// Usage: node tests/cottage.mjs [baseUrl] [--no-shots]
import { chromium, devices } from 'playwright';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4186/cozy-island/';
const shots = !process.argv.includes('--no-shots');
const kill = setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 900000);
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
  const center = (sel) => page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
  const tapSel = async (sel) => { const c = await center(sel); await page.touchscreen.tap(c.x, c.y); await frames(3); };
  const toScreen = (x, z, y) => page.evaluate(([x, z, y]) => { const g = window.game; const v = g.camera.position.clone().set(x, y ?? g.heightAt(x, z), z); v.project(g.camera); return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight }; }, [x, z, y]);
  const tapWorld = async (x, z, y) => { const p = await toScreen(x, z, y); await page.touchscreen.tap(p.x, p.y); await frames(3); };
  const pieces = () => page.evaluate(() => window.game.build.pieces.map((p) => ({ id: p.def.id, x: +p.obj.position.x.toFixed(2), y: +p.obj.position.y.toFixed(2), z: +p.obj.position.z.toFixed(2), r: +p.obj.rotation.y.toFixed(2), open: !!p.obj.userData.open })));

  // a flat meadow spot near spawn: 4x4 m within 0.3 m height, on land
  const cands = await page.evaluate(() => {
    const g = window.game, H = g.heightAt, p0 = g.player.position, out = [];
    for (let r = 3; r < 40 && out.length < 12; r += 1) for (let a = 0; a < 24 && out.length < 12; a++) {
      const cx = Math.round(p0.x + Math.cos(a / 24 * 6.283) * r) + 0.5, cz = Math.round(p0.z + Math.sin(a / 24 * 6.283) * r) + 0.5;
      if (out.some((o) => Math.hypot(o.x - cx, o.z - cz) < 4)) continue;
      const hs = []; for (let i = -2; i <= 2; i++) for (let j = -3; j <= 2; j++) hs.push(H(cx + i, cz + j));
      if (Math.min(...hs) > 0.4 && Math.max(...hs) - Math.min(...hs) < 0.3) out.push({ x: cx, z: cz, h: H(cx, cz) });
    }
    return out;
  });
  // the spot must be clear of props: the player stands there without being pushed off, also 2.6 m in front (door approach)
  let C = null;
  for (const c of cands) {
    const stay = await page.evaluate(async (c) => {
      const g = window.game; const at = async (x, z) => { g.player.teleport(x, z); for (let i = 0; i < 15; i++) await new Promise((r) => requestAnimationFrame(r)); const p = g.player.position; return Math.hypot(p.x - x, p.z - z) < 0.3; };
      return (await at(c.x, c.z)) && (await at(c.x - 0.5, c.z - 2.4)) && (await at(c.x + 0.5, c.z + 0.5));
    }, c);
    if (stay) { C = c; break; }
  }
  ok('found a flat building spot', !!C, JSON.stringify(C));
  const setCam = () => page.evaluate((C) => { const g = window.game; g.player.teleport(C.x, C.z); g.rig.yaw = 0; g.rig.pitch = 1.25; g.rig.distance = 12; g.rig.target.set(C.x, C.h + 0.5, C.z); g.rig.apply(); }, C);
  await setCam(); await frames(20); await setCam(); await frames(3);

  await tapSel('.tbtn.build');
  const tabVis = await page.evaluate(() => { const t = document.querySelector('.build-tabs'); return !!t && !t.classList.contains('off') && getComputedStyle(t).opacity !== '0'; });
  ok('Items / House tabs show in Build Mode', tabVis);
  await tapSel('.btab[data-tab=house]');
  const tabState = await page.evaluate(() => ({ sel: window.game.build.selected, id: window.game.build.pieces && null, slots: [...document.querySelectorAll('.hotbar .slot')].filter((s) => s.style.display !== 'none').map((s) => s.querySelector('span').textContent) }));
  ok('House tab lists only the cottage kit', tabState.slots.join() === 'Wall,Window,Door,Roof', JSON.stringify(tabState));
  ok('House tab selects the Wall', tabState.sel === 20, JSON.stringify(tabState));
  const tapSlot = async (label) => { const c = await page.evaluate((l) => { const s = [...document.querySelectorAll('.hotbar .slot')].find((e) => e.querySelector('span').textContent === l); const r = s.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, label); await page.touchscreen.tap(c.x, c.y); await frames(3); };

  // 8 edges of the 2x2 footprint; tap 0.35 m inside the cell, next to the edge we want. Door on the -z side (facing the player).
  const { x: cx, z: cz } = C;
  const edges = [
    ['Wall', cx - 0.5, cz + 0.65], ['Window', cx + 0.5, cz + 0.65], // far side (+z)
    ['Wall', cx + 0.65, cz + 0.5], ['Wall', cx + 0.65, cz - 0.5], // +x side
    ['Window', cx - 0.65, cz + 0.5], ['Wall', cx - 0.65, cz - 0.5], // -x side
    ['Wall', cx + 0.5, cz - 0.65], ['Door', cx - 0.5, cz - 0.65], // near side (-z)
  ];
  let cur = '';
  for (const [l, x, z] of edges) {
    if (l !== cur) { await tapSlot(l); cur = l; }
    const n0 = (await pieces()).length; const sp = await toScreen(x, z);
    await tapWorld(x, z);
    if ((await pieces()).length === n0) console.log('  miss', l, x, z, JSON.stringify(sp), await page.evaluate(([a, b]) => { const e = document.elementFromPoint(a, b); const t = window.game.build.target; return (e ? e.tagName + '.' + e.className : 'none') + ' target ' + [t.x, t.y, t.z].map((v) => v.toFixed(2)) + ' valid ' + window.game.build.ghostValid; }, [sp.x, sp.y]));
  }
  let ps = await pieces();
  const want = [[cx - 0.5, cz + 1], [cx + 0.5, cz + 1], [cx + 1, cz + 0.5], [cx + 1, cz - 0.5], [cx - 1, cz + 0.5], [cx - 1, cz - 0.5], [cx + 0.5, cz - 1], [cx - 0.5, cz - 1]];
  const snapped = want.every(([x, z]) => ps.some((p) => Math.abs(p.x - x) < 0.01 && Math.abs(p.z - z) < 0.01));
  ok('8 wall pieces placed by tap, each snapped to a cell edge', ps.length === 8 && snapped, JSON.stringify(ps));
  ok('walls face along their edge', ps.every((p) => (Math.abs(p.x - Math.round(p.x)) > 0.4 ? Math.abs(Math.sin(p.r)) > 0.99 : Math.abs(Math.sin(p.r)) < 0.01)), JSON.stringify(ps.map((p) => p.r)));
  ok('kit mix: 5 walls, 2 windows, 1 door', ['wall', 'window', 'door'].map((id) => ps.filter((p) => p.id === id).length).join() === '5,2,1');
  // tapping an edge that's taken does not stack a second piece
  await tapSlot('Wall'); await tapWorld(cx + 0.65, cz + 0.5);
  ok('occupied edge rejects a duplicate', (await pieces()).length === 8);
  await tapSlot('Roof'); await tapWorld(cx + 0.2, cz + 0.2, C.h + 2);
  ps = await pieces();
  const roof = ps.find((p) => p.id === 'roof');
  const wallTop = Math.max(...ps.filter((p) => p.id !== 'roof').map((p) => p.y));
  ok('roof snaps to the cottage centre on top of the walls', !!roof && Math.abs(roof.x - cx) < 0.01 && Math.abs(roof.z - cz) < 0.01 && Math.abs(roof.y - wallTop) < 0.01, JSON.stringify({ roof, wallTop, C }));
  if (shots) {
    await page.evaluate((C) => { const g = window.game; g.player.teleport(C.x - 1.2, C.z - 3.4); g.rig.yaw = Math.PI + 0.5; g.rig.pitch = 0.35; g.rig.distance = 7.5; g.rig.target.set(C.x, C.h + 1.2, C.z); g.rig.apply(); }, C);
    await frames(10);
    await page.screenshot({ path: 'screenshots/order44-cottage.png', timeout: 90000 }).catch((e) => console.log('shot failed', e.message));
  }
  await tapSel('.tbtn.build'); // leave Build Mode
  const tabsOff = await page.evaluate(() => document.querySelector('.build-tabs').classList.contains('off'));
  ok('tabs hide when leaving Build Mode', tabsOff);

  const walk = async (fx, fz, tx, tz, n = 260) => page.evaluate(async ([fx, fz, tx, tz, n]) => {
    const g = window.game; g.play.walk.cancel(false); g.player.teleport(fx, fz);
    for (let i = 0; i < 30; i++) await new Promise((r) => requestAnimationFrame(r));
    g.play.walk.go({ pos: () => ({ x: tx, z: tz }), reach: 0.25, key: '' }, false);
    for (let i = 0; i < n && g.play.walk.goal; i++) await new Promise((r) => requestAnimationFrame(r));
    const p = g.player.position; return { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), arrived: !g.play.walk.goal };
  }, [fx, fz, tx, tz, n]);
  const door = ps.find((p) => p.id === 'door');
  const inside = (p) => Math.abs(p.x - cx) < 0.9 && Math.abs(p.z - cz) < 0.9;
  const blocked = await walk(door.x, cz - 2.3, door.x, cz - 0.3, 180);
  ok('closed door blocks the way in', !inside(blocked), JSON.stringify(blocked));
  // tap the door from outside to open it
  await page.evaluate((C) => { const g = window.game; g.play.walk.cancel(false); g.player.teleport(C.x - 0.5, C.z - 2.6); g.rig.yaw = Math.PI; g.rig.pitch = 0.3; g.rig.distance = 6; g.rig.target.set(C.x - 0.5, C.h + 1, C.z - 1.5); g.rig.apply(); }, C);
  await frames(30);
  await tapWorld(door.x, door.z - 0.08, door.y + 0.9);
  await frames(30);
  const opened = (await pieces()).find((p) => p.id === 'door');
  const hingeY = await page.evaluate(() => { const d = window.game.build.pieces.find((p) => p.def.id === 'door'); return d.obj.getObjectByName('hinge').rotation.y; });
  ok('tapping the door swings it open', opened.open && hingeY < -1.2, JSON.stringify({ open: opened.open, hingeY }));
  const inWalk = await walk(door.x, cz - 2.3, door.x, cz - 0.1, 300);
  ok('player walks in through the open door', inside(inWalk) && inWalk.arrived, JSON.stringify(inWalk));
  if (shots) {
    await page.evaluate((C) => { const g = window.game; g.rig.yaw = Math.PI + 0.35; g.rig.pitch = 0.3; g.rig.distance = 6; g.rig.target.set(C.x - 0.5, C.h + 1, C.z - 1); g.rig.apply(); }, C);
    await frames(10);
    await page.screenshot({ path: 'test-results/order44-door-open.png', timeout: 90000 }).catch((e) => console.log('shot failed', e.message));
  }

  const saved = await pieces();
  await page.evaluate(() => window.game.play.save.flush());
  await page.reload(); await boot();
  await page.waitForFunction(() => window.game.build && window.game.build.count > 0, null, { timeout: 60000 });
  const after = await pieces();
  const key = (a) => a.map((p) => `${p.id}@${p.x},${p.y},${p.z},${p.r}`).sort().join('|');
  ok('cottage (walls, window, door, roof) survives reload intact', key(after) === key(saved), JSON.stringify({ saved: saved.length, after: after.length }));
  ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
} catch (e) { console.error(e); results.push(false); } finally { clearTimeout(kill); await browser.close().catch(() => {}); }
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
