// Small seeded 2D gradient noise + fbm (no deps).
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Noise2D {
  private perm = new Uint8Array(512);
  private grads: [number, number][] = [];
  constructor(seed = 1) {
    const rnd = mulberry32(seed);
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    for (let i = 0; i < 256; i++) {
      const a = rnd() * Math.PI * 2;
      this.grads.push([Math.cos(a), Math.sin(a)]);
    }
  }
  private g(ix: number, iy: number, x: number, y: number) {
    const gr = this.grads[this.perm[(ix & 255) + this.perm[iy & 255]]];
    return gr[0] * x + gr[1] * y;
  }
  noise(x: number, y: number): number {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const n00 = this.g(x0, y0, fx, fy);
    const n10 = this.g(x0 + 1, y0, fx - 1, fy);
    const n01 = this.g(x0, y0 + 1, fx, fy - 1);
    const n11 = this.g(x0 + 1, y0 + 1, fx - 1, fy - 1);
    const a = n00 + u * (n10 - n00);
    const b = n01 + u * (n11 - n01);
    return (a + v * (b - a)) * 1.4; // ~[-1,1]
  }
  fbm(x: number, y: number, oct = 4): number {
    let s = 0, amp = 0.5, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) {
      s += amp * this.noise(x * f, y * f);
      norm += amp;
      amp *= 0.5;
      f *= 2.03;
    }
    return s / norm;
  }
}
