// "What's new" note shown once on load after each release.
// Bump VERSION and replace the bullets to ship a new note. Leave ITEMS empty for no note.
export const VERSION = '2026-11-06-home';

export type WhatsNewItem = { icon: 'wood' | 'fruit' | 'star' | 'heart'; text: string };

export const ITEMS: WhatsNewItem[] = [
  { icon: 'wood', text: 'Go inside your cottage! Walk through the door and the roof hides so you can look around. Build Mode has a new Furnish tab: place a bed, table, chairs, rug, lamp, shelves or a plant. Furniture snaps to the floor and walls, undo takes the last piece back, and it all saves with your house.' },
  { icon: 'star', text: 'Gone fishing! Stand by the beach, a dock, the marsh pond or sit in your rowboat, then tap 🎣 Fish. Wait for the bobber to dip, tap Hook!, then Reel! in the green. Catch lots of fish for your journal.' },
  { icon: 'heart', text: 'Your collection journal! Tap 📖 Journal to see Fish, Friends and Treasures. Silhouettes turn into finds as you catch, befriend and dig. Finish a whole page for a special cosmetic (Angler\'s Cap, Buddy Badge or Collector Sprout).' },
  { icon: 'star', text: 'Row between the islands! Find the wooden rowboat at Home Dock, tap 🛶 to hop in, and steer with the stick. Tie up at every islet dock, watch the foamy wake, and your boat remembers where you left it.' },
  { icon: 'fruit', text: 'Weather comes and goes! Soft rain (or snow in winter) greys the sky, ripples the water and hushes the birds. After a shower clears by day, a rainbow can appear. Tap 🌦 to try Clear, Rain, Snow, Rainbow or Live weather.' },
  { icon: 'star', text: 'Day and night! The sun and moon arc across the sky, stars twinkle after dark, frogs chorus in the marsh, and the lighthouse beam sweeps only at night. Tap 🌗 to jump to Dawn, Noon, Dusk, Night or Live clock.' },
  { icon: 'star', text: 'Two more islands! Juniper Isle rose up to the north, covered in pine trees, birches, ferns and red mushrooms. Driftwood Isle is out east, a sunny palm beach with tropical plants and lots of shells. Each one has a pink pennant at its landing spot and its own corner on your map, and the scenic tour now laps all four islands.' },
  { icon: 'star', text: 'The archipelago grows! A second little island, Heron Isle, has appeared off the south beach. It grew all by itself, with a leafy green wood, wildflowers and shells, plus a pink pennant marking the landing spot. Fly over on a winged mount, and look for its new corner on your map.' },
  { icon: 'star', text: 'New mount: the Hot-Air Balloon! Build a Balloon Pad (Build Mode, Items tab) to unlock it. Tap Call Mount, pick the balloon and it floats over from its pad. Ride slow and high, tap Jump to puff the burner, and let go of the stick for a dreamy drift out to Blossom Isle and back.' },
  { icon: 'fruit', text: 'New forage: Sakura blossoms! Pick them up under the cherry trees on Blossom Isle. Deer love them, and bunnies and birds like them too.' },
  { icon: 'heart', text: 'A hot spring on Blossom Isle! Look for the steaming rock pool in the meadow, next to a little stone lantern. Walk in to sit down for a warm, bubbly soak. It steams extra on snowy winter days.' },
  { icon: 'wood', text: 'Build your own cottage! Build Mode has a House tab with walls, windows, a door and a red tiled roof. Walls snap to the edges of the grid, so a 2x2 cottage takes just a few taps. Tap the door to swing it open and walk inside.' },
];
