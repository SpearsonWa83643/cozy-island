// Data-driven mount definitions (mirrors 2D Master's src/mount/defs.ts).
// The bald eagle is free; the others unlock when their treasure turns up in a treasure chest.
import type { SaveData } from '../game/Save';

export type MountId = 'eagle' | 'pterodactyl' | 'cloud_puppy' | 'unicorn' | 'dragonfly' | 'sea_turtle' | 'balloon';

// no emoji fits a pterodactyl or a cloud puppy, so they get little inline SVG icons (1em, inline in text)
const svg = (inner: string) => `<svg class="mico" viewBox="0 0 40 40" aria-hidden="true">${inner}</svg>`;
const PTERO_SVG = svg('<path d="M20 21 L2 10 L7 20 L1 24 L13 25Z M20 21 L38 10 L33 20 L39 24 L27 25Z" fill="#7cc2ae" stroke="#2f6a60" stroke-width="1.6" stroke-linejoin="round"/>'
  + '<ellipse cx="20" cy="24" rx="5" ry="7.5" fill="#4f9686" stroke="#2f6a60" stroke-width="1.6"/><path d="M17 11 L8 5 L18 8Z" fill="#f08a4b" stroke="#b5592a" stroke-width="1.2" stroke-linejoin="round"/>'
  + '<circle cx="20" cy="13" r="4.8" fill="#4f9686" stroke="#2f6a60" stroke-width="1.6"/><path d="M23 12 L34 15.5 L23 16Z" fill="#f2c77a" stroke="#b07f45" stroke-width="1.2" stroke-linejoin="round"/><circle cx="21" cy="12" r="1.3" fill="#2a1a12"/>');
const SHOE_SVG = svg('<path d="M6.0 35 V19 A14.0 14.0 0 0 1 34.0 19 V35" fill="none" stroke="#ff6f7d" stroke-width="2.6" stroke-linecap="round"/><path d="M8.4 35 V19 A11.6 11.6 0 0 1 31.6 19 V35" fill="none" stroke="#ffa64d" stroke-width="2.6" stroke-linecap="round"/><path d="M10.8 35 V19 A9.2 9.2 0 0 1 29.2 19 V35" fill="none" stroke="#ffd84d" stroke-width="2.6" stroke-linecap="round"/><path d="M13.2 35 V19 A6.8 6.8 0 0 1 26.8 19 V35" fill="none" stroke="#7fd67a" stroke-width="2.6" stroke-linecap="round"/><path d="M34 3 L35.2 6 L38 7 L35.2 8 L34 11 L32.8 8 L30 7 L32.8 6Z" fill="#fff6b0" stroke="#e0b13a" stroke-width="1"/>');
const PUPPY_SVG = svg('<g fill="#fff" stroke="#9cc3e6" stroke-width="2"><circle cx="11" cy="26" r="7.5"/><circle cx="29" cy="26" r="7.5"/><circle cx="20" cy="27" r="8"/><circle cx="20" cy="17" r="10"/></g>'
  + '<ellipse cx="10.5" cy="17" rx="3.4" ry="6" fill="#c7dcf3" transform="rotate(20 10.5 17)"/><ellipse cx="29.5" cy="17" rx="3.4" ry="6" fill="#c7dcf3" transform="rotate(-20 29.5 17)"/>'
  + '<circle cx="16.5" cy="16" r="1.8" fill="#2a2230"/><circle cx="23.5" cy="16" r="1.8" fill="#2a2230"/><ellipse cx="20" cy="20" rx="2.3" ry="1.6" fill="#2a2230"/><ellipse cx="20.6" cy="23.6" rx="1.5" ry="2" fill="#ff8fa6"/>');

const DRAGONFLY_SVG = svg('<g stroke="#4b8fb0" stroke-width="1.2" fill="#d8f4ff" fill-opacity=".85"><ellipse cx="11" cy="12" rx="9" ry="3.6" transform="rotate(-18 11 12)"/><ellipse cx="29" cy="12" rx="9" ry="3.6" transform="rotate(18 29 12)"/>'
  + '<ellipse cx="11.5" cy="19" rx="8" ry="3.2" transform="rotate(14 11.5 19)"/><ellipse cx="28.5" cy="19" rx="8" ry="3.2" transform="rotate(-14 28.5 19)"/></g>'
  + '<path d="M20 15 L20 37" stroke="#2f9c8f" stroke-width="3.4" stroke-linecap="round"/><path d="M20 22 L20 36" stroke="#6fe0c8" stroke-width="1.4" stroke-dasharray="2 2"/>'
  + '<ellipse cx="20" cy="14" rx="3.6" ry="4.2" fill="#3fb7a3" stroke="#22766b" stroke-width="1.2"/><circle cx="17" cy="9" r="3" fill="#7b5cff" stroke="#3d2a99" stroke-width="1"/><circle cx="23" cy="9" r="3" fill="#7b5cff" stroke="#3d2a99" stroke-width="1"/>'
  + '<circle cx="16.2" cy="8.2" r=".9" fill="#fff"/><circle cx="22.2" cy="8.2" r=".9" fill="#fff"/>');
