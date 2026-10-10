import type { FoodId, Slot } from './Items';
import { DEFAULT_EQUIPPED, DEFAULT_OWNED } from './Items';

export interface SaveData {
  v: 1;
  food: Partial<Record<FoodId, number>>;
  shells: number;
  owned: Record<string, number>;       // wearable id -> copies ever found (>=1 owned)
  seen: string[];                      // wearable ids the player has looked at (no NEW badge)
  equipped: Partial<Record<Slot, string>>;
  dyes: string[]; dye: string;
  map: { n: number; seed: number; x: number; z: number; biome: number; state: 'none' | 'bottle' | 'active' | 'dug' | 'opened'; sincePity: number; hint: string };
  chests: number;
  builds: { x: number; z: number; t: number; r: number; y: number }[];
  friendsMade: number;
}

const KEY = 'cozyIsland.save.v1';

export function freshSave(): SaveData {
  const owned: Record<string, number> = {};
  for (const id of DEFAULT_OWNED) owned[id] = 1;
  return {
    v: 1, food: {}, shells: 0, owned, seen: [...DEFAULT_OWNED], equipped: { ...DEFAULT_EQUIPPED },
    dyes: ['coral'], dye: 'coral',
    map: { n: 0, seed: Math.floor(Math.random() * 1e9), x: 0, z: 0, biome: 0, state: 'bottle', sincePity: 0, hint: '' },
    chests: 0, builds: [], friendsMade: 0,
  };
}

export class Save {
  data: SaveData;
  private timer = 0;
  constructor() {
    let d: SaveData | null = null;
    try { d = JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { d = null; }
    const f = freshSave();
    this.data = d && d.v === 1 ? { ...f, ...d, map: { ...f.map, ...d.map } } : f;
  }
  /** debounced write */
  touch() {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.flush(), 300);
  }
  flush() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* quota / private mode */ } }
  reset() { this.data = freshSave(); this.flush(); }
}
