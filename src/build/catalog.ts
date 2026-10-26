/** Light build-piece metadata for Hud (keeps BuildMode + models out of the first paint chunk). */
export interface BuildMeta { id: string; label: string; icon: string; cat?: 'house' }
export type BuildTab = 'items' | 'house';
export const tabOf = (m: BuildMeta | undefined): BuildTab => (m?.cat === 'house' ? 'house' : 'items');

export const BUILD_CATALOG: BuildMeta[] = [
  { id: 'block', label: 'Wood Block', icon: '🟫' },
  { id: 'fence', label: 'Fence', icon: '🚧' },
  { id: 'lamp', label: 'Lamp', icon: '💡' },
  { id: 'tree', label: 'Tree', icon: '🌳' },
  { id: 'flowers', label: 'Flower Pot', icon: '🌷' },
  { id: 'jackolantern', label: "Jack-o'-Lantern", icon: '🎃' },
  { id: 'spookylamp', label: 'Spooky Lamp', icon: '🏮' },
  { id: 'flowerbox', label: 'Flower Box', icon: '🌸' },
  { id: 'sunflower', label: 'Sunflower', icon: '🌻' },
  { id: 'haybale', label: 'Hay Bale', icon: '🌾' },
  { id: 'snowman', label: 'Snowman', icon: '⛄' },
  { id: 'cornucopia', label: 'Cornucopia', icon: '🌽' },
  { id: 'xmastree', label: 'Holiday Tree', icon: '🎄' },
  { id: 'gift', label: 'Gift Box', icon: '🎁' },
  { id: 'skylantern', label: 'Lantern', icon: '🏮' },
  { id: 'heartballoon', label: 'Heart Balloon', icon: '💖' },
  { id: 'chick', label: 'Chick', icon: '🐣' },
  { id: 'path', label: 'Stone Path', icon: '🪨' },
  { id: 'stairs', label: 'Stairs', icon: '🪜' },
  { id: 'bridge', label: 'Bridge', icon: '🌉' },
  // Order 44: cottage kit (House tab)
  { id: 'wall', label: 'Wall', icon: '🧱', cat: 'house' },
  { id: 'window', label: 'Window', icon: '🪟', cat: 'house' },
  { id: 'door', label: 'Door', icon: '🚪', cat: 'house' },
  { id: 'roof', label: 'Roof', icon: '🛖', cat: 'house' },
  // Order 47: unlocks the hot-air balloon mount
  { id: 'balloonpad', label: 'Balloon Pad', icon: '🎈' },
];
