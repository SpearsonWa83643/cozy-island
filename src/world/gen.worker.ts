/// <reference lib="webworker" />
// World-generation worker (Order 39a): samples height / biome grids off the main thread.
import { sampleHeights, sampleBiomes, type GenRegion } from './gen';

export interface GenRequest { id: number; kind: 'height' | 'biome'; region: GenRegion }
export interface GenReply { id: number; data?: Float32Array; ms?: number; error?: string }

self.onmessage = (e: MessageEvent<GenRequest>) => {
  const { id, kind, region } = e.data;
  try {
    const t0 = performance.now();
    const data = kind === 'height' ? sampleHeights(region) : sampleBiomes(region);
    (self as unknown as Worker).postMessage({ id, data, ms: performance.now() - t0 } satisfies GenReply, [data.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) } satisfies GenReply);
  }
};
