/** On-device player profile for the entry screen (localStorage only). */
export type Player = { v: 1; name: string; dob: string | null; seen: boolean };

export const NAME_MAX = 16;
export const PLAYER_KEY = 'cozyIsland.player.v1';
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** Letters (any language), numbers, spaces and a little punctuation; trimmed, max 16. */
export function cleanName(raw: string): string {
  return String(raw ?? '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{M}\p{N} '\u2019.\-]/gu, '')
    .replace(/\s+/g, ' ')
    .trimStart()
    .slice(0, NAME_MAX);
}

export const finalName = (raw: string) => cleanName(raw).trim();

export const daysIn = (y: number, m: number) => new Date(y, m, 0).getDate();

export const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export function validDob(s: unknown): string | null {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m) ? s : null;
}

type StoreGet = Pick<Storage, 'getItem'>;
type StoreSet = Pick<Storage, 'setItem'>;

export function loadPlayer(store?: StoreGet | null): Player {
  const ls = store ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  try {
    const d = JSON.parse(ls?.getItem(PLAYER_KEY) || 'null');
    if (d && typeof d === 'object') {
      return { v: 1, name: finalName(String(d.name ?? '')), dob: validDob(d.dob), seen: !!d.seen };
    }
  } catch { /* storage unavailable or corrupt */ }
  return { v: 1, name: '', dob: null, seen: false };
}

export function savePlayer(p: Player, store?: StoreSet | null): void {
  const ls = store ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  try { ls?.setItem(PLAYER_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

export function ageOn(dob: string, now = new Date()): number {
  const [y, m, d] = dob.split('-').map(Number);
  let a = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) a--;
  return a;
}

export const isBirthday = (dob: string | null, now = new Date()) => {
  if (!dob) return false;
  const [, m, d] = dob.split('-').map(Number);
  return now.getMonth() + 1 === m && now.getDate() === d;
};
