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
