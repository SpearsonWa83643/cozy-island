// "What's new" note shown once on load after each release.
// Bump VERSION and replace the bullets to ship a new note. Leave ITEMS empty for no note.
export const VERSION = '2026-10-23-build-undo';

export type WhatsNewItem = { icon: 'wood' | 'fruit' | 'star' | 'heart'; text: string };

export const ITEMS: WhatsNewItem[] = [
  { icon: 'wood', text: 'Building got easier on iPad: tap Undo to take back your last piece, and Rotate now spins the glowing preview so you can see which way it will face.' },
  { icon: 'star', text: 'New mount: the Dragonfly! Dig up the Shimmer Wing from a treasure chest in the Misty Marsh, then zip around on shimmering, humming wings.' },
  { icon: 'star', text: 'Softer horizons: distant hills fade into a seasonal haze, and low mist settles in the valleys and over the sea. Fly up on a mount to see it.' },
  { icon: 'heart', text: 'Foxes have moved into Autumn Grove! Watch them pounce into the leaves, then feed one berries to make a new friend.' },
  { icon: 'star', text: 'New area: Lighthouse Point! Follow the stepping stones up the north-east headland to a red-and-white lighthouse with a sweeping lamp.' },
  { icon: 'heart', text: 'Tap the lighthouse to sound the foghorn, and sit at the lookout bench for the best view. It\'s on your map and the scenic tour too.' },
  { icon: 'star', text: 'Every theme has its own sound now! Autumn plays mellow guitar with crunchy leaves, Winter a music box with wind chimes, and Halloween has friendly ghost woos.' },
  { icon: 'heart', text: 'Spring and Summer sound different too! Spring has flute tunes, birdsong and bumblebees; Summer has marimba, cicadas and big waves.' },
  { icon: 'star', text: 'Scenic tours! Let go of the stick while riding and your mount flies you round the island on its own.' },
  { icon: 'heart', text: 'Steer any time to take the reins back. Rest a few seconds and the tour picks up again.' },
  { icon: 'wood', text: 'Themes trimmed to the four seasons plus Halloween.' },
  { icon: 'star', text: 'New mounts! Treasure chests hide a Pterodactyl Egg, a Cloud Tuft and a Rainbow Horseshoe.' },
  { icon: 'heart', text: 'Tap Call Mount to pick your ride: eagle, pterodactyl, cloud puppy, unicorn or dragonfly.' },
];
