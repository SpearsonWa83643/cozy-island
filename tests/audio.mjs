// Audio smoke test: unlock on first gesture, signal present, footsteps/build SFX, mute persists.
import { chromium } from 'playwright';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1000, height: 600 } });
const page = await ctx.newPage(); page.setDefaultTimeout(240000);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall/.test(m.text()))) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n} ${x}`); if (!c) process.exitCode = 1; };
await page.goto(base + '?webgl&q=low');
await page.waitForFunction(() => window.game?.ready);
ok('audio idle before gesture', await page.evaluate(() => !window.game.audio.started));
await page.mouse.click(500, 300);
await page.waitForFunction(() => window.game.audio.started, null, { timeout: 10000 });
ok('audio unlocked by first click', true);
await page.waitForTimeout(4000);
const lvl = await page.evaluate(() => window.game.audio.level());
ok('music/ambience producing signal', lvl > 0.001, `(rms ${lvl.toFixed(4)})`);
// footsteps on each surface + build sounds
await page.evaluate(() => { const a = window.game.audio; for (const s of ['sand', 'grass', 'snow', 'rock', 'leaves', 'mud', 'water', 'wood']) a.footstep(s); a.place(2); a.remove(); a.splash(0.3, 0.5, true); a.jump(); });
// walk through several biomes for a few seconds of real time
await page.evaluate(async () => {
  const g = window.game;
  for (const [x, z] of [[24, -8], [-6, -24], [-27, 6], [-12, 19], [20, 24]]) {
    g.player.teleport(x, z, 0); g.input.keys.add('w');
    for (let i = 0; i < 30; i++) g.step(1 / 60);
    await new Promise((r) => setTimeout(r, 600));
  }
  g.input.keys.delete('w');
});
ok('biome walk ran without audio errors', errors.length === 0, errors.join('\n'));
// mute + volume persist across reload
await page.click('.mute');
await page.evaluate(() => { const m = document.querySelector('.music'); m.value = '0.2'; m.dispatchEvent(new Event('input')); });
await page.waitForTimeout(600);
const muted = await page.evaluate(() => window.game.audio.level());
ok('mute silences output', muted < 0.002, `(rms ${muted.toFixed(4)})`);
await page.reload(); await page.waitForFunction(() => window.game?.ready);
const s = await page.evaluate(() => ({ ...window.game.audio.settings, icon: document.querySelector('.mute').textContent }));
ok('settings persisted in localStorage', s.muted === true && Math.abs(s.music - 0.2) < 1e-6 && s.icon === '🔇', JSON.stringify(s));
ok('no console errors', errors.length === 0, errors.join('\n'));
await browser.close();
