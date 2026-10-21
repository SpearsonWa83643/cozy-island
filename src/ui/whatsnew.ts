// "What's new" note shown once on load after each release.
// Bump VERSION and replace the bullets to ship a new note. Leave ITEMS empty for no note.
export const VERSION = '2026-10-21-soundscapes';

export type WhatsNewItem = { icon: 'wood' | 'fruit' | 'star' | 'heart'; text: string };

export const ITEMS: WhatsNewItem[] = [
  { icon: 'heart', text: 'Spring and Summer now sound different! Spring has flute tunes, birdsong and bumblebees; Summer has marimba, cicadas and big waves.' },
  { icon: 'star', text: 'Scenic tours! Let go of the stick while riding and your mount flies you round the island on its own.' },
  { icon: 'heart', text: 'Steer any time to take the reins back. Rest a few seconds and the tour picks up again.' },
  { icon: 'wood', text: 'Themes trimmed to the four seasons plus Halloween.' },
  { icon: 'star', text: 'New mounts! Treasure chests hide a Pterodactyl Egg, a Cloud Tuft and a Rainbow Horseshoe.' },
  { icon: 'heart', text: 'Tap Call Mount to pick your ride: eagle, pterodactyl, cloud puppy or unicorn.' },
];
