// Per-theme soundscapes (Walker, Oct 20 2026: every theme gets its own unique soundscape).
// A soundscape is the theme's whole sound: the music flavour plus how much of each ambience layer plays.
// Each Theme names its soundscape (theme.soundscape); themes that don't have a dedicated one yet fall back to
// a soundscape built from their legacy music/ambience fields. Switching theme crossfades (~3 s) in AudioEngine.
// Shipped: Spring + Summer (Oct 21); Autumn, Winter, Halloween (Oct 22). All five visible themes now have their own.
import type { Theme } from '../theme/theme';

export type MusicFlavor = 'classic' | 'spooky' | 'festive' | 'spring' | 'summer' | 'autumn' | 'winter';
export type SoundscapeId = 'spring' | 'summer' | 'autumn' | 'winter' | 'halloween';

export interface Soundscape {
  id: string;
  music: MusicFlavor;
  /** owl hoot rate 0..1 */
  owls: number;
  /** extra wind bed 0..1 */
  wind: number;
  /** multipliers on the island's own critter/ambience layers (1 = unchanged) */
  birds: number; gulls: number; crickets: number; surf: number;
  /** themed extras: bumblebee fly-bys, cicada drone, crunchy leaf rustle, distant wind chimes, friendly ghost "woo"s (0 = off) */
  bees: number; cicadas: number; leaves: number; chimes: number; spooks: number;
}

const BASE = { owls: 0, wind: 0, birds: 1, gulls: 1, crickets: 1, surf: 1, bees: 0, cicadas: 0, leaves: 0, chimes: 0, spooks: 0 };

export const SOUNDSCAPES: Record<SoundscapeId, Soundscape> = {
  // bright G-major flute + kalimba, lots of birdsong, bumblebees, a light breeze
  spring: { ...BASE, id: 'spring', music: 'spring', wind: 0.08, birds: 1.9, bees: 1, crickets: 0.6, gulls: 0.8 },
  // warm, lazy marimba in F, cicadas in the trees, bigger surf and more gulls, warm wind
  summer: { ...BASE, id: 'summer', music: 'summer', wind: 0.15, birds: 0.9, cicadas: 1, surf: 1.35, gulls: 1.8, crickets: 1.3 },
  // mellow guitar-like plucks in D with bittersweet chords, crunchy leaves on the breeze, woodpeckers, an owl at dusk
  autumn: { ...BASE, id: 'autumn', music: 'autumn', owls: 0.35, wind: 0.35, birds: 0.7, crickets: 0.8, gulls: 0.7, leaves: 1 },
  // slow music box + glassy chimes in E, soft snowy wind, hushed island, distant wind chimes, muffled surf
  winter: { ...BASE, id: 'winter', music: 'winter', owls: 0.25, wind: 0.55, birds: 0.25, crickets: 0, gulls: 0.4, surf: 0.75, chimes: 1 },
  // spooky-cute celesta + pizzicato in D minor, lots of owls, gusty wind, crickets, and friendly ghost "woo"s
  halloween: { ...BASE, id: 'halloween', music: 'spooky', owls: 1, wind: 0.6, birds: 0.3, crickets: 1.4, gulls: 0.5, leaves: 0.5, spooks: 1 },
};

/** the theme's soundscape, or one derived from its legacy music/ambience fields */
export function soundscapeFor(t: Theme): Soundscape {
  if (t.soundscape) return SOUNDSCAPES[t.soundscape];
  return { ...BASE, id: `legacy-${t.id}`, music: t.music, owls: t.ambience.owls, wind: t.ambience.wind };
}

/** numeric layers that crossfade smoothly */
export const MIX_KEYS = ['owls', 'wind', 'birds', 'gulls', 'crickets', 'surf', 'bees', 'cicadas', 'leaves', 'chimes', 'spooks'] as const;
export type Mix = Record<(typeof MIX_KEYS)[number], number>;
