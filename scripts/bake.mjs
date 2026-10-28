// Order 48c: bake the archipelago's islet height tiles at build time (procedural only, same pure code as the
// game: src/world/gen.ts, so the baked grid is bit-identical to what the gen worker would produce).
// Format per islet: gzip( byte-shuffled little-endian Float32 grid, ISLET_N x ISLET_N, row-major ).
// Byte shuffling (all byte-0s, then byte-1s, ...) makes smooth float data compress ~2.3x; it stays lossless.
// Used by the Vite plugin in vite.config.ts (runs on every `npm run build`, i.e. on Cloudflare Pages) and
// standalone as `npm run bake` (writes .bake/ for inspection).
import { runnerImport } from 'vite';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function shuffle(f32) {
  const raw = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength), n = f32.length, out = new Uint8Array(raw.length);
  for (let i = 0; i < n; i++) { out[i] = raw[i * 4]; out[n + i] = raw[i * 4 + 1]; out[2 * n + i] = raw[i * 4 + 2]; out[3 * n + i] = raw[i * 4 + 3]; }
  return out;
}

/** @returns {Promise<{ tiles: { id: string, name: string, n: number, bytes: Buffer, raw: number, ms: number }[], ms: number }>} */
export async function bakeTiles(root = ROOT) {
  const t0 = performance.now();
  const opts = { root, configFile: false };
  const { module: gen } = await runnerImport(path.join(root, 'src/world/gen.ts'), opts);
  const { module: cfg } = await runnerImport(path.join(root, 'src/world/config.ts'), opts);
  const n = Math.round(cfg.ISLET_SIZE / cfg.ISLET_RES) + 1;
  const tiles = cfg.ISLETS.map((d, k) => {
    const t = performance.now();
    const g = gen.sampleHeights({ size: cfg.ISLET_SIZE, res: cfg.ISLET_RES, i0: 0, j0: 0, w: n, h: n, islet: k });
    const bytes = zlib.gzipSync(shuffle(g), { level: 9 });
    return { id: d.id, name: d.name, n, bytes, raw: g.byteLength, ms: +(performance.now() - t).toFixed(1) };
  });
  return { tiles, ms: +(performance.now() - t0).toFixed(0) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = path.join(ROOT, '.bake');
  fs.mkdirSync(out, { recursive: true });
  const r = await bakeTiles();
  for (const t of r.tiles) {
    fs.writeFileSync(path.join(out, `islet-${t.id}.tile`), t.bytes);
    console.log(`[bake] ${t.name.padEnd(15)} ${t.n}x${t.n}  ${(t.raw / 1024).toFixed(0)} KB -> ${(t.bytes.length / 1024).toFixed(1)} KB  ${t.ms} ms`);
  }
  console.log(`[bake] ${r.tiles.length} islet tiles in ${r.ms} ms -> ${out}`);
}
