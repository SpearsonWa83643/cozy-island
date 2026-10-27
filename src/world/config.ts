/**
 * World configuration: the single source of truth for island size, layout and world bounds.
 * Everything that used to assume a 196 m world reads from here, so the island can grow
 * (Big island 1/7) by changing these numbers. Keep this module dependency-free.
 */

/** island scale vs. the original 47 m layout: noise, biomes and pond are evaluated at x/S, z/S */
export const ISLAND_SCALE = 1.15;
/** island radius in the unscaled layout (metres) */
export const BASE_RADIUS = 47;
/** island radius in world metres */
export const ISLAND_RADIUS = BASE_RADIUS * ISLAND_SCALE;
/** area factor for densities (flora counts etc.) */
export const AREA = ISLAND_SCALE * ISLAND_SCALE;
/** sea level */
export const WATER_LEVEL = 0;
/** sea-floor height reported outside the terrain extent */
export const OUT_OF_WORLD_DEPTH = -3.5;

/** terrain mesh / height grid extent (metres, square, centred on the origin) */
export const WORLD_SIZE = 196;
export const WORLD_HALF = WORLD_SIZE / 2;
/** target terrain tile size (metres); tiles are vertex-aligned so the real size is ~WORLD_SIZE / round(WORLD_SIZE / CHUNK_SIZE) */
export const CHUNK_SIZE = 64;
/** terrain tiles stream in within this xz distance (m) of the camera (Order 39b); beyond the fog so tiles never pop in view */
export const STREAM_RADIUS = 300;
/** extra distance (m) before a streamed-in tile is unloaded again (avoids load/unload flicker at the edge) */
export const STREAM_HYSTERESIS = 24;
/** memory cap: most terrain tile geometries kept at once (Order 39c); ~0.1 MB each at 64 m */
export const TILE_CAP = 48;
/** terrain physics tile size (metres); only the ring of tiles around the player has a collider (Order 36) */
export const PHYS_CHUNK_SIZE = 32;
/** tiles kept on each side of the player's tile: 1 = a 3x3 ring */
export const PHYS_RING = 1;
/** ocean plane extent (metres) */
export const OCEAN_SIZE = 1200;
/** world half-size shown on the paper map */
/** half-size of the sun shadow frustum around the player (metres) */
export const SHADOW_HALF = 34;
/** same, on low quality */
export const SHADOW_HALF_LOW = 26;
export const MAP_EXTENT = 58 * ISLAND_SCALE;

/** Biome centres in the unscaled layout (x, z, spread). Order matches the Biome enum. */
export const BASE_CENTERS: [number, number, number][] = [
  [0, 3, 17],      // meadow (broad, middle)
  [-6, -31, 13],   // alpine peak, north
  [28, -10, 12],   // autumn grove, east
  [21, 27, 13],    // tropical beach, south-east
  [-31, 5, 12],    // desert mesa, west
  [-13, 27, 10],   // misty marsh + pond, south-west
];
export const BASE_POND = { x: -12, z: 25, r: 5.5 };

/** World bounds (axis-aligned, metres). */
export const WORLD_BOUNDS = { minX: -WORLD_HALF, maxX: WORLD_HALF, minZ: -WORLD_HALF, maxZ: WORLD_HALF } as const;

/** true if (x, z) lies inside the terrain extent, with an optional inset margin */
export function inWorld(x: number, z: number, margin = 0) {
  return x >= WORLD_BOUNDS.minX + margin && x <= WORLD_BOUNDS.maxX - margin && z >= WORLD_BOUNDS.minZ + margin && z <= WORLD_BOUNDS.maxZ - margin;
}
/** clamp a coordinate into the terrain extent (with an optional inset margin) */
export function clampWorld(v: number, margin = 0) {
  return Math.max(-WORLD_HALF + margin, Math.min(WORLD_HALF - margin, v));
}
/** random point on the island: uniform-area disc of radius ISLAND_RADIUS * k */
export function randomIslandPoint(rnd: () => number, k = 1, out = { x: 0, z: 0 }) {
  const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * ISLAND_RADIUS * k;
  out.x = Math.cos(a) * d; out.z = Math.sin(a) * d; return out;
}

/**
 * The generated archipelago (Walker, Oct 23: "generated and a cluster of islands"). Each islet is a
 * separate generated height field outside the main grid, streamed in near the camera (Order 42).
 * x/z = centre (world m), r = mean shoreline radius (m), peak = central knoll height (m).
 */