const WING_SVG = svg('<path d="M6 30 C8 14 22 5 35 6 C31 16 21 27 6 30Z" fill="#d8f4ff" stroke="#4b8fb0" stroke-width="1.6" stroke-linejoin="round"/><path d="M7 29 C15 22 23 15 33 8 M14 25 L18 16 M21 20 L26 12" fill="none" stroke="#8fc8e6" stroke-width="1.1"/>'
  + '<path d="M10 26 C16 21 22 16 30 10" fill="none" stroke="#c9a6ff" stroke-width="2" stroke-linecap="round" opacity=".7"/><path d="M33 22 L34.2 25 L37 26 L34.2 27 L33 30 L31.8 27 L29 26 L31.8 25Z" fill="#fff6b0" stroke="#e0b13a" stroke-width="1"/>');

const BALLOON_SVG = svg('<path d="M20 3 C30 3 35 10 35 17 C35 24 27 28 24 31 L16 31 C13 28 5 24 5 17 C5 10 10 3 20 3Z" fill="#ff7a6b" stroke="#a8433a" stroke-width="1.5"/>'
  + '<path d="M20 3 C25 3 27 10 27 17 C27 24 23 28 22 31 L18 31 C17 28 13 24 13 17 C13 10 15 3 20 3Z" fill="#ffe3a8" stroke="#a8433a" stroke-width="1.1"/><path d="M20 3 C21.5 8 21.5 26 20 31" fill="none" stroke="#5cb7e8" stroke-width="2.4"/>'
  + '<path d="M16 31 L17 34 M24 31 L23 34" stroke="#7a5230" stroke-width="1.2"/><rect x="15.5" y="33.5" width="9" height="5" rx="1.2" fill="#c08850" stroke="#7a5230" stroke-width="1.3"/>');
const TURTLE_SVG = svg('<g fill="#7fc98a" stroke="#2f7a52" stroke-width="1.5" stroke-linejoin="round"><path d="M9 14 L1 9 L5 17Z"/><path d="M31 14 L39 9 L35 17Z"/><path d="M10 28 L4 34 L12 31Z"/><path d="M30 28 L36 34 L28 31Z"/><ellipse cx="20" cy="5.5" rx="4.6" ry="4.2"/></g>'
  + '<ellipse cx="20" cy="21" rx="12" ry="13" fill="#4fa36a" stroke="#2f6a45" stroke-width="1.6"/><path d="M20 10 L26 15 L26 25 L20 30 L14 25 L14 15Z" fill="#8bd39a" stroke="#2f6a45" stroke-width="1.2"/>'
  + '<path d="M14 15 L9 13 M26 15 L31 13 M14 25 L9 28 M26 25 L31 28" stroke="#2f6a45" stroke-width="1.2"/><circle cx="18" cy="4.6" r="1" fill="#1d2a20"/><circle cx="22" cy="4.6" r="1" fill="#1d2a20"/>');
const PEARL_SVG = svg('<path d="M3 26 C6 12 34 12 37 26 C30 22 10 22 3 26Z" fill="#f4c6d8" stroke="#b3708f" stroke-width="1.5" stroke-linejoin="round"/><path d="M3 26 C9 37 31 37 37 26 C30 30 10 30 3 26Z" fill="#e9a6c2" stroke="#b3708f" stroke-width="1.5" stroke-linejoin="round"/>'
  + '<circle cx="20" cy="23" r="7" fill="#fbf7ff" stroke="#b6b0d6" stroke-width="1.3"/><circle cx="17.5" cy="20.5" r="2.2" fill="#fff"/><path d="M33 4 L34.2 7 L37 8 L34.2 9 L33 12 L31.8 9 L29 8 L31.8 7Z" fill="#fff6b0" stroke="#e0b13a" stroke-width="1"/>');

export interface MountTreasure { id: string; name: string; icon: string; blurb: string }

export interface MountDef {
  id: MountId;
  name: string;
  /** short name for toasts ("your eagle") */
  short: string;
  /** HTML icon (emoji or inline SVG) for buttons, tiles and toasts */
  icon: string;
  /** treasure that unlocks this mount; null = always free (bald eagle) */
  treasure: MountTreasure | null;
  /** shown on a locked picker tile */
  hint: string;
  blurb: string;
  /** unlocked by building something instead of a treasure (balloon: place a Balloon Pad) */
  build?: 'balloonpad';
}

