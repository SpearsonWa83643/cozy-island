/**
 * Big island 5/7, Order 39a: generate the world's height + biome grids in Web Workers.
 *
 * The grids used to be built synchronously on the main thread (first heightAt() / module load),
 * freezing the loading screen. `pregenerateWorld()` splits them into row bands, samples each band
 * in a worker (same pure code as the main thread: ./gen.ts) and installs the results before the
 * Terrain is built. Any failure or timeout falls back to the original main-thread path.
 *
 * Flag: `?gen=main` forces the main-thread path, `?gen=worker` forces workers; default = GEN_WORKER_DEFAULT.
 * `?gen=verify` runs the worker AND the main-thread path and reports whether they match exactly.
 */
import { GRID_N, GRID_RES, heightGridReady, setHeightGrid, biomes, heightRaw } from './Terrain';
import { sampleHeights, sampleBiomes, BIOME_COUNT, type GenRegion } from './gen';
import { WORLD_SIZE, ISLET_SIZE, ISLET_RES } from './config';
import { ISLET_N } from './isletGrid';
import type { GenReply, GenRequest } from './gen.worker';
import { loadBakedIslet } from './bakedTiles';

export const GEN_WORKER_DEFAULT = true;

export interface GenStats {
  mode: 'worker' | 'main' | 'fallback';
  workers: number;
  ms: number;
  /** summed worker compute time (ms) */
  workerMs: number;
  error?: string;
  /** set by ?gen=verify: max abs difference vs the main-thread path (0 = identical) */
  verify?: { heightDiff: number; biomeDiff: number; mainMs: number };
}
export let genStats: GenStats | null = null;

function genMode(): 'worker' | 'main' | 'verify' {
  const p = new URLSearchParams(location.search).get('gen');
  if (p === 'main' || p === 'worker' || p === 'verify') return p;
  return GEN_WORKER_DEFAULT ? 'worker' : 'main';
}

/** row bands of a square n×n grid */
function bands(n: number, k: number, size: number, res: number): GenRegion[] {
  const out: GenRegion[] = [];
  for (let b = 0; b < k; b++) {
    const j0 = Math.round((b * n) / k), j1 = Math.round(((b + 1) * n) / k);
    if (j1 > j0) out.push({ size, res, i0: 0, j0, w: n, h: j1 - j0 });
  }
  return out;
}

async function runInWorkers(timeoutMs: number) {
  const hc = (navigator.hardwareConcurrency || 2);
  const nW = Math.max(1, Math.min(4, hc - 1));
  const workers = Array.from({ length: nW }, () => new Worker(new URL('./gen.worker.ts', import.meta.url), { type: 'module' }));
  let workerMs = 0;
  try {
    // more bands than workers so a slow core doesn't hold everyone up
    const hJobs = bands(GRID_N, nW * 2, WORLD_SIZE, GRID_RES).map((region) => ({ kind: 'height' as const, region }));
    const bN = biomes.n;
    const bJobs = bands(bN, nW, WORLD_SIZE, biomes.res).map((region) => ({ kind: 'biome' as const, region }));
    const jobs = [...hJobs, ...bJobs];
    const height = new Float32Array(GRID_N * GRID_N), biome = new Float32Array(bN * bN * BIOME_COUNT);
    let next = 0, id = 0;
    const run = (w: Worker) => new Promise<void>((resolve, reject) => {
      const pump = () => {
        if (next >= jobs.length) { resolve(); return; }
        const job = jobs[next++], myId = ++id;
        w.onmessage = (e: MessageEvent<GenReply>) => {
          if (e.data.id !== myId) return;
          if (e.data.error || !e.data.data) { reject(new Error(e.data.error ?? 'no data')); return; }
          workerMs += e.data.ms ?? 0;
          const r = job.region;
          if (job.kind === 'height') height.set(e.data.data, r.j0 * GRID_N);
          else biome.set(e.data.data, r.j0 * bN * BIOME_COUNT);
          pump();
        };
        w.onerror = (ev) => reject(new Error(ev.message || 'worker error'));
        w.postMessage({ id: myId, kind: job.kind, region: job.region } satisfies GenRequest);
      };
      pump();
    });
    let timer = 0;
    await Promise.race([
      Promise.all(workers.map(run)),
      new Promise((_, rej) => { timer = window.setTimeout(() => rej(new Error(`timeout ${timeoutMs}ms`)), timeoutMs); }),
    ]);
    clearTimeout(timer);
    return { height, biome, workers: nW, workerMs };
  } finally {
    for (const w of workers) w.terminate();
  }
}

