// Order 50: weather. A slow random cycle of clear spells and gentle showers; winter (and any snowy theme) gets
// snowfall instead of rain. `?weather=clear|rain|snow` pins it for tests. `amount` eases in/out so showers
// come and go softly; the renderer reads rain/snow (0..1) for particles and the overcast sky.
export type WeatherKind = 'clear' | 'rain' | 'snow';
/** Order 50d: seconds a rainbow can hang around after a rain shower clears */
const BOW_TIME = 90;

const parse = (v: string | null): WeatherKind | 'rainbow' | null => (v === 'clear' || v === 'rain' || v === 'snow' || v === 'rainbow' ? v : null);

export class Weather {
  /** what the sky is heading to (rain falls as snow when `snowy`) */
  kind: WeatherKind = 'clear';
  /** 0..1 eased strength of the current shower */
  amount = 0;
  frozen = false;
  source: 'cycle' | 'url' = 'cycle';
  /** theme makes showers fall as snow (winter) */
  snowy = false;
  /** what the current/last shower falls as (kept while it clears, so snow fades out as snow) */
  fall: 'rain' | 'snow' = 'rain';
  /** seconds left in the current spell */
  private left: number;
  private rnd: () => number;
  /** Order 50d: rainbow window left after a rain shower cleared, and its eased 0..1 strength (before daylight) */
  bowLeft = 0; bowK = 0;
  constructor(seed = Date.now() % 100000) {
    let s = seed >>> 0 || 1;
    this.rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    // a visit starts clear for 2-4 min so the first look at the island is sunny
    this.left = 120 + this.rnd() * 120;
    const q = typeof location !== 'undefined' ? parse(new URLSearchParams(location.search).get('weather')) : null;
    if (q === 'rainbow') { this.kind = 'clear'; this.frozen = true; this.source = 'url'; this.bowLeft = Infinity; this.bowK = 1; }
    else if (q) { this.kind = q; this.amount = q === 'clear' ? 0 : 1; this.frozen = true; this.source = 'url'; }
    this.syncFall();
  }
  private syncFall() { if (this.kind !== 'clear') this.fall = this.kind === 'snow' || this.snowy ? 'snow' : 'rain'; }
  /** pin a kind (freeze) or let the cycle run again */
  set(kind: WeatherKind, freeze = true, snap = false) { if (this.kind !== 'clear' && kind === 'clear') this.cleared(); this.kind = kind; this.frozen = freeze; if (snap) this.amount = kind === 'clear' ? 0 : 1; if (!freeze) this.source = 'cycle'; this.syncFall(); }
  update(dt: number) {
    if (!this.frozen) {
      this.left -= dt;
      if (this.left <= 0) {
        const wet = this.kind !== 'clear';
        // showers last 1.5-3 min, clear spells 3-7 min
        if (wet) this.cleared();
        this.kind = wet ? 'clear' : 'rain';
        this.left = wet ? 180 + this.rnd() * 240 : 90 + this.rnd() * 90;
      }
    }
    this.syncFall();
    // the rainbow shows once the shower has mostly thinned, then fades before its window ends
    this.bowLeft -= dt;
    const bowT = this.bowLeft > 8 && this.kind === 'clear' && this.amount < 0.55 ? 1 : 0;
    this.bowK += Math.sign(bowT - this.bowK) * Math.min(Math.abs(bowT - this.bowK), dt / 8);
    const target = this.kind === 'clear' ? 0 : 1;
    // ~12 s to build up, ~16 s to clear
    const rate = target > this.amount ? 1 / 12 : 1 / 16;
    this.amount += Math.sign(target - this.amount) * Math.min(Math.abs(target - this.amount), rate * dt);
  }
  /** a rain (not snow) shower just started clearing: open the rainbow window */
  private cleared() { if (this.fall === 'rain' && this.amount > 0.5) this.bowLeft = BOW_TIME; }
  /** falls as snow? (pinned snow, or any shower in a snowy theme) */
  get isSnow() { return this.fall === 'snow'; }
  get rain() { return this.isSnow ? 0 : this.amount; }
  get snow() { return this.isSnow ? this.amount : 0; }
  get debug() { return { kind: this.kind, amount: +this.amount.toFixed(3), rain: +this.rain.toFixed(3), snow: +this.snow.toFixed(3), frozen: this.frozen, source: this.source, snowy: this.snowy, left: Math.round(this.left), bowK: +this.bowK.toFixed(3), bowLeft: Math.round(Math.min(this.bowLeft, 9999)) }; }
}
