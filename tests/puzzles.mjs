// Footprints + pressure stones. Usage: node tests/puzzles.mjs [baseUrl]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const __closeBrowser = async (code) => { try { await browser.close(); } catch { /* ignore */ } process.exit(code); };
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => __closeBrowser(130));
process.on('uncaughtException', (e) => { console.error(e); __closeBrowser(1); });
process.on('unhandledRejection', (e) => { console.error(e); __closeBrowser(1); });
const results = []; const ok = (n, c, x = '') => { results.push(!!c); console.log(c ? 'PASS' : 'FAIL', n, x); };
const errFilter = (m) => (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|swiftshader|Automatic fallback/i.test(m.text())));
const shotDir = path.resolve('screenshots'); fs.mkdirSync(shotDir, { recursive: true });

const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage(); page.setDefaultTimeout(120000);
const errors = []; page.on('console', (m) => { if (errFilter(m)) errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base + '?webgl&q=high'); await page.waitForFunction(() => window.game?.ready);
await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForFunction(() => window.game?.ready);

const feet = await page.evaluate(() => {
  const g = window.game, P = g.play.puzzles;
  g.player.teleport(2, 8, 0);
  for (let i = 0; i < 10; i++) g.step(1 / 30);
  const s0 = P.steps;
  // simulate soft-ground footsteps
  for (let i = 0; i < 8; i++) {
    const x = 2 + i * 0.55, z = 8;
    P.footstep({ x, y: g.heightAt(x, z), z }, 0, 'grass', false);
  }
  return { before: s0, after: P.steps, stones: P.stones.length };
});
ok('footprints record soft steps', feet.after >= feet.before + 6, JSON.stringify(feet));
ok('pressure stones placed', feet.stones === 4, JSON.stringify(feet));

const solve = await page.evaluate(() => {
  const g = window.game, P = g.play.puzzles;
  const SEQ = [0, 2, 1, 3];
  // wrong first
  P.stoneCool?.clear?.();
  // stand on wrong stone (1 first, but expect 0)
  const wrong = P.stones[1];
  g.player.teleport(wrong.x, wrong.z, 0);
  P.sense(g.player.position, 0.1);
  const afterWrong = P.input?.length ?? P.stones.filter((s) => s.lit).length;
  // clear cools and solve correctly
  for (const i of SEQ) {
    // bypass cool by advancing now
    for (let k = 0; k < 5; k++) P.sense({ x: 999, y: 0, z: 999 }, 0.2);
    const s = P.stones[i];
    g.player.teleport(s.x, s.z, 0);
    P.sense(g.player.position, 0.05);
  }
  // reveal + open
  for (let i = 0; i < 40; i++) P.update(0.05);
  g.player.teleport(P.chest.position.x, P.chest.position.z, 0);
  P.sense(g.player.position, 0.05);
  return {
    solved: P.solved, revealed: P.chestRevealed, open: P.chestOpen,
    lit: P.stones.filter((s) => s.lit).length,
    shells: g.play.save.data.shells,
    ownedN: Object.keys(g.play.save.data.owned).length,
    puzzles: g.play.save.data.puzzles,
  };
});
ok('pressure stones solve reveals chest', solve.solved && solve.revealed, JSON.stringify(solve));
ok('opening chest grants reward', solve.open && (solve.shells >= 8 || solve.ownedN > 3), JSON.stringify(solve));
ok('solve persisted on save', !!solve.puzzles?.stones, JSON.stringify(solve.puzzles));

// frame stones for screenshot
await page.evaluate(() => {
  const g = window.game, P = g.play.puzzles;
  const s = P.stones[0];
  g.player.teleport(s.x + 2, s.z + 3, Math.PI);
  for (let i = 0; i < 6; i++) g.step(1 / 30);
  g.rig.locked = true;
  const y = s.y + 1.2;
  g.camera.position.set(s.x + 0.5, y + 2.5, s.z + 7);
  g.camera.lookAt(s.x, s.y + 0.3, s.z);
  g.camera.updateMatrixWorld();
});
await page.screenshot({ path: path.join(shotDir, '75-pressure-stones-desktop.png') });

ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await ctx.close(); await browser.close();
const f = results.filter((r) => !r).length;
console.log(`\n${results.length - f}/${results.length} passed`);
process.exit(f ? 1 : 0);
