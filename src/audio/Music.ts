import { Biome } from '../world/Biomes';
import type { MusicFlavor } from './soundscapes';
/** finite-or-fallback for AudioParam writes (a NaN throws in WebAudio) */
const F = (v: number, fb: number) => (Number.isFinite(v) ? v : fb);

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const rand = (a: number, b: number) => a + Math.random() * (b - a);

// Diatonic chords as semitone offsets from the key root (7ths/9ths for softness).
const CHORDS: Record<string, number[]> = {
  I: [0, 4, 7, 11, 14], ii: [2, 5, 9, 12, 16], iii: [4, 7, 11, 14], IV: [5, 9, 12, 16, 19],
  V: [7, 11, 14, 17, 21], vi: [9, 12, 16, 19, 23], Isus: [0, 5, 7, 14], IVadd9: [5, 9, 12, 19],
};
// Markov transitions between chords (weights).
const NEXT: Record<string, [string, number][]> = {
  I: [['IV', 3], ['vi', 3], ['ii', 1.5], ['iii', 1], ['Isus', 1], ['IVadd9', 1.5]],
  Isus: [['I', 3], ['IV', 1], ['vi', 1]],
  ii: [['V', 2], ['IV', 1.5], ['vi', 1], ['I', 1]],
  iii: [['vi', 3], ['IV', 2], ['ii', 1]],
  IV: [['I', 3], ['V', 1.2], ['ii', 1.5], ['vi', 1.5], ['IVadd9', 0.7]],
  IVadd9: [['I', 3], ['vi', 1.5], ['iii', 1]],
  V: [['I', 2], ['vi', 2.5], ['IV', 1.5], ['Isus', 1]],
  vi: [['IV', 3], ['ii', 2], ['I', 1.5], ['iii', 1], ['V', 0.7]],
};
// spooky-cute (Halloween): natural/harmonic minor, a dash of chromatic mischief
const MCHORDS: Record<string, number[]> = {
  i: [0, 3, 7, 10, 14], iv: [5, 8, 12, 15], VI: [8, 12, 15, 19], VII: [10, 14, 17, 21], V7: [7, 11, 14, 17], iio: [2, 5, 8, 12], i6: [0, 3, 7, 9],
};
const MNEXT: Record<string, [string, number][]> = {
  i: [['iv', 3], ['VI', 2.5], ['VII', 1.5], ['iio', 1], ['i6', 1]], i6: [['iv', 2], ['V7', 1.5]],
  iv: [['i', 2], ['V7', 2], ['VI', 1]], VI: [['VII', 2], ['iio', 1.5], ['iv', 1]], VII: [['i', 3], ['VI', 1]],
  iio: [['V7', 3]], V7: [['i', 3], ['VI', 1]],
};
const MPENTA = [0, 3, 5, 7, 10];
const PENTA = [0, 2, 4, 7, 9];
const KEYS = [60, 62, 65, 67, 57, 64]; // C D F G A E (major keys), moved between slowly

const pick = (items: [string, number][]) => { let s = 0; for (const [, w] of items) s += w; let r = Math.random() * s; for (const [k, w] of items) if ((r -= w) <= 0) return k; return items[0][0]; };

/**
 * Generative ambient music: slowly evolving pad chords from a Markov chain,
 * with sparse pentatonic plucks / chimes / kalimba phrases whose density
 * breathes over minutes, short motif memory with variation, and occasional
 * key changes. Nothing loops, so it never sounds repetitive.
 */
