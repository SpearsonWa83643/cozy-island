// Data-driven mount definitions (mirrors 2D Master's src/mount/defs.ts).
// The bald eagle is free; the others unlock when their treasure turns up in a treasure chest.
import type { SaveData } from '../game/Save';

export type MountId = 'eagle' | 'pterodactyl' | 'cloud_puppy' | 'unicorn';

// no emoji fits a pterodactyl or a cloud puppy, so they get little inline SVG icons (1em, inline in text)
const svg = (inner: string) => `<svg class="mico" viewBox="0 0 40 40" aria-hidden="true">${inner}</svg>`;
const PTERO_SVG = svg('<path d="M20 21 L2 10 L7 20 L1 24 L13 25Z M20 21 L38 10 L33 20 L39 24 L27 25Z" fill="#7cc2ae" stroke="#2f6a60" stroke-width="1.6" stroke-linejoin="round"/>'
  + '<ellipse cx="20" cy="24" rx="5" ry="7.5" fill="#4f9686" stroke="#2f6a60" stroke-width="1.6"/><path d="M17 11 L8 5 L18 8Z" fill="#f08a4b" stroke="#b5592a" stroke-width="1.2" stroke-linejoin="round"/>'
  + '<circle cx="20" cy="13" r="4.8" fill="#4f9686" stroke="#2f6a60" stroke-width="1.6"/><path d="M23 12 L34 15.5 L23 16Z" fill="#f2c77a" stroke="#b07f45" stroke-width="1.2" stroke-linejoin="round"/><circle cx="21" cy="12" r="1.3" fill="#2a1a12"/>');
const SHOE_SVG = svg('<path d="M6.0 35 V19 A14.0 14.0 0 0 1 34.0 19 V35" fill="none" stroke="#ff6f7d" stroke-width="2.6" stroke-linecap="round"/><path d="M8.4 35 V19 A11.6 11.6 0 0 1 31.6 19 V35" fill="none" stroke="#ffa64d" stroke-width="2.6" stroke-linecap="round"/><path d="M10.8 35 V19 A9.2 9.2 0 0 1 29.2 19 V35" fill="none" stroke="#ffd84d" stroke-width="2.6" stroke-linecap="round"/><path d="M13.2 35 V19 A6.8 6.8 0 0 1 26.8 19 V35" fill="none" stroke="#7fd67a" stroke-width="2.6" stroke-linecap="round"/><path d="M34 3 L35.2 6 L38 7 L35.2 8 L34 11 L32.8 8 L30 7 L32.8 6Z" fill="#fff6b0" stroke="#e0b13a" stroke-width="1"/>');
const PUPPY_SVG = svg('<g fill="#fff" stroke="#9cc3e6" stroke-width="2"><circle cx="11" cy="26" r="7.5"/><circle cx="29" cy="26" r="7.5"/><circle cx="20" cy="27" r="8"/><circle cx="20" cy="17" r="10"/></g>'
  + '<ellipse cx="10.5" cy="17" rx="3.4" ry="6" fill="#c7dcf3" transform="rotate(20 10.5 17)"/><ellipse cx="29.5" cy="17" rx="3.4" ry="6" fill="#c7dcf3" transform="rotate(-20 29.5 17)"/>'
  + '<circle cx="16.5" cy="16" r="1.8" fill="#2a2230"/><circle cx="23.5" cy="16" r="1.8" fill="#2a2230"/><ellipse cx="20" cy="20" rx="2.3" ry="1.6" fill="#2a2230"/><ellipse cx="20.6" cy="23.6" rx="1.5" ry="2" fill="#ff8fa6"/>');

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
];

/** mount treasures in the order chests hand them out */
export const MOUNT_TREASURES = MOUNTS.filter((m) => m.treasure).map((m) => m.treasure!.id);

export function mountById(id: string | undefined | null): MountDef {
  return MOUNTS.find((m) => m.id === id) ?? MOUNTS[0];
}
export function mountForTreasure(tid: string): MountDef | undefined {
  return MOUNTS.find((m) => m.treasure?.id === tid);
}
export function hasTreasure(d: SaveData, tid: string) { return !!d.treasures?.includes(tid); }
export function isMountUnlocked(m: MountDef, d: SaveData): boolean {
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
