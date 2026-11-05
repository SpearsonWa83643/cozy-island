// Fishing (Order 52a), iPad touch viewport: the 🎣 Fish button shows by the water (Home Dock, the marsh pond, the
// rowboat out at sea) and hides inland; real taps cast, Hook! on the bite and Reel! in the green zone; a miss (two tries)
// lets it go, tapping before a bite reels in empty, walking off reels in; the fish depends on the water and the time
// of day; catches are saved across a reload. Screenshot 103 (reel meter). Timeout + browser closed in finally.
// Usage: node tests/fishing.mjs [baseUrl]
import { chromium, devices } from 'playwright';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const kill = setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 600000);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = []; const ok = (n, c, x = '') => { results.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
const errFilter = (m) => (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|swiftshader|Automatic fallback/i.test(m.text())));
try {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], deviceScaleFactor: 1, hasTouch: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(150000);
  const errors = []; page.on('console', (m) => { if (errFilter(m)) errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
  const q = '?webgl&q=low&touch=1&whatsnew=0&time=noon&weather=clear&boat=1';
  await page.goto(base + q); await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => document.getElementById('whatsnew')?.querySelector('.w-ok')?.click());
  const fs = () => page.evaluate(() => window.game.fishing.snapshot());
  const step = (n) => page.evaluate((n) => { for (let i = 0; i < n; i++) window.game.step(1 / 60); }, n);
  const until = async (st, max = 600) => { for (let i = 0; i < max / 10 && (await fs()).state !== st; i++) await step(10); return fs(); };
  const btnShown = () => page.evaluate(() => { const b = document.querySelector('.tbtn.fish'); return !!b && getComputedStyle(b).display !== 'none' && b.getBoundingClientRect().width > 0; });
  const btnLabel = () => page.evaluate(() => document.querySelector('.tbtn.fish')?.textContent ?? '');
  const tapFish = () => page.tap('.tbtn.fish');
  // catch one: cast (tap), wait for the bite, Hook! (tap), hold the marker in the zone, Reel! (tap)
  const catchOne = async () => {
    await tapFish(); const c = await fs();
    const b = await until('bite'); await page.evaluate(() => { window.game.fishing.freeze = true; }); const lbl = await btnLabel();
    await tapFish(); const r = await fs();
    await page.evaluate(() => { const f = window.game.fishing; f.marker = f.zone; });
    await tapFish(); await page.evaluate(() => { window.game.fishing.freeze = false; });
    return { cast: c.state, bite: b.state, hookLabel: lbl, reel: r.state, after: await fs() };
  };
  // inland: no button
  await page.evaluate(() => { const g = window.game; g.player.teleport(0, 0); for (let i = 0; i < 30; i++) g.step(1 / 60); });
  await step(30);
  ok('inland (island centre): no Fish button', !(await btnShown()) && !(await fs()).canFish, JSON.stringify(await fs()));
  // 1. the Home Dock, looking out to sea
  const atDock = async () => { await page.evaluate(() => { const g = window.game, d = g.docks.list[0]; g.player.teleport(d.step.x, d.step.z, d.moor.h, 0.62); g.rig.yaw = d.moor.h + Math.PI; for (let i = 0; i < 40; i++) g.step(1 / 60); }); await step(20); };
  await atDock();
  ok('on the Home Dock looking out to sea: 🎣 Fish button shows', (await btnShown()) && (await btnLabel()).includes('Fish'), await btnLabel());
  const c1 = await catchOne();
  const d1 = await page.evaluate(() => ({ fish: window.game.play.save.data.fish, water: window.game.fishing.water }));
  ok('tap Fish casts the bobber, a fish bites, Hook! starts the reel meter', c1.cast === 'cast' && c1.bite === 'bite' && c1.hookLabel.includes('Hook') && c1.reel === 'reel', JSON.stringify(c1));
  ok('Reel! in the green zone lands a shore fish and saves it', c1.after.state === 'idle' && c1.after.catches === 1 && d1.water === 'sea' && c1.after.last?.isNew && d1.fish?.[c1.after.last.id]?.n === 1, JSON.stringify(d1));
  // 2. a miss: two taps outside the zone and it's gone
  await tapFish(); await until('bite'); await page.evaluate(() => { window.game.fishing.freeze = true; }); await tapFish();
  await page.evaluate(() => { const f = window.game.fishing; f.marker = f.zone > 0.5 ? 0.02 : 0.98; });
  await page.waitForTimeout(600); await page.screenshot({ path: 'screenshots/103-ipad-fishing-reel.png' });
  await tapFish(); const m1 = await fs(); await tapFish(); const m2 = await fs(); await page.evaluate(() => { window.game.fishing.freeze = false; });
  ok('a miss outside the green costs a try; two misses and it wriggles free', m1.state === 'reel' && m1.tries === 1 && m2.state === 'idle' && m2.misses === 2 && m2.catches === 1, JSON.stringify({ m1, m2 }));
  // 3. too early, and walking off
  await tapFish(); await step(60); const e0 = await fs(); await tapFish(); const e1 = await fs();
  ok('tapping before a bite reels in empty', e0.state === 'wait' && e1.state === 'idle' && e1.catches === 1, JSON.stringify({ e0, e1 }));
  await tapFish(); await step(40);
  const w = await page.evaluate(() => { const g = window.game; g.input.stick.y = -1; for (let i = 0; i < 10; i++) g.step(1 / 60); g.input.stick.y = 0; return g.fishing.snapshot(); });
  ok('pushing the joystick (walking off) reels the line in', w.state === 'idle' && !w.visible, JSON.stringify(w));
  // 4. the marsh pond
  const pond = await page.evaluate(() => { const g = window.game, cx = -12 * 1.15, cz = 25 * 1.15;
    for (let r = 5; r < 14; r += 0.5) for (let a = 0; a < Math.PI * 2; a += 0.2) { const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (g.heightAt(x, z) > 0.08 && g.heightAt(cx + Math.cos(a) * (r - 3), cz + Math.sin(a) * (r - 3)) < -0.5) {
        g.player.teleport(x, z, Math.atan2(cx - x, cz - z)); g.rig.yaw = Math.atan2(x - cx, z - cz); for (let i = 0; i < 40; i++) g.step(1 / 60); return { x, z, r }; } }
    return null; });
  await step(20);
  ok('by the marsh pond: the Fish button shows', !!pond && (await btnShown()), JSON.stringify(pond));
  const c2 = await catchOne(); const p2 = await page.evaluate(() => window.game.fishing.water);
  const pondIds = ['minnow', 'carp', 'catfish', 'trout', 'koi'];
  ok('the pond gives pond fish', p2 === 'pond' && c2.after.catches === 2 && pondIds.includes(c2.after.last?.id), JSON.stringify({ p2, last: c2.after.last }));
  // 5. time of day + rain decide what bites (logic check over many picks)
  const mix = await page.evaluate(() => { const g = window.game, f = g.fishing, out = {}; const h0 = g.time.hour;
    const sample = (water) => { f.water = water; const s = new Set(); for (let i = 0; i < 400; i++) s.add(f.pick().id); return [...s].sort(); };
    g.time.hour = 12; g.time.update(0); out.dayPond = sample('pond'); out.daySea = sample('sea'); out.dayDeep = sample('deep');
    g.time.hour = 0; g.time.update(0); out.nightPond = sample('pond'); out.nightSea = sample('sea'); out.night = +g.time.night.toFixed(2);
    g.time.hour = h0; g.time.update(0); f.water = 'sea'; return out; });
  ok('daytime and night bring different fish (catfish + squid at night, carp + snapper by day; trout only in rain)',
    mix.nightPond.includes('catfish') && !mix.nightPond.includes('carp') && mix.dayPond.includes('carp') && !mix.dayPond.includes('catfish') && !mix.dayPond.includes('trout') &&
    mix.nightSea.includes('squid') && !mix.nightSea.includes('snapper') && mix.daySea.includes('snapper') && mix.dayDeep.includes('tuna') && !mix.daySea.includes('tuna'), JSON.stringify(mix));
  // 6. out at sea in the rowboat
  await atDock();
  await page.evaluate(() => { const g = window.game; g.player.teleport(g.docks.list[0].step.x, g.docks.list[0].step.z, g.docks.list[0].moor.h, 0.62); for (let i = 0; i < 40; i++) g.step(1 / 60); });
  await page.tap('.action-btn'); for (let i = 0; i < 60 && (await page.evaluate(() => window.game.mount.phase)) !== 'ride'; i++) await step(5);
  const sea = await page.evaluate(() => { const g = window.game, m = g.mount;
    for (let i = 0; i < 60 * 12; i++) { g.rig.yaw = Math.atan2(m.gx, m.gz) + Math.PI; g.input.stick.y = -1; g.step(1 / 60); if (g.coast.nearestLand(m.gx, m.gz).off > 30) break; }
    g.input.stick.y = 0; for (let i = 0; i < 20; i++) g.step(1 / 60); for (let i = 0; i < 20; i++) g.step(1 / 60);
    return { off: +g.coast.nearestLand(m.gx, m.gz).off.toFixed(1), speed: +m.speed.toFixed(2), phase: m.phase, autopilot: m.autopilot }; });
  await step(20);
  ok('sitting in the rowboat out at sea: the Fish button shows', sea.phase === 'ride' && sea.off > 25 && (await btnShown()), JSON.stringify(sea));
  await tapFish(); const s0 = await fs(); const sp0 = await page.evaluate(() => window.game.mount.speed);
  let s1 = s0; for (let i = 0; i < 60 && s1.state === 'idle'; i++) { await step(10); s1 = await fs(); }
  const m1b = await page.evaluate(() => ({ speed: +window.game.mount.speed.toFixed(2), autopilot: window.game.mount.autopilot }));
  ok('tapping Fish in a moving boat rests the oars (tour off) and casts once it slows', sp0 > 2.5 && s0.state === 'idle' && (s1.state === 'cast' || s1.state === 'wait'), JSON.stringify({ sp0, s1: s1.state, m1b }));
  const b3 = await until('bite'); await page.evaluate(() => { window.game.fishing.freeze = true; }); await tapFish(); await page.evaluate(() => { const f = window.game.fishing; f.marker = f.zone; }); await tapFish(); await page.evaluate(() => { window.game.fishing.freeze = false; });
  const c3 = { after: await fs() }; const p3 = await page.evaluate(() => window.game.fishing.water);
  ok('open sea from the boat gives deep-water fish', p3 === 'deep' && c3.after.catches === 3 && ['mackerel', 'tuna', 'octopus', 'lantern', 'sunfish', 'sardine', 'crab'].includes(c3.after.last?.id), JSON.stringify({ p3, last: c3.after.last }));
  // 7. saved across a reload
  const before = await page.evaluate(() => { window.game.play.save.flush(); return window.game.play.save.data.fish; });
  await page.reload(); await page.waitForFunction(() => window.game?.ready);
  const after = await page.evaluate(() => window.game.play.save.data.fish);
  const tot = (o) => Object.values(o ?? {}).reduce((s, r) => s + r.n, 0);
  ok('catches are saved across a reload', tot(after) === 3 && JSON.stringify(after) === JSON.stringify(before), JSON.stringify(after));
  ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(`${results.filter(Boolean).length}/${results.length} passed`);
  if (results.some((r) => !r)) process.exitCode = 1;
} finally { clearTimeout(kill); await browser.close().catch(() => {}); }
