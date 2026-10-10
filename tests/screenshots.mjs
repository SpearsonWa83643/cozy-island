// Playwright smoke test + screenshot capture. Usage: node tests/screenshots.mjs [url] [--webgl]
import { chromium } from 'playwright';
import fs from 'node:fs';

const url = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4180/';
const forceWebGL = process.argv.includes('--webgl');
const outDir = new URL('../screenshots/', import.meta.url).pathname;
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(240000);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

const t0 = Date.now();
await page.goto(url + (forceWebGL ? '?webgl' : ''), { waitUntil: 'load' });
await page.waitForFunction(() => window.game?.ready, null, { timeout: 240000 });
console.log('ready in', (Date.now() - t0) / 1000, 's');
const info = await page.evaluate(() => ({ backend: window.game.renderer.backendName, gpu: !!navigator.gpu }));
console.log('backend:', info);

const frames = (n) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const shot = async (name) => { await frames(4); await page.screenshot({ path: outDir + name }); console.log('saved', name); };

// warm-up frames + measure rough fps
const fps0 = Date.now(); await frames(20); console.log('rough headless fps:', (20000 / (Date.now() - fps0)).toFixed(1));

// 1) overview
await page.evaluate(() => {
  const g = window.game; g.rig.locked = true;
  g.camera.position.set(38, 26, 46); g.camera.lookAt(0, 0, 0);
});
await shot('01-island-overview.png');

// 2) character close-up
await page.evaluate(() => {
  const g = window.game; g.rig.locked = false;
  g.player.teleport(0, 6, 0.5);
  g.rig.yaw = 0.2; g.rig.pitch = 0.2; g.rig.distance = 4.6;
  g.rig.target.copy(g.player.position).setY(g.player.position.y + 1.0);
});
await frames(10);
await shot('02-character-closeup.png');

// 3) build mode with placed objects
await page.evaluate(() => {
  const g = window.game;
  g.player.teleport(1.5, 7.5, 2.4);
  const b = g.build;
  b.toggle(true);
  const P = (x, z, t, r = 0) => b.placeAt(x, z, t, r);
  for (let i = 0; i < 4; i++) P(-4 + i, 3, 0);
  P(-4, 4, 0); P(-4, 5, 0);
  for (let i = 0; i < 5; i++) P(-5 + i, 8, 1);
  P(-5, 7, 1, Math.PI / 2); P(-5, 6, 1, Math.PI / 2);
  P(0, 4, 2); P(-1, 8.0 - 1, 2);
  P(2, 2, 3); P(-2, 4, 4); P(-3, 4, 4); P(-1, 4, 4);
  b.select(0);
  g.rig.yaw = -0.15; g.rig.pitch = 0.6; g.rig.distance = 11;
  g.rig.target.set(-1.5, g.player.position.y + 0.6, 5);
  g.input.setMouse(window.innerWidth * 0.58, window.innerHeight * 0.6);
});
// stack blocks on top
await page.evaluate(() => { const g = window.game; const c = g.build.group.children; const y = c[0].position.y + 1; g.build.placeAt(-4, 3, 0, 0, y); g.build.placeAt(-3, 3, 0, 0, c[1].position.y + 1); g.build.placeAt(-4, 3, 0, 0, y + 1); });
await frames(30);
await shot('03-build-mode.png');

// 4) low quality comparison
await page.evaluate(() => { window.game.setQuality('low'); window.game.build.toggle(false); });
await frames(10);
await shot('04-low-quality.png');
await page.evaluate(() => window.game.setQuality('high'));

// gameplay sanity: walk forward and jump, check movement + grounded
const moved = await page.evaluate(async () => {
  const g = window.game; const a = g.player.position.clone();
  g.input.keys.add('w');
  for (let i = 0; i < 60; i++) g.step(1 / 60);
  g.input.keys.delete('w');
  g.input.pressed.add(' ');
  let maxY = -1e9; const base = g.player.position.y;
  for (let i = 0; i < 40; i++) { g.step(1 / 60); maxY = Math.max(maxY, g.player.position.y); }
  return { walked: a.distanceTo(g.player.position), jumpHeight: maxY - base };
});
console.log('movement check:', moved);
console.log('console errors/warnings:', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close();
