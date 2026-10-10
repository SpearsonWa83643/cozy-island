/** Static game data: foods, wearables, rarities, dyes, animal tastes. */

export type FoodId = 'apple' | 'cherry' | 'berry' | 'blueberry' | 'acorn' | 'mushroom' | 'pinecone' | 'coconut' | 'cactusfruit' | 'seeds' | 'clover' | 'carrot' | 'reed'
  | 'conch' | 'seaglass' | 'starfish' | 'pearl'
  | 'worm' | 'bug' | 'fossil' | 'gem'
  | 'crystal' | 'geode' | 'glowcap' | 'relic';
/** sea items are treasures, not food: they show in the bag and trade for shells */
export interface FoodDef { id: FoodId; name: string; icon: string; sea?: boolean; trade?: number; }
export const FOODS: Record<FoodId, FoodDef> = {
  apple: { id: 'apple', name: 'Apple', icon: '🍎' },
  cherry: { id: 'cherry', name: 'Cherries', icon: '🍒' },
  berry: { id: 'berry', name: 'Wild berries', icon: '🍓' },
  blueberry: { id: 'blueberry', name: 'Blueberries', icon: '🫐' },
  acorn: { id: 'acorn', name: 'Acorn', icon: '🌰' },
  mushroom: { id: 'mushroom', name: 'Mushroom', icon: '🍄' },
  pinecone: { id: 'pinecone', name: 'Pinecone', icon: '🌲' },
  coconut: { id: 'coconut', name: 'Coconut', icon: '🥥' },
  cactusfruit: { id: 'cactusfruit', name: 'Cactus fruit', icon: '🌵' },
  seeds: { id: 'seeds', name: 'Sunflower seeds', icon: '🌻' },
  clover: { id: 'clover', name: 'Clover', icon: '☘️' },
  carrot: { id: 'carrot', name: 'Wild carrot', icon: '🥕' },
  reed: { id: 'reed', name: 'Reed grain', icon: '🌾' },
  conch: { id: 'conch', name: 'Conch shell', icon: '🐚', sea: true, trade: 2 },
  seaglass: { id: 'seaglass', name: 'Sea glass', icon: '💎', sea: true, trade: 3 },
  starfish: { id: 'starfish', name: 'Starfish', icon: '⭐', sea: true, trade: 2 },
  pearl: { id: 'pearl', name: 'Pearl', icon: '🦪', sea: true, trade: 6 },
  // dug up with the shovel
  worm: { id: 'worm', name: 'Wriggly worm', icon: '🪱' },
  bug: { id: 'bug', name: 'Beetle', icon: '🐞' },
  fossil: { id: 'fossil', name: 'Fossil', icon: '🦴', trade: 5 },
  gem: { id: 'gem', name: 'Raw gem', icon: '💠', trade: 7 },
  // found in the cave
  crystal: { id: 'crystal', name: 'Cave crystal', icon: '🔮', trade: 4 },
  geode: { id: 'geode', name: 'Geode', icon: '🪨', trade: 8 },
  glowcap: { id: 'glowcap', name: 'Glowcap mushroom', icon: '🍄' },
  relic: { id: 'relic', name: 'Ancient relic', icon: '🏺', trade: 12 },
};
export const FOOD_ORDER = Object.keys(FOODS) as FoodId[];

export type Species = 'bunny' | 'deer' | 'duck' | 'crab' | 'bird';
export const TASTES: Record<Species, { fav: FoodId[]; likes: FoodId[]; name: string; icon: string }> = {
  bunny: { name: 'Bunny', icon: '🐰', fav: ['carrot', 'clover'], likes: ['berry', 'blueberry', 'cherry'] },
  deer: { name: 'Deer', icon: '🦌', fav: ['apple'], likes: ['acorn', 'cherry', 'mushroom', 'pinecone'] },
  duck: { name: 'Duck', icon: '🦆', fav: ['seeds'], likes: ['reed', 'clover', 'berry', 'worm'] },
  crab: { name: 'Crab', icon: '🦀', fav: ['coconut'], likes: ['cactusfruit', 'apple', 'seeds'] },
  bird: { name: 'Bird', icon: '🐦', fav: ['worm', 'bug', 'berry', 'blueberry'], likes: ['seeds', 'cherry', 'pinecone'] },
};

