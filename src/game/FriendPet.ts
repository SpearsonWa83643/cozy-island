import type { SaveData, PetData } from './Save';

const NAMES: Record<string, string[]> = {
  bunny: ['Clover', 'Mochi', 'Biscuit', 'Pip', 'Hazel', 'Juniper', 'Tofu', 'Bramble', 'Nibbles', 'Daisy', 'Cocoa', 'Puff'],
  deer: ['Fern', 'Willow', 'Maple', 'Bambi', 'Aspen', 'Hickory', 'Sorrel', 'Chestnut', 'Birch', 'Rowan'],
  duck: ['Waddles', 'Puddle', 'Quackers', 'Dot', 'Bubbles', 'Lily', 'Ripple', 'Noodle', 'Pudding', 'Reed'],
  crab: ['Pinchy', 'Sandy', 'Clawdia', 'Shelly', 'Coral', 'Snappy', 'Barnaby', 'Kelp', 'Tide', 'Pebble'],
  goat: ['Billy', 'Clover', 'Pebbles', 'Nanny', 'Summit', 'Bramble', 'Cliff', 'Heidi', 'Juniper', 'Tumble'],
  frog: ['Ribbit', 'Lily', 'Hopper', 'Puddle', 'Kermie', 'Sprout', 'Bog', 'Pip', 'Freddie', 'Mossy'],
  fox: ['Rusty', 'Ember', 'Scout', 'Pumpkin', 'Copper', 'Saffron', 'Tod', 'Juniper', 'Marmalade', 'Flick'],
  bird: ['Tweety', 'Sunny', 'Skye', 'Pippa', 'Kiwi', 'Robin', 'Breeze', 'Chirpy', 'Feather', 'Wren'],
};

/** friendship needed to reach level l */
export const needFor = (l: number) => 4 * l * (l - 1);

export function ensurePet(d: SaveData, key: string, species: string): PetData {
  d.pets ??= {};
  let p = d.pets[key];
  if (!p) {
    const list = NAMES[species] ?? NAMES.bunny, id = +(key.split(':')[1] ?? 0);
    p = { name: list[(id * 7 + 3) % list.length], sp: species, love: 0, lvl: 1, clean: 0.9, tricks: [] };
    d.pets[key] = p;
  }
  return p;
}
