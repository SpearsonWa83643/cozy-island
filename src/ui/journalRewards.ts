/**
 * Journal page completion helpers (Order 52c).
 * Kept out of Journal.ts so the journal overlay stays a lazy chunk —
 * Gameplay only needs these small checks on the critical path.
 */
import { FISH } from '../game/FishDefs';
import { TASTES, type Species } from '../game/Items';
import type { SaveData } from '../game/Save';
import { MOUNTS, type MountTreasure } from '../player/MountDefs';

export type JournalPage = 'fish' | 'creatures' | 'treasures';

const SPECIES = Object.keys(TASTES) as Species[];
const TREASURES: MountTreasure[] = MOUNTS.filter((m) => m.treasure).map((m) => m.treasure!);

/** Order 52c: one cosmetic per finished journal page */
export const JOURNAL_REWARDS: Record<JournalPage, { wear: string; title: string; blurb: string }> = {
  fish: { wear: 'angler', title: 'Fish page complete!', blurb: 'Every fish is in your journal.' },
  creatures: { wear: 'buddybadge', title: 'Friends page complete!', blurb: 'Every animal species befriended.' },
  treasures: { wear: 'collector', title: 'Treasures page complete!', blurb: 'Every mount treasure found.' },
};

export function pageKnown(page: JournalPage, d: SaveData): { known: number; total: number } {
  if (page === 'fish') {
    const known = FISH.filter((f) => (d.fish?.[f.id]?.n ?? 0) > 0).length;
    return { known, total: FISH.length };
  }
  if (page === 'creatures') {
    const known = SPECIES.filter((sp) => Object.values(d.pets ?? {}).some((p) => p.sp === sp)).length;
    return { known, total: SPECIES.length };
  }
  const known = TREASURES.filter((t) => d.treasures?.includes(t.id)).length;
  return { known, total: TREASURES.length };
}

export function pageComplete(page: JournalPage, d: SaveData): boolean {
  const { known, total } = pageKnown(page, d);
  return total > 0 && known >= total;
}

export function pageClaimed(page: JournalPage, d: SaveData): boolean {
  return !!(d.journalReward?.[page]);
}

/** first unfinished claim, if any */
export function nextJournalReward(d: SaveData): JournalPage | null {
  for (const page of ['fish', 'creatures', 'treasures'] as JournalPage[]) {
    if (pageComplete(page, d) && !pageClaimed(page, d)) return page;
  }
  return null;
}