/** generated islets' flora palette (Order 48b): green wood, pine forest or palm beach */
export type IsletKind = 'wood' | 'pine' | 'palm';
export const ISLET_KINDS: IsletKind[] = ['wood', 'pine', 'palm'];
export interface IsletDef { id: string; name: string; x: number; z: number; r: number; seed: number; peak: number; kind?: IsletKind }
/** hand-placed islets (they carry bespoke content: Blossom Isle's grove, hot spring, path, sakura) */
const FIXED_ISLETS: IsletDef[] = [
  // Blossom Isle (Order 42): ~120 m across, ~270 m from the centre (~210 m of open sea) to the north-east, past Lighthouse Point
  { id: 'blossom', name: 'Blossom Isle', x: 190, z: -190, r: 66, seed: 4242, peak: 6.5 },
];
/** Order 48a: seed + count for the generated part of the archipelago (bump GEN_COUNT to add islands) */
export const ARCHIPELAGO_SEED = 4810;
export const GEN_COUNT = 3; // Order 48b: 4 islets in all (Blossom + 3 generated)
const ISLE_NAMES = ['Fern Isle', 'Pebble Isle', 'Willow Isle', 'Moss Isle', 'Driftwood Isle', 'Clover Isle', 'Heron Isle', 'Juniper Isle'];

/**
 * Seeded island placement (Order 48a, procedural archipelago): adds `count` islets around the main island, deterministic
 * for a seed. Rules: an islet's height-field box (ISLET_SIZE) never overlaps the main grid or another islet's box, it stays
 * inside the ocean plane, and its open-sea gap to the main shore is 110-160 m so a flying mount's 85 m leash (FLY_LEASH)
 * always reaches it. Pure function (shared by the main thread and the terrain worker).
 */
export function placeIslets(seed: number, count: number, fixed: IsletDef[] = []): IsletDef[] {
  let a = seed >>> 0;
  const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = [...fixed], half = ISLET_SIZE / 2, used = new Set(fixed.map((d) => d.name));
  for (let i = 0; i < count; i++) {
    for (let tries = 0; tries < 200; tries++) {
      const th = rnd() * Math.PI * 2, r = 54 + Math.round(rnd() * 10), c = Math.cos(th), sn = Math.sin(th);
      const dMin = (WORLD_HALF + half + 2) / Math.max(Math.abs(c), Math.abs(sn));
      const D = Math.max(dMin, ISLAND_RADIUS + r + 112 + rnd() * 30), gap = D - r - ISLAND_RADIUS;
      if (gap < 110 || gap > 160) continue;
      const x = Math.round(c * D), z = Math.round(sn * D);
      if (Math.max(Math.abs(x), Math.abs(z)) + half > OCEAN_SIZE / 2 - 20) continue;
      if (out.some((o) => Math.max(Math.abs(o.x - x), Math.abs(o.z - z)) < ISLET_SIZE + 8)) continue;
      let name = ISLE_NAMES[Math.floor(rnd() * ISLE_NAMES.length)];
      for (let k = 0; used.has(name) && k < ISLE_NAMES.length; k++) name = ISLE_NAMES[(ISLE_NAMES.indexOf(name) + 1) % ISLE_NAMES.length];
      used.add(name);
      out.push({ id: `gen${i}`, name, x, z, r, seed: Math.floor(rnd() * 1e6), peak: +(5 + rnd() * 3).toFixed(1), kind: ISLET_KINDS[i % ISLET_KINDS.length] });
      break;
    }
  }
  return out;
}
/** islet height-field extent (m, square around the islet centre) and grid spacing (m) */
export const ISLET_SIZE = 184; // islet boxes must not overlap the main grid (|x|,|z| <= WORLD_HALF)
export const ISLET_RES = 1;
/** islets start generating when the camera is this close to their centre (m) */
export const ISLET_GEN_RADIUS = STREAM_RADIUS + 120;
/** flying mounts may roam this far past the nearest shore (m); swimmers keep the reef leash */
export const FLY_LEASH = 85;

/** the archipelago: hand-placed islets + the seeded ones (after ISLET_SIZE / FLY_LEASH so placement can use them) */
export const ISLETS: IsletDef[] = placeIslets(ARCHIPELAGO_SEED, GEN_COUNT, FIXED_ISLETS);
