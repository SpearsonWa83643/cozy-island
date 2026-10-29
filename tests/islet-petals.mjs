// Pink petals only on Blossom Isle (Walker, 2026-10-29), iPad touch viewport, spring (season petals) + summer (fireflies, untouched).
// At Blossom Isle: falling cherry petals animate, the season's drifting petals show, and the meadow has petal-pink drifts.
// At every generated islet: no cherry petals, the season's drifting petals hide, and the ground has no petal-pink tint.
// Back on the main island the season's drifting petals show again (pre-existing behaviour). No console errors.
// Usage: node tests/islet-petals.mjs [baseUrl]
import { chromium, devices } from 'playwright';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4271/';
const kill = setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 420000);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = []; const ok = (n, c, x = '') => { results.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
const errFilter = (m) => (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|swiftshader|Automatic fallback/i.test(m.text())));
try {
  for (const th of ['spring', 'summer']) {
    const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], hasTouch: true });
    const page = await ctx.newPage(); page.setDefaultTimeout(120000);
    const errors = []; page.on('console', (m) => { if (errFilter(m)) errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + `?webgl&q=low&touch=1&whatsnew=0&theme=${th}`);
    await page.waitForFunction(() => window.game?.ready);
    await page.evaluate(() => document.getElementById('whatsnew')?.querySelector('.w-ok')?.click());
    const step = (n) => page.evaluate((n) => { for (let i = 0; i < n; i++) window.game.step(1 / 60); }, n);
    const defs = await page.evaluate(() => window.game.islets.list.map((it) => it.def));
    await step(30);
    const home = await page.evaluate(() => ({ hidden: window.game.dress.petalsHidden, kind: window.game.dress.fxKind }));
    const dressPetals = home.kind === 0; // spring drifts petals; summer has fireflies (not petals, left alone)
    ok(`[${th}] main island: season particles as before (${dressPetals ? 'petals' : 'not petals'})`, !home.hidden && (th !== 'spring' || dressPetals), JSON.stringify(home));
    for (let k = 0; k < defs.length; k++) {
      const d = defs[k];
      await page.evaluate((d) => window.game.player.teleport(d.x - Math.sign(d.x) * d.r * 0.4, d.z - Math.sign(d.z) * d.r * 0.4, 0), d);
      await step(200);
      for (let i = 0; i < 80 && (await page.evaluate((k) => window.game.islets.stats[k].state, k)) !== 'ready'; i++) { await page.waitForTimeout(250); await step(2); }
      for (let i = 0; i < 80 && !(await page.evaluate((k) => window.game.islets.floraStats[k].built, k)); i++) await step(2);
      await page.evaluate((k) => { const L = window.game.islets.list[k].flora.landing; window.game.player.teleport(L.x, L.z, 0); }, k);
      await step(60);
      const r = await page.evaluate((k) => {
        const g = window.game, it = g.islets.list[k], f = it.flora.stats;
        let land = 0, pink = 0;
        for (const t of it.tiles) { const geo = t.mesh.geometry, P = geo.attributes.position, C = geo.attributes.color, N = geo.attributes.normal; if (!P || !C || !N) continue;
          for (let i = 0; i < P.count; i++) { if (P.getY(i) < 1.6 || N.getY(i) < 0.95) continue; land++; if (C.getZ(i) > C.getY(i) * 0.4) pink++; /* flat meadow: greens have b/g <= 0.25, petal drifts lift it */ } }
        return { id: it.def.id, petals: f.petals, ticks: f.petalTicks, cherryMesh: it.flora.group.children.some((c) => c.name === 'cherry-petals'), dressHidden: g.dress.petalsHidden, fxVisible: g.dress.fxMesh?.visible, pinkFrac: land ? +(pink / land).toFixed(3) : -1, land };
      }, k);
      if (d.id === 'blossom') {
        ok(`[${th}] Blossom Isle: cherry petals fall and animate`, r.cherryMesh && r.petals > 0 && r.ticks > 0, JSON.stringify(r));
        ok(`[${th}] Blossom Isle: season particles drift here too`, !r.dressHidden && r.fxVisible === true, JSON.stringify(r));
        ok(`[${th}] Blossom Isle: meadow keeps petal-pink drifts`, r.pinkFrac > 0.01, JSON.stringify(r));
      } else {
        ok(`[${th}] ${d.name}: no cherry petals`, !r.cherryMesh && r.petals === 0, JSON.stringify(r));
        if (dressPetals) ok(`[${th}] ${d.name}: season petals hidden`, r.dressHidden && r.fxVisible === false, JSON.stringify(r));
        else ok(`[${th}] ${d.name}: non-petal season particles untouched`, !r.dressHidden && r.fxVisible === true, JSON.stringify(r));
        ok(`[${th}] ${d.name}: no petal-pink ground tint`, r.land > 50 && r.pinkFrac < 0.005, JSON.stringify(r));
        if (th === 'spring' && d.kind === 'wood') { await page.evaluate((k) => { const g = window.game, L = g.islets.list[k].flora.landing; g.rig.yaw = Math.atan2(L.x, L.z); g.rig.pitch = 0.32; g.rig.distance = 16; }, k); await step(30); await page.waitForTimeout(600); await page.screenshot({ path: 'screenshots/islet-petals-heron-spring.png' }).catch(() => {}); }
      }
      if (d.id === 'blossom' && th === 'spring') { await page.evaluate((k) => { const g = window.game, L = g.islets.list[k].flora.landing; g.rig.yaw = Math.atan2(L.x, L.z); g.rig.pitch = 0.32; g.rig.distance = 16; }, k); await step(30); await page.waitForTimeout(600); await page.screenshot({ path: 'screenshots/islet-petals-blossom-spring.png' }).catch(() => {}); }
    }
    await page.evaluate(() => window.game.player.teleport(0, 0, 0)); await step(60);
    const back = await page.evaluate(() => ({ hidden: window.game.dress.petalsHidden, vis: window.game.dress.fxMesh?.visible }));
    ok(`[${th}] back home: season particles show again`, !back.hidden && back.vis === true, JSON.stringify(back));
    ok(`[${th}] no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }
} catch (e) { ok('test ran', false, e.message); }
finally { clearTimeout(kill); await browser.close(); }
const pass = results.filter(Boolean).length; console.log(`${pass}/${results.length} passed`); process.exit(pass === results.length ? 0 : 1);
