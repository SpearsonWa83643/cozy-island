/**
 * Fish of Cozy Island (Order 52a). Each lives in one kind of water and some only bite at a certain time of day
 * (or in the rain). The collection journal (52b) lists every one; silhouettes until caught.
 */
export type Water = 'pond' | 'sea' | 'deep';
export type FishTime = 'any' | 'day' | 'night' | 'rain';
export type Rarity = 'common' | 'uncommon' | 'rare';
export interface FishDef {
  id: string; name: string; icon: string; /** CSS hue-rotate so repeated emoji read as different fish */ hue: number;
  water: Water; time: FishTime; rarity: Rarity; size: [number, number]; /** marker sweeps per second in the reel meter */ speed: number;
}
export const FISH: FishDef[] = [
  // the Misty Marsh pond (fresh water)
  { id: 'minnow', name: 'Minnow', icon: '🐟', hue: 40, water: 'pond', time: 'any', rarity: 'common', size: [4, 9], speed: 0.7 },
  { id: 'carp', name: 'Pond Carp', icon: '🐟', hue: 200, water: 'pond', time: 'day', rarity: 'common', size: [25, 60], speed: 0.8 },
  { id: 'catfish', name: 'Whisker Catfish', icon: '🐟', hue: 300, water: 'pond', time: 'night', rarity: 'uncommon', size: [30, 80], speed: 0.95 },
  { id: 'trout', name: 'Rainbow Trout', icon: '🐟', hue: 120, water: 'pond', time: 'rain', rarity: 'uncommon', size: [20, 55], speed: 1.0 },
  { id: 'koi', name: 'Golden Koi', icon: '🐠', hue: 0, water: 'pond', time: 'any', rarity: 'rare', size: [30, 70], speed: 1.2 },
  // from the beach or a dock
  { id: 'sardine', name: 'Sardine', icon: '🐟', hue: 0, water: 'sea', time: 'any', rarity: 'common', size: [10, 20], speed: 0.75 },
  { id: 'crab', name: 'Shore Crab', icon: '🦀', hue: 0, water: 'sea', time: 'any', rarity: 'common', size: [6, 15], speed: 0.7 },
  { id: 'bass', name: 'Sea Bass', icon: '🐟', hue: 160, water: 'sea', time: 'day', rarity: 'common', size: [30, 70], speed: 0.85 },
  { id: 'snapper', name: 'Red Snapper', icon: '🐠', hue: 330, water: 'sea', time: 'day', rarity: 'uncommon', size: [30, 80], speed: 1.0 },
  { id: 'puffer', name: 'Pufferfish', icon: '🐡', hue: 0, water: 'sea', time: 'day', rarity: 'uncommon', size: [10, 30], speed: 0.9 },
  { id: 'squid', name: 'Moon Squid', icon: '🦑', hue: 0, water: 'sea', time: 'night', rarity: 'uncommon', size: [20, 50], speed: 1.05 },
  // out at sea in the rowboat
  { id: 'mackerel', name: 'Mackerel', icon: '🐟', hue: 90, water: 'deep', time: 'any', rarity: 'common', size: [25, 45], speed: 0.85 },
  { id: 'tuna', name: 'Bluefin Tuna', icon: '🐟', hue: 230, water: 'deep', time: 'day', rarity: 'uncommon', size: [80, 200], speed: 1.1 },
  { id: 'octopus', name: 'Octopus', icon: '🐙', hue: 0, water: 'deep', time: 'any', rarity: 'uncommon', size: [40, 120], speed: 1.0 },
  { id: 'lantern', name: 'Lanternfish', icon: '🐠', hue: 180, water: 'deep', time: 'night', rarity: 'uncommon', size: [5, 15], speed: 1.05 },
  { id: 'sunfish', name: 'Ocean Sunfish', icon: '🐡', hue: 200, water: 'deep', time: 'any', rarity: 'rare', size: [150, 300], speed: 1.3 },
];
export const FISH_BY_ID = new Map(FISH.map((f) => [f.id, f]));
export const WATER_NAME: Record<Water, string> = { pond: 'Pond', sea: 'Shore & docks', deep: 'Open sea (rowboat)' };
export const RARITY_W: Record<Rarity, number> = { common: 10, uncommon: 4, rare: 1.2 };
/** zone width in the reel meter (0..1 of the bar) */
export const ZONE_W: Record<Rarity, number> = { common: 0.3, uncommon: 0.24, rare: 0.18 };
export const TIME_HINT: Record<FishTime, string> = { any: 'Any time', day: 'Daytime', night: 'At night', rain: 'In the rain' };