export const MOUNTS: MountDef[] = [
  { id: 'eagle', name: 'Bald Eagle', short: 'eagle', icon: '🦅', treasure: null, hint: '', blurb: 'Your first flying friend!' },
  {
    id: 'pterodactyl', name: 'Pterodactyl', short: 'pterodactyl', icon: PTERO_SVG,
    treasure: { id: 'pterodactyl_egg', name: 'Pterodactyl Egg', icon: '🥚', blurb: 'Warm! Call Mount to ride a pterodactyl!' },
    hint: 'Find the Pterodactyl Egg in a treasure chest', blurb: 'A big friendly flyer from long ago!',
  },
  {
    id: 'cloud_puppy', name: 'Cloud Puppy', short: 'cloud puppy', icon: PUPPY_SVG,
    treasure: { id: 'cloud_puppy_tuft', name: 'Cloud Tuft', icon: '☁️', blurb: 'Fluffy! Call Mount to ride a cloud puppy!' },
    hint: 'Find the Cloud Tuft in a treasure chest', blurb: 'A soft puppy made of clouds!',
  },
  {
    id: 'unicorn', name: 'Unicorn', short: 'unicorn', icon: '🦄',
    treasure: { id: 'rainbow_horseshoe', name: 'Rainbow Horseshoe', icon: SHOE_SVG, blurb: 'So shiny! Call Mount to ride a unicorn!' },
    hint: 'Find the Rainbow Horseshoe in a treasure chest', blurb: 'A sparkly flying unicorn!',
  },
  {
    id: 'dragonfly', name: 'Dragonfly', short: 'dragonfly', icon: DRAGONFLY_SVG,
    treasure: { id: 'shimmer_wing', name: 'Shimmer Wing', icon: WING_SVG, blurb: 'It hums! Call Mount to ride a dragonfly!' },
    hint: 'Find the Shimmer Wing in a Misty Marsh treasure chest', blurb: 'A zippy, shimmery marsh flyer!',
  },
  {
    id: 'sea_turtle', name: 'Sea Turtle', short: 'sea turtle', icon: TURTLE_SVG,
    treasure: { id: 'sea_pearl', name: 'Sea Pearl', icon: PEARL_SVG, blurb: 'It glows like the sea! Call Mount by the water to ride a sea turtle!' },
    hint: "Find the Sea Pearl in the captain's chest at Shipwreck Cove", blurb: 'A gentle swimmer that dives over the reef!',
  },
  // Order 47: built, not found: placing a Balloon Pad (Build → Items) unlocks it
  {
    id: 'balloon', name: 'Hot-Air Balloon', short: 'balloon', icon: BALLOON_SVG, treasure: null, build: 'balloonpad',
    hint: 'Build a Balloon Pad (Build → Items)', blurb: 'A slow, dreamy drift between the islands!',
  },
];

/** treasures that never come from dug-up chests: they have their own spot (sea_pearl: the Shipwreck Cove chest) */
export const SPECIAL_TREASURES = new Set(['sea_pearl']);

/** treasures that only turn up in one climate zone's chests (index into BIOME_NAMES: 5 = Misty Marsh) */
export const TREASURE_BIOME: Record<string, number> = { shimmer_wing: 5 };

/** mount treasures in the order chests hand them out */
export const MOUNT_TREASURES = MOUNTS.filter((m) => m.treasure && !SPECIAL_TREASURES.has(m.treasure.id)).map((m) => m.treasure!.id);

export function mountById(id: string | undefined | null): MountDef {
  return MOUNTS.find((m) => m.id === id) ?? MOUNTS[0];
}
export function mountForTreasure(tid: string): MountDef | undefined {
  return MOUNTS.find((m) => m.treasure?.id === tid);
}
export function hasTreasure(d: SaveData, tid: string) { return !!d.treasures?.includes(tid); }
export function isMountUnlocked(m: MountDef, d: SaveData): boolean {
  if (m.build) return !!d.balloonPad;
  return m.treasure === null || hasTreasure(d, m.treasure.id);
}
export function unlockedMounts(d: SaveData): MountDef[] { return MOUNTS.filter((m) => isMountUnlocked(m, d)); }

/**
 * Which mount treasure (if any) the next chest holds. The first chest is always a wearable
 * (learn the loop first); after that every 2nd chest carries the next missing mount treasure.
 */
export function nextMountTreasure(d: SaveData): string | null {
  const nextChest = d.chests + 1;
  if (nextChest < 2 || nextChest % 2 !== 0) return null;
  return MOUNT_TREASURES.find((t) => !hasTreasure(d, t)) ?? null;
}
export function addTreasure(d: SaveData, tid: string) {
  d.treasures ??= [];
  if (!d.treasures.includes(tid)) d.treasures.push(tid);
}
