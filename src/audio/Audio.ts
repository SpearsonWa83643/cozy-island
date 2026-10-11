import { Biome } from '../world/Biomes';
import type { Surface } from '../world/Terrain';
import { MusicGen } from './Music';
/** finite-or-fallback for AudioParam writes (a NaN throws in WebAudio) */
const F = (v: number, fb: number) => (Number.isFinite(v) ? v : fb);

export interface AudioSettings { muted: boolean; music: number; ambience: number; }
const KEY = 'cozyIsland.audio.v1';

/** What the game tells the audio engine about the listener each frame. */
export interface Listen {
  biome: Float32Array;     // biome weights at the player
  shoreDist: number;       // metres to nearest open water
  shorePan: number;        // -1 left .. 1 right (camera relative)
  forest: number;          // 0..1 tree density nearby
  grass: number;           // 0..1 grassiness
  altitude: number;        // player height
  swim?: number;           // 0..1 swimming
  reef?: number;           // 0..1 over the reef
  cave?: number;           // 0..1 underground
}

type Ctx = AudioContext;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pickW = <T,>(items: [T, number][]): T => { let s = 0; for (const [, w] of items) s += w; let r = Math.random() * s; for (const [it, w] of items) { if ((r -= w) <= 0) return it; } return items[0][0]; };

/**
 * Fully procedural Web Audio: generative music, biome ambience beds that
 * crossfade with the player's position, spatial ocean, event sounds
 * (birds, crickets, frogs, gulls), footsteps per surface, and build SFX.
 * Starts on the first user gesture (iOS Safari unlock).
 */
/** clamp a pan to [-1,1]; NaN (sound exactly at the listener) → centre */
const fin = (v: number) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);

export class AudioEngine {
  ctx: Ctx | null = null;
  settings: AudioSettings = { muted: false, music: 0.55, ambience: 0.75 };
  private master!: GainNode; private musicBus!: GainNode; private ambBus!: GainNode; private sfxBus!: GainNode;
  private reverb!: ConvolverNode; private reverbIn!: GainNode;
  private white!: AudioBuffer; private pink!: AudioBuffer; private brown!: AudioBuffer;
  private beds: Record<string, { gain: GainNode; pan?: StereoPannerNode; filter?: BiquadFilterNode; filter2?: BiquadFilterNode; level: number }> = {};
  private music: MusicGen | null = null;
  private analyser: AnalyserNode | null = null;
  private timer = 0;
  private listen: Listen | null = null;
  private eventClock = 0;
  private swell = 0;
  onUnlock: () => void = () => {};

