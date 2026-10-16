// "What's new" note shown once on load after each release.
// Bump VERSION and replace the bullets to ship a new note. Leave ITEMS empty for no note.
export const VERSION = '2026-10-16-mounts-fastload';

export type WhatsNewItem = { icon: 'wood' | 'fruit' | 'star' | 'heart'; text: string };

export const ITEMS: WhatsNewItem[] = [
  { icon: 'star', text: 'New mounts! Treasure chests hide a Pterodactyl Egg, a Cloud Tuft and a Rainbow Horseshoe.' },
  { icon: 'heart', text: 'Tap Call Mount to pick your ride: eagle, pterodactyl, cloud puppy or unicorn.' },
  { icon: 'star', text: 'Cozier loading screen with a progress bar, and much faster repeat visits.' },
  { icon: 'wood', text: 'Seasons & holidays dress the whole island.' },
  { icon: 'fruit', text: 'Tap trees, plants, rocks and water — they react!' },
];