export type Rarity = 0 | 1 | 2 | 3 | 4;
export const RARITY = [
  { name: 'Common', color: '#9aa0a6', weight: 50, shells: 2 },
  { name: 'Uncommon', color: '#4fbf4a', weight: 28, shells: 4 },
  { name: 'Rare', color: '#2f8fe0', weight: 14, shells: 8 },
  { name: 'Epic', color: '#b545e0', weight: 6, shells: 15 },
  { name: 'Legendary', color: '#f2a900', weight: 2, shells: 30 },
];

export type Slot = 'hat' | 'face' | 'neck' | 'back' | 'body' | 'sprout';
export const SLOTS: { id: Slot; name: string; icon: string }[] = [
  { id: 'hat', name: 'Hats', icon: '🎩' }, { id: 'face', name: 'Face', icon: '👓' }, { id: 'neck', name: 'Neck', icon: '🧣' },
  { id: 'back', name: 'Back', icon: '🎒' }, { id: 'body', name: 'Outfit', icon: '👕' }, { id: 'sprout', name: 'Sprout', icon: '🌱' },
];
export interface WearDef { id: string; slot: Slot; name: string; rarity: Rarity; icon: string; }
const W = (id: string, slot: Slot, name: string, rarity: Rarity, icon: string): WearDef => ({ id, slot, name, rarity, icon });
export const WEARABLES: WearDef[] = [
  // hats
  W('straw', 'hat', 'Straw Sunhat', 0, '👒'), W('bucket', 'hat', 'Bucket Hat', 0, '🪣'), W('party', 'hat', 'Party Hat', 0, '🥳'),
  W('beanie', 'hat', 'Cozy Beanie', 1, '🧶'), W('chef', 'hat', 'Chef Hat', 1, '🧑‍🍳'), W('mushcap', 'hat', 'Mushroom Cap', 1, '🍄'),
  W('flowercrown', 'hat', 'Flower Crown', 2, '🌸'), W('pirate', 'hat', 'Pirate Tricorn', 2, '🏴‍☠️'), W('frog', 'hat', 'Froggy Hood', 2, '🐸'),
  W('tophat', 'hat', 'Top Hat', 2, '🎩'), W('wizard', 'hat', 'Starry Wizard Hat', 3, '🧙'), W('viking', 'hat', 'Viking Helm', 3, '⚔️'),
  W('crown', 'hat', 'Golden Crown', 4, '👑'), W('halo', 'hat', 'Sunny Halo', 4, '😇'),
  W('sailor', 'hat', 'Sailor Cap', 1, '⚓'), W('fishhat', 'hat', 'Fish Hat', 2, '🐟'), W('captain', 'hat', 'Captain Hat', 2, '🧑‍✈️'), W('coralcrown', 'hat', 'Coral Crown', 3, '🪸'),
  W('minerhelmet', 'hat', 'Miner Helmet', 2, '⛑️'), W('crystalcrown', 'hat', 'Crystal Crown', 4, '💎'),
  // face
  W('roundglasses', 'face', 'Round Glasses', 0, '👓'), W('rosy', 'face', 'Rosy Cheeks', 0, '😊'), W('sunglasses', 'face', 'Shades', 1, '🕶️'),
  W('mustache', 'face', 'Dapper Mustache', 1, '🥸'), W('heartglasses', 'face', 'Heart Glasses', 2, '😍'), W('monocle', 'face', 'Monocle', 2, '🧐'),
  W('starglasses', 'face', 'Star Glasses', 3, '🤩'), W('snorkel', 'face', 'Snorkel Mask', 3, '🤿'),
  // neck
  W('redscarf', 'neck', 'Red Scarf', 0, '🧣'), W('bluescarf', 'neck', 'Blue Scarf', 0, '🧣'), W('bandana', 'neck', 'Bandana', 1, '🤠'),
  W('bowtie', 'neck', 'Bow Tie', 1, '🎀'), W('stripescarf', 'neck', 'Striped Scarf', 1, '🧣'), W('bell', 'neck', 'Bell Collar', 2, '🔔'),
  W('lei', 'neck', 'Flower Lei', 2, '🌺'), W('medal', 'neck', 'Explorer Medal', 3, '🏅'),
  W('kelpscarf', 'neck', 'Kelp Scarf', 1, '🌿'), W('shellneck', 'neck', 'Shell Necklace', 1, '🐚'), W('pearls', 'neck', 'Pearl Necklace', 3, '🦪'), W('crystalneck', 'neck', 'Crystal Pendant', 2, '🔷'),
  // back
  W('backpack', 'back', 'Yellow Backpack', 0, '🎒'), W('explorer', 'back', 'Explorer Pack', 1, '🧭'), W('balloon', 'back', 'Red Balloon', 1, '🎈'),
  W('leafwings', 'back', 'Leaf Wings', 2, '🍃'), W('cape', 'back', 'Hero Cape', 2, '🦸'), W('shell', 'back', 'Turtle Shell', 3, '🐢'),
  W('butterfly', 'back', 'Butterfly Wings', 3, '🦋'), W('royalcape', 'back', 'Royal Cape', 4, '👑'),
  W('floatie', 'back', 'Duck Floatie', 1, '🛟'), W('batwings', 'back', 'Bat Wings', 2, '🦇'),
  // body
  W('sunny', 'body', 'Sunny Tee', 0, '👕'), W('stripes', 'body', 'Sailor Stripes', 0, '🎽'), W('dots', 'body', 'Polka Dots', 1, '🔴'),
  W('overalls', 'body', 'Garden Overalls', 1, '👖'), W('hoodie', 'body', 'Leafy Hoodie', 2, '🧥'), W('starry', 'body', 'Starry Night', 3, '🌌'),
  W('rainbow', 'body', 'Rainbow Knit', 4, '🌈'),
  // sprout
  W('leaf', 'sprout', 'Leaf Sprout', 0, '🌱'), W('twoleaf', 'sprout', 'Double Leaf', 0, '🌿'), W('flower', 'sprout', 'Daisy Sprout', 1, '🌼'),
  W('cherrysprout', 'sprout', 'Cherry Sprout', 2, '🍒'), W('starsprout', 'sprout', 'Star Sprout', 3, '⭐'), W('goldsprout', 'sprout', 'Golden Sprout', 4, '✨'),
  W('glowsprout', 'sprout', 'Glowcap Sprout', 2, '🍄'),
  W('kelpsprout', 'sprout', 'Kelp Sprout', 1, '🌱'), W('pearlsprout', 'sprout', 'Pearl Sprout', 3, '🫧'),
];
export const WEAR_BY_ID = new Map(WEARABLES.map((w) => [w.id, w]));
export const DEFAULT_OWNED = ['backpack', 'sunny', 'leaf'];
export const DEFAULT_EQUIPPED: Partial<Record<Slot, string>> = { back: 'backpack', body: 'sunny', sprout: 'leaf' };

