// Biome tour: overview + one screenshot per biome, console error check.
// Usage: node tests/biomes.mjs [baseUrl] [--only=name,name]
import { chromium } from 'playwright';
import fs from 'node:fs';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const outDir = new URL('../screenshots/', import.meta.url).pathname;
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const __closeBrowser = async (code) => { try { await browser.close(); } catch { /* ignore */ } process.exit(code); };
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => __closeBrowser(130));
process.on('uncaughtException', (e) => { console.error(e); __closeBrowser(1); });
process.on('unhandledRejection', (e) => { console.error(e); __closeBrowser(1); });
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
page.setDefaultTimeout(300000);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall/.test(m.text()))) errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto(base + '?webgl&q=high');
await page.waitForFunction(() => window.game?.ready);
console.log('ready in', (Date.now() - t0) / 1000, 's');
const frames = (n) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

// [file, player x, z, facing, cam yaw, pitch, dist, simulate seconds]
const shots = [
  ['07-overview', null],
  ['08-meadow', [2, 4, 2.6, 0.5, 0.32, 9]],
  ['09-alpine', [-6, -22, 3.3, -0.2, 0.3, 10]],
  ['10-autumn', [24, -8, 1.2, 1.0, 0.3, 9]],
  ['11-tropical', ['beach', 21, 27, 0.8, -2.3, 0.3, 10]],
  ['12-desert', [-27, 6, -1.5, 1.4, 0.3, 11]],
  ['13-marsh', [-12, 18.5, 0, 3.1, 0.42, 11]],
];
for (const [name, cfg] of shots) {
  if (only.length && !only.some((o) => name.includes(o))) continue;
  const info = await page.evaluate((cfg) => {
    const g = window.game;
    if (!cfg) {
      g.rig.locked = true; g.camera.position.set(52, 40, 60); g.camera.lookAt(-3, 0, -2);
      g.player.teleport(0, 6, 0);
    } else {
      let [x, z, f, yaw, pitch, dist] = cfg;
      if (cfg[0] === 'beach') { // walk outwards from the biome centre to dry sand just above the waterline
        const [, cx, cz] = cfg; [f, yaw, pitch, dist] = cfg.slice(3);
        const l = Math.hypot(cx, cz); x = cx; z = cz;
        for (let r = l; r < l + 30; r += 0.5) {
          const px = (cx / l) * r, pz = (cz / l) * r;
          if (window.game.heightAt(px, pz) < 0.45) break; x = px; z = pz; }
        x -= (cx / l) * 3; z -= (cz / l) * 3;
      }
      g.rig.locked = false;
      g.player.teleport(x, z, f);
      for (let i = 0; i < 90; i++) g.step(1 / 60); // let atmosphere blend + creatures move
      g.rig.yaw = yaw; g.rig.pitch = pitch; g.rig.distance = dist;
      g.rig.target.copy(g.player.position).setY(g.player.position.y + 1.1); g.rig.apply();
    }
    for (let i = 0; i < 3; i++) g.step(1 / 60);
    const p = g.player.position;
    return { biome: document.querySelector('.biome-name')?.textContent, p: [p.x.toFixed(1), p.y.toFixed(1), p.z.toFixed(1)] };
  }, cfg);
  await frames(4);
  await page.screenshot({ path: `${outDir}${name}.png` });
  console.log('saved', name, info);
}
console.log('console errors/warnings:', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close();
