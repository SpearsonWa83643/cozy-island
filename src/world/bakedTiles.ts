/**
 * Order 48c: load an islet's height grid baked at build time (scripts/bake.mjs), served from Cloudflare as an
 * immutable hashed asset. Lossless (gzip of a byte-shuffled Float32 grid), so it is bit-identical to the worker
 * output. Returns null when there is no bake (dev server), `?bake=off`, no DecompressionStream, a fetch error,
 * or a grid that fails validation — callers then generate the grid in the worker as before.
 */
import baked from 'virtual:cozy-baked';
import { ISLETS, ISLET_SIZE, ISLET_RES } from './config';
import { isletHeightRaw } from './gen';
import { ISLET_N } from './isletGrid';

export function bakedAvailable(k: number) {
  if (!baked || typeof DecompressionStream === 'undefined') return false;
  if (new URLSearchParams(location.search).get('bake') === 'off') return false;
  const e = baked.islets[ISLETS[k]?.id];
  return !!e && e.n === ISLET_N;
}

export async function loadBakedIslet(k: number, timeoutMs = 8000): Promise<Float32Array | null> {
  if (!bakedAvailable(k)) return null;
  const d = ISLETS[k], e = baked!.islets[d.id];
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(e.url, { signal: ctl.signal });
    if (!res.ok || !res.body) return null;
    const buf = new Uint8Array(await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    const n = ISLET_N * ISLET_N;
    if (buf.length !== n * 4) return null;
    const out = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) { out[i * 4] = buf[i]; out[i * 4 + 1] = buf[n + i]; out[i * 4 + 2] = buf[2 * n + i]; out[i * 4 + 3] = buf[3 * n + i]; }
    const g = new Float32Array(out.buffer);
    // validate against the live generator at a few points (catches a stale or mismatched bake)
    for (const [i, j] of [[0, 0], [ISLET_N >> 1, ISLET_N >> 1], [ISLET_N - 1, 7], [31, ISLET_N - 5]]) {
      const x = i * ISLET_RES - ISLET_SIZE / 2, z = j * ISLET_RES - ISLET_SIZE / 2; // same expression as sampleHeights()
      const h = Math.fround(isletHeightRaw(d, x + d.x, z + d.z));
      if (g[j * ISLET_N + i] !== h) { console.info('[bake] islet tile mismatch, regenerating', d.id); return null; }
    }
    return g;
  } catch (err) {
    console.info('[bake] islet tile fetch failed, generating instead:', d.id, err);
    return null;
  } finally { clearTimeout(timer); }
}
