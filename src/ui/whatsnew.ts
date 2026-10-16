// "What's new" note shown once on load after each release.
// Bump VERSION and replace the bullets to ship a new note. Leave ITEMS empty for no note.
export const VERSION = '2026-10-16-lazy-load';

export type WhatsNewItem = { icon: 'wood' | 'fruit' | 'star' | 'heart'; text: string };

export const ITEMS: WhatsNewItem[] = [
  { icon: 'star', text: 'Faster first paint — map, friends, build & music load on demand.' },
  { icon: 'star', text: 'Physics loads as its own WASM file — leaner & cacheable.' },
  { icon: 'star', text: 'Dev tip: add ?debug to see load timing.' },
  { icon: 'star', text: 'Ride a bald eagle! Tap Call Mount.' },
  { icon: 'wood', text: 'Seasons & holidays dress the whole island.' },
  { icon: 'fruit', text: 'Tap trees, plants, rocks and water — they react!' },
  { icon: 'heart', text: 'Clean HUD: ⚙️ hides panels, 🎨 picks any theme.' },
];