/** Fill the height + biome grids before the Terrain is built. Never throws. */
export async function pregenerateWorld(timeoutMs = 20000): Promise<GenStats> {
  const t0 = performance.now();
  const mode = genMode();
  if (heightGridReady() && biomes.ready) return (genStats = { mode: 'main', workers: 0, ms: 0, workerMs: 0 });
  if (mode === 'main' || typeof Worker === 'undefined') {
    // original path: grids build lazily on first use (Terrain constructor)
    return (genStats = { mode: 'main', workers: 0, ms: 0, workerMs: 0 });
  }
  try {
    const r = await runInWorkers(timeoutMs);
    let verify: GenStats['verify'];
    if (mode === 'verify') {
      const m0 = performance.now();
      const mh = sampleHeights({ size: WORLD_SIZE, res: GRID_RES, i0: 0, j0: 0, w: GRID_N, h: GRID_N });
      const mb = sampleBiomes({ size: WORLD_SIZE, res: biomes.res, i0: 0, j0: 0, w: biomes.n, h: biomes.n });
      const mainMs = performance.now() - m0;
      let heightDiff = 0, biomeDiff = 0;
      for (let k = 0; k < mh.length; k++) heightDiff = Math.max(heightDiff, Math.abs(mh[k] - r.height[k]));
      for (let k = 0; k < mb.length; k++) biomeDiff = Math.max(biomeDiff, Math.abs(mb[k] - r.biome[k]));
      // spot-check the shared heightRaw entry point too
      heightDiff = Math.max(heightDiff, Math.abs(Math.fround(heightRaw(-WORLD_SIZE / 2, -WORLD_SIZE / 2)) - r.height[0]));
      verify = { heightDiff, biomeDiff, mainMs };
    }
    setHeightGrid(r.height);
    biomes.setData(r.biome);
    return (genStats = { mode: 'worker', workers: r.workers, ms: performance.now() - t0, workerMs: r.workerMs, verify });
  } catch (err) {
    console.warn('[gen] worker generation failed, using main thread:', err);
    return (genStats = { mode: 'fallback', workers: 0, ms: performance.now() - t0, workerMs: 0, error: String(err) });
  }
}

/**
 * Order 42a: generate one archipelago islet's height grid off the main thread (one worker, one job;
 * ~34k samples). Falls back to the main thread on ?gen=main, no Worker support, an error or a timeout.
 */
export async function generateIsletGrid(k: number, timeoutMs = 15000): Promise<{ grid: Float32Array; mode: 'baked' | 'worker' | 'main'; ms: number }> {
  const t0 = performance.now();
  // Order 48c: a build-time baked tile from Cloudflare (immutable, usually a warm-cache hit) beats generating it
  if (genMode() !== 'main') { const g = await loadBakedIslet(k); if (g) return { grid: g, mode: 'baked', ms: performance.now() - t0 }; }
  const region: GenRegion = { size: ISLET_SIZE, res: ISLET_RES, i0: 0, j0: 0, w: ISLET_N, h: ISLET_N, islet: k };
  if (genMode() !== 'main' && typeof Worker !== 'undefined') {
    const w = new Worker(new URL('./gen.worker.ts', import.meta.url), { type: 'module' });
    try {
      const grid = await new Promise<Float32Array>((resolve, reject) => {
        // count only time the main thread was free to hear back (a long blocking frame / test loop
        // mustn't look like a dead worker): 250 ms ticks, each capped at 300 ms
        let waited = 0, last = performance.now();
        const timer = window.setInterval(() => {
          const now = performance.now(); waited += Math.min(300, now - last); last = now;
          if (waited >= timeoutMs) { clearInterval(timer); reject(new Error(`timeout ${timeoutMs}ms`)); }
        }, 250);
        w.onmessage = (e: MessageEvent<GenReply>) => { clearInterval(timer); if (e.data.data) resolve(e.data.data); else reject(new Error(e.data.error ?? 'no data')); };
        w.onerror = (ev) => { clearInterval(timer); reject(new Error(ev.message || 'worker error')); };
        w.postMessage({ id: 1, kind: 'height', region } satisfies GenRequest);
      });
      return { grid, mode: 'worker', ms: performance.now() - t0 };
    } catch (err) {
      // handled: the islet is still generated (on the main thread), so not a warning on a slow device
      console.info('[gen] islet worker failed, using main thread:', err);
    } finally { w.terminate(); }
  }
  return { grid: sampleHeights(region), mode: 'main', ms: performance.now() - t0 };
}