export class MusicGen {
  /** 'classic' major pentatonic, 'spooky' minor celesta, 'festive' bright chimes, 'spring' airy flute + kalimba in G,
   *  'summer' lazy warm marimba in F (soundscapes.ts) */
  mode: MusicFlavor = 'classic';
  setMode(m: MusicFlavor) {
    if (m === this.mode) return;
    this.mode = m; this.motif = []; this.phraseLeft = 0;
    this.key = m === 'spooky' ? 62 : m === 'festive' || m === 'spring' ? 67 : m === 'summer' ? 65 : KEYS[0];
    this.chord = m === 'spooky' ? 'i' : 'I'; this.chordsInKey = 0;
    this.beat = 60 / (m === 'spring' ? 76 : m === 'summer' ? 64 : 68);
    // fresh pad bus so the old flavour's long chords fade out instead of ringing into the new one
    const t = this.ctx.currentTime, old = this.padBus;
    old.gain.cancelScheduledValues(t); old.gain.setValueAtTime(old.gain.value, t); old.gain.linearRampToValueAtTime(0.0001, t + 0.6);
    setTimeout(() => old.disconnect(), 800);
    this.padBus = this.ctx.createGain(); this.padBus.gain.value = 0.5; this.padBus.connect(this.padLP);
    this.nextChordAt = t + 0.2; this.nextNoteAt = Math.min(this.nextNoteAt, t + 1.5);
  }
  private key = KEYS[0];
  private chord = 'I';
  private nextChordAt = 0;
  private nextNoteAt = 0;
  private density = 0.5;
  private dPhase = Math.random() * 10;
  private motif: number[] = [];
  private instrument: 'pluck' | 'chime' | 'kalimba' | 'celesta' | 'pizz' | 'flute' | 'marimba' = 'pluck';
  private phraseLeft = 0;
  private chordsInKey = 0;
  private padLP: BiquadFilterNode;
  private padBus: GainNode;
  private beat = 60 / 68;

  constructor(private ctx: AudioContext, private out: GainNode, private reverb: GainNode) {
    this.padBus = ctx.createGain(); this.padBus.gain.value = 0.5;
    this.padLP = ctx.createBiquadFilter(); this.padLP.type = 'lowpass'; this.padLP.frequency.value = 1100; this.padLP.Q.value = 0.4;
    this.padBus.connect(this.padLP);
    this.padLP.connect(out);
    const send = ctx.createGain(); send.gain.value = 0.6; this.padLP.connect(send).connect(reverb);
    // slow filter breathing
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.035;
    const d = ctx.createGain(); d.gain.value = 450; lfo.connect(d).connect(this.padLP.frequency); lfo.start();
    this.nextChordAt = ctx.currentTime + 0.3;
    this.nextNoteAt = ctx.currentTime + 4;
  }

  chimeFreq(i: number) { const deg = PENTA[(i % 5 + 5) % 5]; return mtof(this.key + 12 + deg); }