export const DYES = [
  { id: 'coral', name: 'Coral', color: '#ff8a65', cost: 0 }, { id: 'sky', name: 'Sky', color: '#6fb8ff', cost: 8 },
  { id: 'mint', name: 'Mint', color: '#6fdcae', cost: 8 }, { id: 'lemon', name: 'Lemon', color: '#ffd84d', cost: 8 },
  { id: 'lilac', name: 'Lilac', color: '#b98cff', cost: 12 }, { id: 'rose', name: 'Rose', color: '#ff7eb6', cost: 12 },
  { id: 'forest', name: 'Forest', color: '#4f9a5a', cost: 16 }, { id: 'night', name: 'Midnight', color: '#3d4a8a', cost: 20 },
  { id: 'snow', name: 'Snow', color: '#f4f4f0', cost: 20 },
];

/** the seaside set: found in floating bottles out on the reef (also in chests) */
export const SEA_WEAR = ['sailor', 'fishhat', 'captain', 'coralcrown', 'goggles', 'snorkel', 'kelpscarf', 'shellneck', 'pearls', 'floatie', 'kelpsprout', 'pearlsprout', 'stripes'];

/** the cave set: only from the cave (geodes, the mole's thanks, the old miner's crate) */
export const CAVE_WEAR = ['minerhelmet', 'crystalcrown', 'batwings', 'crystalneck', 'glowsprout'];