  constructor() {
    try { const s = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (s) this.settings = { ...this.settings, ...s }; } catch { /* ignore */ }
    const unlock = () => this.unlock();
    for (const ev of ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click']) window.addEventListener(ev, unlock, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend(); else this.ctx.resume();
    });
  }

  get started() { return !!this.ctx && this.ctx.state === 'running'; }

  save() { try { localStorage.setItem(KEY, JSON.stringify(this.settings)); } catch { /* ignore */ } this.applyVolumes(); }

  private applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.settings.muted ? 0 : 0.9, t, 0.08);
    this.musicBus.gain.setTargetAtTime(this.settings.music * this.settings.music * 2.2, t, 0.1);
    this.ambBus.gain.setTargetAtTime(this.settings.ambience * this.settings.ambience * 1.25, t, 0.1);
    this.sfxBus.gain.setTargetAtTime(0.35 + this.settings.ambience * 0.65, t, 0.1);
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state !== 'running') this.ctx.resume(); return; }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC({ latencyHint: 'playback' });
    this.ctx = ctx;
    // iOS: play a silent buffer inside the gesture
    const sil = ctx.createBufferSource(); sil.buffer = ctx.createBuffer(1, 1, 22050); sil.connect(ctx.destination); sil.start(0);
    ctx.resume();
    this.build(ctx);
    this.applyVolumes();
    this.timer = window.setInterval(() => this.tick(), 100);
    this.onUnlock();
  }

  // ---------------- graph ----------------
  private build(ctx: Ctx) {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3; comp.attack.value = 0.02; comp.release.value = 0.4;
    this.master = ctx.createGain(); this.master.gain.value = 0;
    this.master.connect(comp).connect(ctx.destination);
    this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 1024; comp.connect(this.analyser);
    this.musicBus = ctx.createGain(); this.ambBus = ctx.createGain(); this.sfxBus = ctx.createGain();
    this.musicBus.connect(this.master); this.ambBus.connect(this.master); this.sfxBus.connect(this.master);
    this.reverb = ctx.createConvolver(); this.reverb.buffer = this.impulse(ctx, 3.4, 2.6);
    this.reverbIn = ctx.createGain(); this.reverbIn.gain.value = 1;
    const revOut = ctx.createGain(); revOut.gain.value = 0.55;
    this.reverbIn.connect(this.reverb).connect(revOut).connect(this.master);
    this.white = this.noise(ctx, 'white'); this.pink = this.noise(ctx, 'pink'); this.brown = this.noise(ctx, 'brown');

    // ambience beds
    this.bed('ocean', this.brown, [['lowpass', 520, 0.6]], true);
    this.bed('wash', this.white, [['bandpass', 1400, 0.4], ['lowpass', 3500, 0.5]], true);
    this.bed('wind', this.pink, [['bandpass', 600, 0.7]]);
    this.bed('howl', this.pink, [['bandpass', 520, 7], ['lowpass', 1400, 0.5]]);
    this.bed('rustle', this.white, [['highpass', 2800, 0.5], ['lowpass', 7000, 0.5]]);
    this.bed('cicada', this.white, [['bandpass', 5200, 9]]);
    this.bed('marsh', this.brown, [['lowpass', 260, 0.8]]);
    // cave: a deep earthy rumble and a faint hollow air tone
    this.bed('cave', this.brown, [['lowpass', 150, 0.7]]);
    this.bed('hollow', this.pink, [['bandpass', 520, 6]]);
    // reef: a soft, bubbly undertow with a shimmering top
    this.bed('reef', this.pink, [['bandpass', 380, 0.9], ['lowpass', 900, 0.6]]);
    this.bed('fizz', this.white, [['bandpass', 3800, 3]]);
    // cicada amplitude modulation
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 34;
    const depth = ctx.createGain(); depth.gain.value = 0.5; lfo.connect(depth);
    const am = ctx.createGain(); am.gain.value = 0.5; depth.connect(am.gain);
    const cic = this.beds.cicada; cic.filter2 = undefined;
    cic.gain.disconnect(); cic.gain.connect(am).connect(this.ambBus); lfo.start();

    this.music = new MusicGen(ctx, this.musicBus, this.reverbIn);
  }

  private bed(name: string, buf: AudioBuffer, filters: [BiquadFilterType, number, number][], panned = false) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    src.loopStart = 0; src.start(0, Math.random() * buf.duration);
    let node: AudioNode = src;
    const fs: BiquadFilterNode[] = [];
    for (const [type, f, q] of filters) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = F(f, 1000); b.Q.value = F(q, 1); node.connect(b); node = b; fs.push(b); }
    const gain = ctx.createGain(); gain.gain.value = 0; node.connect(gain);
    let pan: StereoPannerNode | undefined;
    if (panned && ctx.createStereoPanner) { pan = ctx.createStereoPanner(); gain.connect(pan).connect(this.ambBus); }
    else gain.connect(this.ambBus);
    this.beds[name] = { gain, pan, filter: fs[0], filter2: fs[1], level: 0 };
  }

  private noise(ctx: Ctx, kind: 'white' | 'pink' | 'brown') {
    const len = ctx.sampleRate * 6;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'white') d[i] = w * 0.5;
        else if (kind === 'pink') {
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
        } else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      }
      // crossfade the loop seam
      const f = Math.floor(ctx.sampleRate * 0.05);
      for (let i = 0; i < f; i++) { const a = i / f; d[i] = d[i] * a + d[len - f + i] * (1 - a); }
    }
    return buf;
  }

  private impulse(ctx: Ctx, seconds: number, decay: number) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay) * (i < 200 ? i / 200 : 1);
    }
    return buf;
  }

  // ---------------- per-frame listener update ----------------
  update(l: Listen) { this.listen = l; }

  private outdoor = 1;
  private caveAmt = 0;
  private setBed(name: string, level: number, tc = 0.6) {
    const b = this.beds[name]; if (!b) return;
    if (name !== 'cave' && name !== 'hollow') level *= this.outdoor;
    b.level = level;
    b.gain.gain.setTargetAtTime(level, this.ctx!.currentTime, tc);
  }

  private tick() {
    const ctx = this.ctx, l = this.listen;
    if (!ctx || ctx.state !== 'running' || !l) return;
    const t = ctx.currentTime, w = l.biome;
    this.music?.tick(w);
    // underground: the island fades away, the cave hums, drips echo
    const cv = l.cave ?? 0; this.caveAmt = cv; this.outdoor = 1 - cv;
    this.setBed('cave', cv * 0.17 * (0.85 + 0.15 * Math.sin(t * 0.3)), 0.8);
    this.setBed('hollow', cv * 0.025 * (0.6 + 0.4 * Math.sin(t * 0.17)), 1.2);
    if (Math.random() < cv * 0.07) this.drip();

    // ocean: louder near shore, swelling waves, panned towards the water
    this.swell += 0.1;
    const sw = 0.55 + 0.45 * Math.sin(this.swell * 0.85) * Math.sin(this.swell * 0.31 + 1);
    const near = Math.max(0, 1 - l.shoreDist / 34);
    const ocean = 0.04 + near * near * 0.9;
    this.setBed('ocean', ocean * (0.55 + sw * 0.6), 0.35);
    this.setBed('wash', ocean * Math.max(0, sw - 0.55) * 1.4, 0.25);
    this.beds.ocean.filter!.frequency.setTargetAtTime(380 + sw * 420, t, 0.4);
    for (const n of ['ocean', 'wash']) this.beds[n].pan?.pan.setTargetAtTime(l.shorePan * 0.75, t, 0.3);

    // wind in grass; high alpine howl
    const gust = 0.6 + 0.4 * Math.sin(t * 0.37) * Math.sin(t * 0.13 + 2);
    const alt = Math.min(1, Math.max(0, (l.altitude - 3) / 8));
    this.setBed('wind', (0.05 + l.grass * 0.16 + alt * 0.12) * gust * (1 - (l.swim ?? 0) * 0.6), 0.5);
    this.beds.wind.filter!.frequency.setTargetAtTime(420 + gust * 500, t, 0.6);
    this.setBed('howl', w[Biome.Alpine] * (0.04 + alt * 0.2) * gust, 0.7);
    this.beds.howl.filter!.frequency.setTargetAtTime(380 + Math.sin(t * 0.21) * 160 + alt * 200, t, 0.8);
    this.setBed('rustle', (l.forest * 0.05 + w[Biome.Autumn] * 0.07) * Math.max(0, gust - 0.35), 0.3);
    this.setBed('cicada', w[Biome.Desert] * 0.05 * (0.6 + 0.4 * Math.sin(t * 0.2)), 1.2);
    this.setBed('marsh', w[Biome.Marsh] * 0.12, 1);
    // swimming: the surf muffles, the reef hums and fizzes, the odd bubble rises
    const swim = l.swim ?? 0, reef = l.reef ?? 0;
    this.setBed('reef', swim * (0.08 + reef * 0.16) * (0.8 + 0.2 * Math.sin(t * 0.5)), 0.6);
    this.setBed('fizz', swim * reef * 0.035 * (0.6 + 0.4 * Math.sin(t * 1.3)), 0.4);
    if (swim > 0.6 && Math.random() < 0.05 + reef * 0.1) this.bubble(reef);

    // discrete critters
    this.eventClock += 0.1;
    const birdRate = (0.12 + l.forest * 0.5) * (w[Biome.Meadow] + w[Biome.Autumn] + w[Biome.Tropical] * 1.1 + w[Biome.Marsh] * 0.6 + w[Biome.Alpine] * 0.25);
    if (Math.random() < this.outdoor) {
    if (Math.random() < birdRate * 0.12) this.bird(w);
    if (Math.random() < near * 0.012) this.gull();
    const cricket = w[Biome.Meadow] * 0.5 + w[Biome.Marsh] * 0.6 + w[Biome.Desert] * 0.4 + w[Biome.Tropical] * 0.3;
    if (Math.random() < cricket * 0.09) this.cricket();
    if (Math.random() < w[Biome.Marsh] * 0.07) this.frog();
    if (Math.random() < w[Biome.Autumn] * 0.012) this.woodpecker();
    }
  }

  /** a single echoing water drip in the cave */
  private drip() {
    const t = this.go(); if (t < 0) return;
    const o = this.tone('sine', 1500 + Math.random() * 900, t, 0.09, this.sfx((Math.random() - 0.5) * 1.6, 0.22 + Math.random() * 0.15, 0.9), 0.3, 0.001);
    o.frequency.exponentialRampToValueAtTime(420 + Math.random() * 200, t + 0.06);
  }
  /** stepping into / out of the cave: a hollow whoosh */
  cave(enter: boolean) {
    const t = this.go(); if (t < 0) return;
    const f = this.noiseHit(t, 0.7, this.sfx(0, 0.7, 0.8), 'bandpass', enter ? 1400 : 300, 1.5, 0.12, 0.15, this.pink);
    f.frequency.exponentialRampToValueAtTime(enter ? 260 : 1600, t + 0.6);
  }

  // ---------------- voices ----------------
  private out(pan: number, gain: number, wet = 0.25) {
    const ctx = this.ctx!;
    const g = ctx.createGain(); g.gain.value = Number.isFinite(gain) ? gain : 0;
    let last: AudioNode = g;
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = fin(pan); g.connect(p); last = p; }
    last.connect(this.ambBus);
    // in the cave everything echoes
    const w2 = Math.min(1.2, wet + this.caveAmt * 0.35) * (1 + this.caveAmt);
    if (w2 > 0) { const s = ctx.createGain(); s.gain.value = Number.isFinite(w2) ? w2 : 0; last.connect(s).connect(this.reverbIn); }
    return g;
  }
  private env(g: AudioParam, t: number, a: number, peak: number, d: number) {
    g.setValueAtTime(0.0001, t); g.exponentialRampToValueAtTime(peak, t + a); g.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  private tone(type: OscillatorType, f: number, t: number, dur: number, dest: AudioNode, peak = 0.3, a = 0.005) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
    const g = ctx.createGain(); this.env(g.gain, t, a, peak, dur);
    o.connect(g).connect(dest); o.start(t); o.stop(t + a + dur + 0.05);
    return o;
  }
  private noiseHit(t: number, dur: number, dest: AudioNode, type: BiquadFilterType, f: number, q: number, peak: number, a = 0.004, buf = this.white) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource(); s.buffer = buf;
    const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = F(f, 1000); b.Q.value = F(q, 1);
    const g = ctx.createGain(); this.env(g.gain, t, a, peak, dur);
    s.connect(b).connect(g).connect(dest); s.start(t, Math.random() * 4, a + dur + 0.05);
    return b;
  }

  private bird(w: Float32Array) {
    const ctx = this.ctx!, t = ctx.currentTime + 0.05;
    const dist = rand(0.25, 1);
    const dest = this.out(rand(-0.9, 0.9), 0.11 * dist, 0.35);
    const species = pickW<string>([['tweet', 1], ['trill', 0.6 + w[Biome.Meadow]], ['cuckoo', w[Biome.Autumn] * 1.2 + w[Biome.Alpine] * 0.6], ['whistle', w[Biome.Tropical] * 1.5], ['warble', 0.5]]);
    const base = rand(2200, 4200);
    if (species === 'tweet') {
      const n = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) {
        const o = this.tone('sine', base, t + i * 0.14, 0.08, dest, 0.5, 0.008);
        o.frequency.exponentialRampToValueAtTime(base * rand(1.2, 1.5), t + i * 0.14 + 0.07);
      }
    } else if (species === 'trill') {
      const o = this.tone('sine', base, t, 0.6, dest, 0.4, 0.02);
      const lfo = ctx.createOscillator(); lfo.frequency.value = rand(18, 30);
      const d = ctx.createGain(); d.gain.value = F(base * 0.12, 0); lfo.connect(d).connect(o.frequency);
      lfo.start(t); lfo.stop(t + 0.7);
      o.frequency.linearRampToValueAtTime(base * 0.8, t + 0.6);
    } else if (species === 'cuckoo') {
      const f = rand(620, 760);
      this.tone('sine', f, t, 0.3, dest, 0.5, 0.03);
      this.tone('sine', f * 0.8, t + 0.38, 0.4, dest, 0.45, 0.03);
    } else if (species === 'whistle') {
      const o = this.tone('sine', 1400, t, 0.35, dest, 0.45, 0.02);
      o.frequency.exponentialRampToValueAtTime(2600, t + 0.15); o.frequency.exponentialRampToValueAtTime(1300, t + 0.35);
      const o2 = this.tone('sine', 1500, t + 0.45, 0.4, dest, 0.4, 0.02);
      o2.frequency.exponentialRampToValueAtTime(2400, t + 0.6); o2.frequency.exponentialRampToValueAtTime(900, t + 0.85);
    } else {
      const n = 5 + Math.floor(Math.random() * 6);
      for (let i = 0; i < n; i++) {
        const f = base * Math.pow(2, rand(-0.4, 0.5));
        const o = this.tone('triangle', f, t + i * 0.07, 0.05, dest, 0.25, 0.005);
        o.frequency.exponentialRampToValueAtTime(f * rand(0.8, 1.3), t + i * 0.07 + 0.05);
      }
    }
  }
  private gull() {
    const ctx = this.ctx!, t = ctx.currentTime + 0.05;
    const dest = this.out(this.listen?.shorePan ?? 0, 0.05, 0.45);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1600; bp.Q.value = 3; bp.connect(dest);
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const o = this.tone('sawtooth', 1100, t + i * 0.32, 0.25, bp, 0.5, 0.03);
      o.frequency.exponentialRampToValueAtTime(1500, t + i * 0.32 + 0.08); o.frequency.exponentialRampToValueAtTime(800, t + i * 0.32 + 0.27);
    }
  }
  private cricket() {
    const ctx = this.ctx!, t = ctx.currentTime + 0.05;
    const dest = this.out(rand(-1, 1), rand(0.015, 0.04), 0.15);
    const f = rand(4200, 5200), reps = 2 + Math.floor(Math.random() * 3);
    for (let r = 0; r < reps; r++) for (let i = 0; i < 4; i++) this.tone('sine', f, t + r * 0.32 + i * 0.035, 0.02, dest, 0.6, 0.004);
  }
  private frog() {
    const ctx = this.ctx!, t = ctx.currentTime + 0.05;
    const dest = this.out(rand(-0.9, 0.9), rand(0.04, 0.09), 0.2);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; lp.Q.value = 6; lp.connect(dest);
    const f = rand(150, 260);
    for (let i = 0; i < 2; i++) {
      const o = this.tone('square', f, t + i * 0.16, 0.1, lp, 0.6, 0.01);
      o.frequency.exponentialRampToValueAtTime(f * 0.7, t + i * 0.16 + 0.1);
    }
  }
  private woodpecker() {
    const ctx = this.ctx!, t = ctx.currentTime + 0.05;
    const dest = this.out(rand(-1, 1), 0.06, 0.4);
    const n = 8 + Math.floor(Math.random() * 8);
    for (let i = 0; i < n; i++) this.noiseHit(t + i * 0.055, 0.03, dest, 'bandpass', 1100, 4, 0.8);
  }

  // ---------------- gameplay SFX ----------------
  private sfx(pan = 0, gain = 0.5, wet = 0.08) {
    const ctx = this.ctx!;
    const g = ctx.createGain(); g.gain.value = Number.isFinite(gain) ? gain : 0;
    let last: AudioNode = g;
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = fin(pan); g.connect(p); last = p; }
    last.connect(this.sfxBus);
    if (wet > 0) { const s = ctx.createGain(); s.gain.value = Number.isFinite(wet) ? wet : 0; last.connect(s).connect(this.reverbIn); }
    return g;
  }

  footstep(surface: Surface, strength = 1) {
    if (!this.started) return;
    const ctx = this.ctx!, t = ctx.currentTime + 0.01, v = 0.5 * strength * rand(0.8, 1.1);
    const d = this.sfx(rand(-0.08, 0.08), 1, 0.04);
    switch (surface) {
      case 'sand': this.noiseHit(t, 0.13, d, 'lowpass', rand(900, 1400), 0.7, 0.16 * v, 0.02, this.pink); break;
      case 'grass': this.noiseHit(t, 0.07, d, 'highpass', rand(2200, 3200), 0.6, 0.07 * v, 0.008);
        this.noiseHit(t, 0.05, d, 'lowpass', 500, 0.7, 0.07 * v, 0.005, this.pink); break;
      case 'leaves': for (let i = 0; i < 4; i++) this.noiseHit(t + i * rand(0.01, 0.025), 0.03, d, 'bandpass', rand(2500, 5000), 1.5, 0.1 * v, 0.002); break;
      case 'snow': for (let i = 0; i < 6; i++) this.noiseHit(t + i * rand(0.012, 0.022), 0.025, d, 'bandpass', rand(1500, 3200), 2.5, 0.12 * v, 0.002);
        this.noiseHit(t, 0.12, d, 'lowpass', 600, 0.6, 0.12 * v, 0.02, this.pink); break;
      case 'rock': this.noiseHit(t, 0.04, d, 'bandpass', rand(1800, 2600), 2, 0.14 * v, 0.002);
        this.tone('sine', rand(140, 180), t, 0.05, d, 0.12 * v, 0.002); break;
      case 'wood': { const o = this.tone('triangle', rand(190, 230), t, 0.09, d, 0.22 * v, 0.002); o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
        this.noiseHit(t, 0.03, d, 'bandpass', 1200, 2, 0.08 * v, 0.002); break; }
      case 'mud': { const b = this.noiseHit(t, 0.12, d, 'bandpass', 500, 3, 0.16 * v, 0.01, this.pink); b.frequency.exponentialRampToValueAtTime(260, t + 0.12); break; }
      case 'water': { const b = this.noiseHit(t, 0.18, d, 'bandpass', 900, 1.2, 0.18 * v, 0.01); b.frequency.exponentialRampToValueAtTime(2400, t + 0.15); break; }
    }
  }

  jump() { if (!this.started) return; const t = this.ctx!.currentTime; const b = this.noiseHit(t, 0.16, this.sfx(0, 1, 0), 'bandpass', 600, 1.2, 0.07, 0.02, this.pink); b.frequency.exponentialRampToValueAtTime(1800, t + 0.16); }
  land(surface: Surface, impact: number) { this.footstep(surface, 1 + Math.min(1.5, impact * 0.12)); }

  place(note = 0) {
    if (!this.started) return;
    const ctx = this.ctx!, t = ctx.currentTime + 0.01, d = this.sfx(0, 0.9, 0.2);
    const o = this.tone('sine', 320, t, 0.18, d, 0.35, 0.003); o.frequency.exponentialRampToValueAtTime(110, t + 0.15);
    this.noiseHit(t, 0.05, d, 'bandpass', 1600, 1.5, 0.12, 0.002);
    const f = this.music?.chimeFreq(note) ?? 880;
    this.tone('sine', f, t + 0.05, 0.9, d, 0.09, 0.004); this.tone('sine', f * 2.76, t + 0.05, 0.4, d, 0.025, 0.004);
  }
  remove() {
    if (!this.started) return;
    const ctx = this.ctx!, t = ctx.currentTime + 0.01, d = this.sfx(0, 0.9, 0.2);
    const b = this.noiseHit(t, 0.28, d, 'bandpass', 2400, 1.4, 0.13, 0.03, this.pink); b.frequency.exponentialRampToValueAtTime(400, t + 0.28);
    const o = this.tone('sine', 520, t, 0.22, d, 0.12, 0.01); o.frequency.exponentialRampToValueAtTime(180, t + 0.2);
  }
  splash(pan: number, gain: number, big: boolean) {
    if (!this.started || gain < 0.02) return;
    const ctx = this.ctx!, t = ctx.currentTime + 0.01, d = this.sfx(pan, gain, 0.3);
    const b = this.noiseHit(t, big ? 0.35 : 0.2, d, 'bandpass', 700, 1, 0.3, 0.005); b.frequency.exponentialRampToValueAtTime(2600, t + 0.2);
    if (big) for (let i = 0; i < 4; i++) this.tone('sine', rand(900, 1800), t + 0.12 + i * rand(0.03, 0.07), 0.05, d, 0.05, 0.003);
  }
  /** one swim stroke: a soft watery push */
  stroke(mov: number) {
    if (!this.started) return;
    const t = this.ctx!.currentTime + 0.01, d = this.sfx(rand(-0.2, 0.2), 0.18 + mov * 0.25, 0.25);
    const b = this.noiseHit(t, 0.32, d, 'bandpass', rand(500, 700), 0.9, 0.22, 0.06); b.frequency.exponentialRampToValueAtTime(rand(1400, 1900), t + 0.28);
  }
  /** little rising bubble blip */
  private bubble(reef: number) {
    const t = this.ctx!.currentTime + rand(0, 0.2), d = this.sfx(rand(-0.6, 0.6), 0.25, 0.35);
    const o = this.tone('sine', rand(380, 700), t, 0.09, d, 0.03 + reef * 0.03, 0.004); o.frequency.exponentialRampToValueAtTime(rand(1200, 2200), t + 0.08);
  }
  // ---------- gameplay juice ----------
  private go() { return this.started ? this.ctx!.currentTime + 0.005 : -1; }
  /** soft pluck when picking up food */
  pick() { const t = this.go(); if (t < 0) return; const d = this.sfx(0, 0.8, 0.15); const f = 660 * Math.pow(2, Math.floor(Math.random() * 3) * 2 / 12);
    const o = this.tone('triangle', f, t, 0.18, d, 0.14, 0.003); o.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.06); this.tone('sine', f * 2, t + 0.05, 0.2, d, 0.06); }
  /** munch + rising heart chime */
  feed(friend: boolean) { const t = this.go(); if (t < 0) return; const d = this.sfx(0, 0.9, 0.25);
    for (let i = 0; i < 3; i++) this.noiseHit(t + i * 0.09, 0.05, d, 'bandpass', 1200 + i * 200, 2, 0.08, 0.003, this.pink);
    const notes = friend ? [0, 4, 7, 12] : [0, 4]; notes.forEach((n, i) => this.tone('sine', 784 * Math.pow(2, n / 12), t + 0.3 + i * 0.09, 0.5, d, 0.09, 0.005)); }
  /** shovel scrape + thud */
  dig() { const t = this.go(); if (t < 0) return; const d = this.sfx(0, 1, 0.12);
    const b = this.noiseHit(t, 0.16, d, 'bandpass', 1400, 1.5, 0.12, 0.01); b.frequency.exponentialRampToValueAtTime(500, t + 0.15);
    const o = this.tone('sine', 120, t + 0.12, 0.2, d, 0.3, 0.004); o.frequency.exponentialRampToValueAtTime(60, t + 0.3); }
  /** wooden creak + magical arpeggio on chest open */
  chest(rarity: number) { const t = this.go(); if (t < 0) return; const d = this.sfx(0, 1, 0.45);
    const o = this.tone('sawtooth', 160, t, 0.25, this.sfx(0, 0.25, 0.1), 0.05, 0.02); o.frequency.exponentialRampToValueAtTime(320, t + 0.22);
    const scale = [0, 4, 7, 11, 12, 16, 19, 24];
    const n = Math.min(scale.length, 4 + Math.max(0, rarity | 0)); for (let i = 0; i < n; i++) { this.tone('triangle', 523.25 * Math.pow(2, scale[i] / 12), t + 0.25 + i * 0.075, 0.9, d, 0.1, 0.004); this.tone('sine', 1046.5 * Math.pow(2, scale[i] / 12), t + 0.27 + i * 0.075, 0.6, d, 0.03); }
    this.noiseHit(t + 0.25, 1.2, d, 'highpass', 6000, 0.5, 0.025, 0.05); }
  /** warmer/colder ping: closeness 0..1 */
  warm(closeness: number) { const t = this.go(); if (t < 0) return; const d = this.sfx(0, 0.5, 0.5);
    const f = 440 * Math.pow(2, Math.round(closeness * 12) / 12); this.tone('sine', f, t, 0.5, d, 0.05 + closeness * 0.05, 0.01); this.tone('sine', f * 1.5, t + 0.06, 0.4, d, 0.02 + closeness * 0.03, 0.01); }
  /** paper rustle for the map */
  paper() { const t = this.go(); if (t < 0) return; const d = this.sfx(0, 0.7, 0.1); for (let i = 0; i < 5; i++) this.noiseHit(t + i * 0.035, 0.05, d, 'bandpass', 2500 + Math.random() * 2500, 1, 0.05, 0.004); }
  /** little bubbly pop (equip, sheet) */
  pop(pitch = 1) { const t = this.go(); if (t < 0) return; const o = this.tone('sine', 520 * pitch, t, 0.12, this.sfx(0, 0.6, 0.1), 0.12, 0.002); o.frequency.exponentialRampToValueAtTime(980 * pitch, t + 0.08); }
  // ---------- friend close-up ----------
  /** soft purr / happy hum, call repeatedly while petting (amount 0..1) */
  purr(amount: number) {
    const t = this.go(); if (t < 0) return;
    const d = this.sfx(0, 0.18 + amount * 0.25, 0.05);
    const lp = this.ctx!.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.connect(d);
    for (let i = 0; i < 3; i++) this.noiseHit(t + i * 0.11, 0.09, lp, 'lowpass', 180 + Math.random() * 60, 1.2, 0.6, 0.03, this.brown);
    this.tone('sine', 92 + Math.random() * 8, t, 0.3, lp, 0.08, 0.06);
  }
  /** tickled giggle: quick bouncy rising chirps */
  giggle(pitch = 1) {
    const t = this.go(); if (t < 0) return;
    const d = this.sfx(0, 0.5, 0.15);
    for (let i = 0; i < 4; i++) { const f = (900 + i * 90 + Math.random() * 60) * pitch; const o = this.tone('triangle', f, t + i * 0.085, 0.06, d, 0.18, 0.004); o.frequency.exponentialRampToValueAtTime(f * 1.35, t + i * 0.085 + 0.05); }
  }
  chomp() {
    const t = this.go(); if (t < 0) return;
    const d = this.sfx(0, 0.8, 0.06);
    for (let i = 0; i < 3; i++) this.noiseHit(t + i * 0.16, 0.06, d, 'bandpass', 900 + Math.random() * 500, 2, 0.5, 0.003, this.pink);
  }
  /** "nuh-uh": two low falling boops */
  dislike() {
    const t = this.go(); if (t < 0) return;
    const d = this.sfx(0, 0.5, 0.1);
    for (let i = 0; i < 2; i++) { const o = this.tone('triangle', 330 - i * 40, t + i * 0.16, 0.12, d, 0.16, 0.01); o.frequency.exponentialRampToValueAtTime(240 - i * 30, t + i * 0.16 + 0.11); }
  }
  /** scrub: a short foamy brush burst */
  scrub() { const t = this.go(); if (t < 0) return; this.noiseHit(t, 0.12, this.sfx((Math.random() - 0.5) * 0.4, 0.35, 0.08), 'bandpass', 2600 + Math.random() * 1600, 1.4, 0.4, 0.02, this.white); }
  /** a wet shake-off: fluttery noise sweep */
  shake() {
    const t = this.go(); if (t < 0) return;
    const d = this.sfx(0, 0.6, 0.2);
    for (let i = 0; i < 7; i++) this.noiseHit(t + i * 0.05, 0.05, d, 'bandpass', 1500 + (i % 2) * 900, 2, 0.4, 0.004, this.pink);
    this.pop(1.6);
  }
  /** species voice */
  voice(species: string) {
    const t = this.go(); if (t < 0) return;
    const d = this.sfx(0, 0.55, 0.15);
    if (species === 'duck') {
      const bp = this.ctx!.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 2; bp.connect(d);
      for (let i = 0; i < 2; i++) { const o = this.tone('sawtooth', 420, t + i * 0.2, 0.13, bp, 0.35, 0.01); o.frequency.exponentialRampToValueAtTime(330, t + i * 0.2 + 0.12); }
    } else if (species === 'bird') {
      for (let i = 0; i < 3; i++) { const o = this.tone('sine', 2600, t + i * 0.1, 0.06, d, 0.25, 0.006); o.frequency.exponentialRampToValueAtTime(3600, t + i * 0.1 + 0.05); }
    } else if (species === 'crab') {
      for (let i = 0; i < 4; i++) this.noiseHit(t + i * 0.07, 0.02, d, 'bandpass', 3200, 6, 0.8, 0.001);
    } else if (species === 'deer') {
      const o = this.tone('triangle', 520, t, 0.28, d, 0.15, 0.03); o.frequency.exponentialRampToValueAtTime(700, t + 0.12); o.frequency.exponentialRampToValueAtTime(480, t + 0.28);
    } else {
      // bunny: tiny sniff-squeak
      for (let i = 0; i < 3; i++) this.noiseHit(t + i * 0.06, 0.03, d, 'highpass', 3000, 1, 0.25, 0.003);
      const o = this.tone('sine', 1500, t + 0.2, 0.07, d, 0.12, 0.004); o.frequency.exponentialRampToValueAtTime(2100, t + 0.26);
    }
  }
  /** friendship level up: a warm rising arpeggio */
  levelUp() { const t = this.go(); if (t < 0) return; const d = this.sfx(0, 0.7, 0.4); [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone('sine', f, t + i * 0.09, 0.4, d, 0.16, 0.006)); }
  ui() { if (!this.started) return; const t = this.ctx!.currentTime; this.tone('sine', 1320, t, 0.12, this.sfx(0, 0.5, 0.1), 0.08, 0.003); }
  /** RMS output level (debug / tests) */
  level(): number {
    if (!this.analyser) return 0;
    const d = new Float32Array(this.analyser.fftSize); this.analyser.getFloatTimeDomainData(d);
    let s = 0; for (const v of d) s += v * v; return Math.sqrt(s / d.length);
  }
  dispose() { clearInterval(this.timer); this.ctx?.close(); }
}