  tick(w: Float32Array) {
    const t = this.ctx.currentTime;
    if (t + 0.5 > this.nextChordAt) this.playChord(this.nextChordAt, w);
    this.dPhase += 0.1 / 60;
    // density breathes on a few-minute scale; quieter in misty marsh, livelier on the beach
    this.density = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(this.dPhase * 2.1) * Math.sin(this.dPhase * 0.77 + 1))
      + w[Biome.Tropical] * 0.12 + w[Biome.Meadow] * 0.05 - w[Biome.Marsh] * 0.1;
    while (t + 0.6 > this.nextNoteAt) this.playMelody(this.nextNoteAt, w);
  }

  private playChord(at: number, w: Float32Array) {
    const dur = rand(11, 19);
    this.chordsInKey++;
    const sp = this.mode === 'spooky'; const fest = this.mode === 'festive';
    if (!sp && this.chordsInKey > 10 && this.chord === 'I' && Math.random() < (fest ? 0.45 : 0.35)) {
      // modulate up a fourth or fifth (smooth common-tone move)
      const step = Math.random() < 0.5 ? 5 : 7;
      this.key = ((this.key - 55 + step) % 12) + 55;
      this.chordsInKey = 0;
    }
    this.chord = pick((sp ? MNEXT : NEXT)[this.chord] ?? (sp ? MNEXT.i : NEXT.I));
    if (this.mode === 'summer' && this.chord === 'V' && Math.random() < 0.6) this.chord = 'IVadd9'; // lazy, no pull home
    const notes = (sp ? MCHORDS : CHORDS)[this.chord];
    // voice: root low, others spread in a gentle open voicing; drop random tones for variety
    const base = this.key - 12;
    const voices = notes.filter((_, i) => i === 0 || Math.random() < 0.85);
    voices.forEach((n, i) => {
      const m = base + n + (i === 0 ? -12 : 0) + (i > 2 && Math.random() < 0.3 ? 12 : 0);
      this.padVoice(mtof(m), at + i * rand(0.05, 0.4), dur + 3, i === 0 ? 0.11 : 0.06);
    });
    // alpine / marsh: add an airy high fifth shimmer
    if (Math.random() < 0.3 + w[Biome.Alpine] * 0.4) this.padVoice(mtof(base + notes[0] + 31), at + 2, dur, 0.02);
    this.nextChordAt = at + dur;
  }

  private padVoice(f: number, at: number, dur: number, peak: number) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const atk = rand(2.5, 4.5), rel = rand(3.5, 5.5);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(peak, at + atk);
    g.gain.setValueAtTime(peak, at + dur - rel);
    g.gain.linearRampToValueAtTime(0.0001, at + dur);
    g.connect(this.padBus);
    for (const [type, det, lvl] of [['sine', -5, 1], ['triangle', 6, 0.45], ['sine', 1200 + 3, 0.12]] as [OscillatorType, number, number][]) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = F(f, 220); o.detune.value = F(det, 0);
      const og = ctx.createGain(); og.gain.value = F(lvl, 0);
      // slow vibrato for life
      const v = ctx.createOscillator(); v.frequency.value = rand(0.1, 0.25); const vd = ctx.createGain(); vd.gain.value = rand(2, 5);
      v.connect(vd).connect(o.detune); v.start(at); v.stop(at + dur + 0.1);
      o.connect(og).connect(g); o.start(at); o.stop(at + dur + 0.1);
    }
  }

  private playMelody(at: number, w: Float32Array) {
    if (this.phraseLeft <= 0) {
      // new phrase: choose instrument by biome flavour; maybe recall + vary the last motif
      const r = Math.random();
      const chimeBias = 0.2 + w[Biome.Alpine] * 0.5 + w[Biome.Marsh] * 0.3;
      const kalBias = 0.2 + w[Biome.Tropical] * 0.4 + w[Biome.Desert] * 0.3;
      if (this.mode === 'spooky') this.instrument = r < 0.55 ? 'celesta' : 'pizz';
      else if (this.mode === 'festive') this.instrument = r < 0.55 ? 'chime' : r < 0.85 ? 'celesta' : 'pluck';
      else if (this.mode === 'spring') this.instrument = r < 0.45 ? 'flute' : r < 0.78 ? 'kalimba' : 'chime';
      else if (this.mode === 'summer') this.instrument = r < 0.6 ? 'marimba' : r < 0.85 ? 'pluck' : 'kalimba';
      else this.instrument = r < chimeBias ? 'chime' : r < chimeBias + kalBias ? 'kalimba' : 'pluck';
      if (this.motif.length && Math.random() < 0.45) {
        const shift = Math.floor(rand(-2, 3));
        this.motif = this.motif.map((d, i) => d + shift + (Math.random() < 0.25 ? (i % 2 ? 1 : -1) : 0));
      } else {
        const len = 3 + Math.floor(Math.random() * 4);
        let d = Math.floor(rand(3, 8));
        this.motif = [];
        for (let i = 0; i < len; i++) { d += Math.floor(rand(-2, 3)); this.motif.push(Math.max(0, Math.min(12, d))); }
      }
      this.phraseLeft = this.motif.length;
      // rest between phrases
      if (Math.random() > this.density + (this.mode === 'festive' ? 0.15 : 0)) { this.nextNoteAt = at + this.beat * Math.floor(rand(this.mode === 'festive' ? 2 : 4, this.mode === 'festive' ? 8 : 12)); this.phraseLeft = 0; return; }
    }
    const idx = this.motif.length - this.phraseLeft;
    const deg = this.motif[idx];
    this.phraseLeft--;
    const sp = this.mode === 'spooky';
    const oct = Math.floor(deg / 5);
    // spooky: minor pentatonic with the odd chromatic tiptoe (b5 / maj7) for cheeky charm
    const pc = sp ? (Math.random() < 0.1 ? [6, 11, 1][Math.floor(Math.random() * 3)] : MPENTA[deg % 5]) : PENTA[deg % 5];
    const f = mtof(this.key + (this.instrument === 'chime' || this.instrument === 'celesta' || this.instrument === 'flute' ? 12 : 0) + oct * 12 + pc);
    if (Math.random() < 0.88) this.note(f, at);
    const lens = this.instrument === 'chime' ? [2, 3, 4] : this.instrument === 'flute' ? [1, 2, 2, 3] : this.instrument === 'marimba' ? [0.5, 1, 1, 1.5, 2] : this.instrument === 'pizz' ? [0.5, 0.5, 1, 1, 1.5] : this.instrument === 'celesta' ? [1, 1, 2, 0.5, 3] : [1, 1, 2, 2, 3, 0.5];
    this.nextNoteAt = at + this.beat * lens[Math.floor(Math.random() * lens.length)] * (1 + rand(-0.04, 0.04));
  }

  private note(f: number, at: number) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) { pan.pan.value = rand(-0.5, 0.5); g.connect(pan).connect(this.out); } else g.connect(this.out);
    const send = ctx.createGain(); send.gain.value = 0.7; g.connect(send).connect(this.reverb);
    const vel = rand(0.6, 1);
    if (this.instrument === 'flute') { this.flute(f, at, g, vel); return; }
    const partials: [number, number, number][] =
      this.instrument === 'celesta' ? [[1, 0.06, 1.9], [4, 0.016, 0.45], [10, 0.004, 0.14]]
      : this.instrument === 'pizz' ? [[1, 0.085, 0.3], [2, 0.03, 0.16], [3, 0.012, 0.08]]
      : this.instrument === 'chime' ? [[1, 0.05, 4.5], [2.76, 0.018, 2.2], [5.4, 0.008, 1.2], [8.93, 0.004, 0.6]]
      : this.instrument === 'marimba' ? [[1, 0.075, 0.55], [4, 0.014, 0.12], [9.9, 0.004, 0.05]]
      : this.instrument === 'kalimba' ? [[1, 0.07, 1.6], [3.9, 0.012, 0.25], [6.1, 0.006, 0.12]]
      : [[1, 0.06, 1.3], [2, 0.022, 0.6], [3, 0.008, 0.3]];
    for (const [ratio, amp, dec] of partials) {
      const o = ctx.createOscillator(); o.type = (this.instrument === 'pluck' || this.instrument === 'pizz') && ratio === 1 ? 'triangle' : 'sine';
      o.frequency.value = Math.min(18000, F(f * ratio, 440));
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, at); og.gain.exponentialRampToValueAtTime(amp * vel, at + 0.006); og.gain.exponentialRampToValueAtTime(0.0001, at + dec);
      o.connect(og).connect(g); o.start(at); o.stop(at + dec + 0.05);
    }
  }

  /** soft breathy flute: slow attack, gentle vibrato, a whisper of breath noise-free 2nd harmonic */
  private flute(f: number, at: number, g: GainNode, vel: number) {
    const ctx = this.ctx, dur = this.beat * rand(1.2, 2.2);
    for (const [ratio, amp] of [[1, 0.05], [2, 0.012], [3, 0.004]] as const) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = Math.min(18000, F(f * ratio, 440));
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, at); og.gain.linearRampToValueAtTime(amp * vel, at + 0.09);
      og.gain.setValueAtTime(amp * vel * 0.85, at + dur * 0.6); og.gain.linearRampToValueAtTime(0.0001, at + dur);
      const v = ctx.createOscillator(); v.frequency.value = rand(4.5, 5.5); const vd = ctx.createGain();
      vd.gain.setValueAtTime(0, at); vd.gain.linearRampToValueAtTime(9, at + dur * 0.5); v.connect(vd).connect(o.detune);
      o.connect(og).connect(g); o.start(at); o.stop(at + dur + 0.05); v.start(at); v.stop(at + dur + 0.05);
    }
  }
}
