// Theme system: seasons + holidays, date windows, ?theme= / ?date= / setting overrides, live switch,
// Halloween dress + trick-or-treat, seasonal dress when forced. Desktop (High) + iPad (Low).
// Screenshots: screenshots/50-53, 57-59. Usage: node tests/theme.mjs [baseUrl] [--skip-desktop] [--skip-ipad]
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const outDir = new URL('../screenshots/', import.meta.url).pathname;
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const __closeBrowser = async (code) => { try { await browser.close(); } catch { /* ignore */ } process.exit(code); };
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => __closeBrowser(130));
process.on('uncaughtException', (e) => { console.error(e); __closeBrowser(1); });
process.on('unhandledRejection', (e) => { console.error(e); __closeBrowser(1); });
const results = []; const ok = (n, c, x = '') => { results.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
const errFilter = (m) => (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|swiftshader|Automatic fallback/i.test(m.text())));
const frames = (page, n) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const shot = async (page, n) => { await frames(page, 4); await page.screenshot({ path: outDir + n + '.png' }); console.log('saved', n); };
const steps = (page, n) => page.evaluate((n) => { for (let i = 0; i < n; i++) window.game.step(1 / 30); }, n);
async function open(ctx, query) {
  const page = await ctx.newPage(); page.setDefaultTimeout(300000);
  const errors = []; page.on('console', (m) => { if (errFilter(m)) errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + query); await page.waitForFunction(() => window.game?.ready);
  return { page, errors };
}
const info = (page) => page.evaluate(() => { const g = window.game; return { id: g.themes.current().id, src: g.themes.source(), body: document.body.className, ghosts: g.dress.ghosts.length, lanterns: g.dress.lanterns.length, candy: g.dress.candies.length, dressKids: g.dress.group.children.length, react: g.dress.reactables.length, moon: g.themeK }; });

async function run(label, dev, q) {
  const ctx = await browser.newContext(dev);
  const date = new Date();
  const inWindow = (date.getMonth() === 9) || (date.getMonth() === 10 && date.getDate() === 1);
  // 1) by date (today) – fresh storage
  let { page, errors } = await open(ctx, `?webgl&q=${q}`);
  await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForFunction(() => window.game?.ready);
  let s = await info(page);
  ok(`${label}: theme by today's date (${inWindow ? 'halloween' : 'season'})`, s.id === (inWindow ? 'halloween' : s.id) && s.src === 'date' && (inWindow ? s.id === 'halloween' : true), JSON.stringify(s));
  const dates = await page.evaluate(() => [
    '2026-03-15', '2026-07-04', '2026-09-15', '2026-10-01', '2026-10-13', '2026-10-31', '2026-11-01',
    '2026-11-02', '2026-11-24', '2026-11-29', '2026-12-15', '2026-12-27', '2026-01-15', '2026-02-20', '2026-09-30',
  ].map((d) => window.game.themes.forDate(d)).join());
  ok(`${label}: date windows (hidden holidays fall back to the season)`, dates === 'spring,summer,autumn,halloween,halloween,halloween,halloween,autumn,autumn,autumn,winter,winter,winter,winter,autumn', dates);
  await page.close();
  // 2) ?date= summer → summer; ?theme= forces
  ({ page, errors } = await open(ctx, `?webgl&q=${q}&date=2026-07-04`));
  s = await info(page); ok(`${label}: ?date=2026-07-04 → summer`, s.id === 'summer' && s.ghosts === 0 && s.dressKids > 0, JSON.stringify(s));
  await page.close();
  ({ page, errors } = await open(ctx, `?webgl&q=${q}&date=2026-07-04&theme=halloween`));
  s = await info(page); ok(`${label}: ?theme=halloween override`, s.id === 'halloween' && s.src === 'url' && /theme-halloween/.test(s.body) && s.ghosts >= 4 && s.lanterns > 20 && s.candy > 20, JSON.stringify(s));
  await steps(page, 120);
  const g0 = await page.evaluate(() => { const g = window.game; return { moon: g.themeK }; });
  ok(`${label}: dusk sky blended in`, g0.moon > 0.5, JSON.stringify(g0));
  if (label === 'desktop') {
    await page.evaluate(() => { const g = window.game, p = g.player.position; g.rig.locked = true; g.camera.position.set(p.x - 14, p.y + 7, p.z - 16); g.camera.lookAt(p.x + 10, p.y + 2.5, p.z + 12); });
    await shot(page, '50-halloween-overview');
    await page.evaluate(() => { const g = window.game, c = g.dress.patch; g.player.teleport(c.x + 3, c.z + 5, Math.PI); for (let i = 0; i < 20; i++) g.step(1 / 30); const p = g.player.position; g.rig.locked = true; g.camera.position.set(c.x + 3, p.y + 6, c.z + 9); g.camera.lookAt(c.x, p.y, c.z); });
    await shot(page, '51-halloween-pumpkin-patch');
  }
  // trick-or-treat
  const tt = await page.evaluate(() => {
    const g = window.game, gh = g.dress.ghosts[0], o = gh.obj.position;
    g.player.teleport(o.x, o.z + 1.4, Math.PI); for (let i = 0; i < 4; i++) g.step(1 / 30);
    const before = g.play.candy;
    const t = g.dress.target(g.player.position);
    t?.run();
    const mid = g.play.candy;
    g.play.save.data.candy = 9; gh.treatT = 0; g.dress.trickOrTreat(gh);
    const owned = ['witchhat', 'pumpkinhead', 'ghostsheet', 'catears', 'vampirecape', 'nightwings'].filter((id) => g.play.save.data.owned[id]);
    return { label: t?.label, before, mid, after: g.play.candy, owned };
  });
  ok(`${label}: trick-or-treat gives candy`, tt.label === 'Trick or Treat' && tt.mid > tt.before, JSON.stringify(tt));
  ok(`${label}: 8 candy swapped for a Halloween wearable`, tt.owned.length === 1 && tt.after < 9, JSON.stringify(tt));
  const cp = await page.evaluate(() => { const g = window.game, c = g.dress.candies.find((c) => c.alive); const n = g.play.candy; g.player.teleport(c.x, c.z, 0); for (let i = 0; i < 6; i++) g.step(1 / 30); return { n, after: g.play.candy, alive: c.alive }; });
  ok(`${label}: walking over candy collects it`, cp.after === cp.n + 1 && !cp.alive, JSON.stringify(cp));
  if (label === 'desktop') {
    await page.evaluate(() => { const g = window.game, gh = g.dress.ghosts[1] ?? g.dress.ghosts[0]; const o = gh.obj.position; g.player.teleport(o.x + 0.5, o.z + 3.2, Math.PI); for (let i = 0; i < 30; i++) g.step(1 / 30); const q = gh.obj.position; g.rig.locked = true; g.camera.position.set(q.x + 0.6, q.y + 1.2, q.z + 3); g.camera.lookAt(q.x, q.y + 0.55, q.z); });
    await shot(page, '52-halloween-ghost');
  }
  const tr = await page.evaluate(() => { const g = window.game, gh = g.dress.ghosts[0], o = gh.obj.position; g.player.teleport(o.x, o.z + 4, Math.PI); for (let i = 0; i < 4; i++) g.step(1 / 30);
    g.rig.locked = true; g.camera.position.set(o.x, o.y + 2, o.z + 7); g.camera.lookAt(o.x, o.y + 0.5, o.z); g.camera.updateMatrixWorld();
    const v = o.clone(); v.y += 0.55; v.project(g.camera); return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, r0: g.dress.reactions }; });
  if (label === 'ipad') await page.touchscreen.tap(tr.x, tr.y); else await page.mouse.click(tr.x, tr.y);
  await page.waitForTimeout(200);
  const tr2 = await page.evaluate(() => ({ r: window.game.dress.reactions, spin: window.game.dress.ghosts[0].spin }));
  ok(`${label}: tapping a ghost makes it react`, tr2.r === tr.r0 + 1 && tr2.spin > 0, JSON.stringify({ ...tr, ...tr2 }));
  // live switch via picker (spring ↔ halloween)
  await page.evaluate(() => { window.game.rig.locked = false; });
  const pick = async (t) => { if (label === 'ipad') { await page.tap('.dock .theme-btn'); await page.waitForTimeout(350); await page.tap(`.tp-item[data-t="${t}"]`); } else { await page.click('.dock .theme-btn'); await page.waitForTimeout(350); await page.click(`.tp-item[data-t="${t}"]`); } await page.waitForTimeout(400); };
  await pick('spring');
  s = await info(page); ok(`${label}: switch to spring live`, s.id === 'spring' && s.ghosts === 0 && !/theme-halloween/.test(s.body) && s.dressKids > 0, JSON.stringify(s));
  await pick('halloween');
  s = await info(page); ok(`${label}: switch back to halloween`, s.id === 'halloween' && s.ghosts >= 4, JSON.stringify(s));
  // classic URL alias → spring
  await page.goto(base + `?webgl&q=${q}&theme=classic`); await page.waitForFunction(() => window.game?.ready);
  s = await info(page); ok(`${label}: ?theme=classic migrates to spring`, s.id === 'spring', JSON.stringify(s));
  // forced seasonal dress screenshots (desktop)
  if (label === 'desktop') {
    for (const [th, shotName] of [['winter', '57-winter-overview'], ['christmas', '58-christmas-dress'], ['autumn', '59-autumn-leaves']]) {
      try {
        await page.close();
      } catch { /* ignore */ }
      ({ page, errors } = await open(ctx, `?webgl&q=${q}&theme=${th}`));
      s = await info(page);
      ok(`${label}: ?theme=${th} dress present`, s.id === th && s.dressKids > 0, JSON.stringify(s));
      await page.evaluate(() => {
        const g = window.game, c = g.dress.patch;
        g.player.teleport(c.x + 2, c.z + 6, Math.PI);
        for (let i = 0; i < 12; i++) g.step(1 / 30);
        const py = g.player.position.y;
        g.rig.locked = true;
        g.camera.position.set(c.x + 2, py + 6, c.z + 10);
        g.camera.lookAt(c.x, py + 1, c.z);
        g.camera.updateMatrixWorld();
      });
      await shot(page, shotName);
    }
  }
  if (label === 'ipad') {
    await page.evaluate(() => { const d = window.game.play.save.data; Object.assign(d.owned, { witchhat: 1, vampirecape: 1, pumpkinhead: 1, catears: 1 }); window.game.play.panels.refreshBadges(); window.game.rig.locked = false; });
    await page.goto(base + `?webgl&q=${q}&theme=halloween`); await page.waitForFunction(() => window.game?.ready);
    await page.tap('.gbtn.ward'); await page.waitForTimeout(400);
    await steps(page, 40);
    await page.tap('.wcard[data-id="witchhat"]'); await page.waitForTimeout(300);
    await steps(page, 20);
    await shot(page, '53-ipad-wardrobe-witchhat');
    ok(`${label}: wardrobe equips witch hat`, (await page.evaluate(() => window.game.play.save.data.equipped.hat)) === 'witchhat');
    // theme picker shows Auto + the 5 enabled themes (holidays hidden)
    await page.tap('.dock .theme-btn'); await page.waitForTimeout(400);
    const items = await page.evaluate(() => [...document.querySelectorAll('.tp-item')].map((b) => b.dataset.t).join());
    ok(`${label}: picker lists Auto + 4 seasons + Halloween`, items === 'auto,halloween,spring,summer,autumn,winter', items);
    await shot(page, '56b-ipad-all-themes');
  }
  // setting persists
  await page.evaluate(() => { localStorage.setItem('cozyIsland.theme.v1', 'halloween'); });
  await page.goto(base + `?webgl&q=${q}&date=2026-07-04`); await page.waitForFunction(() => window.game?.ready);
  s = await info(page); ok(`${label}: saved setting beats date`, s.id === 'halloween' && s.src === 'setting', JSON.stringify(s));
  // a saved hidden holiday reads as Auto (date → season)
  await page.evaluate(() => { localStorage.setItem('cozyIsland.theme.v1', 'christmas'); });
  await page.goto(base + `?webgl&q=${q}&date=2026-12-15`); await page.waitForFunction(() => window.game?.ready);
  s = await info(page); ok(`${label}: saved hidden theme (christmas) treated as Auto → winter`, s.id === 'winter' && s.src === 'date', JSON.stringify(s));
  // ?theme= still reaches hidden holidays (dev links)
  await page.goto(base + `?webgl&q=${q}&theme=thanksgiving`); await page.waitForFunction(() => window.game?.ready);
  s = await info(page); ok(`${label}: ?theme=thanksgiving dev link still works`, s.id === 'thanksgiving' && s.src === 'url', JSON.stringify(s));
  await page.evaluate(() => localStorage.setItem('cozyIsland.theme.v1', 'auto'));
  await page.waitForTimeout(300);
  ok(`${label}: no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}
try {
  if (!process.argv.includes('--skip-desktop')) await run('desktop', { viewport: { width: 1280, height: 800 } }, 'high');
  if (!process.argv.includes('--skip-ipad')) await run('ipad', { ...devices['iPad Pro 11'], hasTouch: true }, 'low');
} finally { await browser.close(); }
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
