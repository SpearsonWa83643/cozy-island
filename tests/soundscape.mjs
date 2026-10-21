// Per-theme soundscapes (iPad touch viewport 1024x1366): Spring + Summer have their own soundscape, theme switch via the
// picker crossfades music flavour + ambience layers, legacy themes (Halloween) still map. Timeout + browser closed in finally.
// Usage: node tests/soundscape.mjs [baseUrl] [--shot]
import { chromium } from 'playwright';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4191/';
const kill = setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 330000);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const results = []; const ok = (n, c, x = '') => { results.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
const errFilter = (m) => (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|swiftshader|Automatic fallback/i.test(m.text())));
try {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 1366 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(120000);
  const errors = []; page.on('console', (m) => { if (errFilter(m)) errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '?webgl&q=low&touch=1&whatsnew=0&theme=spring');
  await page.waitForFunction(() => window.game?.ready);
  const a = () => page.evaluate(() => { const au = window.game.audio; return { id: au.soundscapeId, flavor: au.musicFlavor, gen: au.music?.mode ?? null, mix: { ...au.layerMix }, started: au.started, lvl: au.level(), theme: window.game.themes.current().id }; });
  let s = await a();
  ok('spring soundscape picked before audio starts', s.id === 'spring' && s.flavor === 'spring' && !s.started, JSON.stringify(s));
  await page.touchscreen.tap(512, 900);
  await page.waitForFunction(() => window.game.audio.started, null, { timeout: 15000 });
  await page.evaluate(() => window.game.player.teleport(0, 8));
  await page.waitForFunction(() => window.game.audio.music?.mode === 'spring', null, { timeout: 15000 });
  await page.waitForTimeout(3000);
  s = await a();
  ok('spring music running (flute/kalimba flavour) with signal', s.gen === 'spring' && s.lvl > 0.0005, JSON.stringify({ gen: s.gen, lvl: s.lvl }));
  ok('spring layers: bees on, lots of birds, no cicadas', s.mix.bees > 0.95 && s.mix.birds > 1.8 && s.mix.cicadas < 0.01, JSON.stringify(s.mix));
  await page.evaluate(() => window.game.audio.bee());
  // switch to Summer through the real picker (touch)
  await page.tap('.dock .theme-btn'); await page.waitForTimeout(350); await page.tap('.tp-item[data-t="summer"]');
  await page.waitForTimeout(500);
  s = await a();
  ok('summer selected, crossfade in progress (cicadas easing in)', s.theme === 'summer' && s.id === 'summer' && s.mix.cicadas > 0 && s.mix.cicadas < 0.95, JSON.stringify(s.mix));
  await page.waitForTimeout(4500);
  s = await a();
  ok('summer crossfade done: marimba flavour, cicadas + surf + gulls up, bees gone', s.gen === 'summer' && s.mix.cicadas > 0.97 && s.mix.surf > 1.3 && s.mix.gulls > 1.75 && s.mix.bees < 0.03, JSON.stringify({ gen: s.gen, mix: s.mix }));
  ok('summer still producing signal', s.lvl > 0.0005, `(rms ${s.lvl.toFixed(4)})`);
  // Halloween has no dedicated soundscape yet → legacy mapping (spooky music, owls)
  await page.tap('.dock .theme-btn'); await page.waitForTimeout(350); await page.tap('.tp-item[data-t="halloween"]');
  await page.waitForTimeout(5000);
  s = await a();
  ok('halloween legacy soundscape: spooky + owls', s.id === 'legacy-halloween' && s.gen === 'spooky' && s.mix.owls > 0.95 && s.mix.cicadas < 0.06, JSON.stringify({ id: s.id, gen: s.gen, mix: s.mix }));
  ok('no console errors', errors.length === 0, errors.slice(0, 5).join('\n'));
  if (process.argv.includes('--shot')) {
    await page.goto(base + '?webgl&q=low&touch=1&whatsnew=1&theme=summer');
    await page.waitForFunction(() => window.game?.ready); await page.waitForSelector('#whatsnew .w-card'); await page.waitForTimeout(800);
    await page.screenshot({ path: 'screenshots/77-ipad-whatsnew-soundscapes.png' });
    console.log('shot screenshots/77-ipad-whatsnew-soundscapes.png');
  }
} catch (e) { console.error(e); results.push(false); }
finally { clearTimeout(kill); await browser.close().catch(() => {}); }
const pass = results.filter(Boolean).length; console.log(`${pass}/${results.length} passed`); process.exit(pass === results.length ? 0 : 1);
