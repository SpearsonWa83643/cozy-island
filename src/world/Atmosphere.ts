import * as THREE from 'three/webgpu';
import { Fn, float, length, luminance, max, mix, output, positionView, positionWorld, reference, smoothstep, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { ISLETS } from './config';

/**
 * Height fog + aerial perspective (Big island 3/7). Replaces the plain range fog with one TSL fog node:
 *  - range fog exactly as before (driven by the same THREE.Fog the biome / theme / cave code animates)
 *  - aerial perspective: distant things desaturate and shift toward a per-theme haze colour before the fog
 *  - height fog: low-lying mist in valleys / over the sea that thickens with distance (great from the mount)
 * Per-theme tints: cool blue in Spring/Summer, warm amber in Autumn, icy in Winter, purple in Halloween.
 * Cheap: a few ALU ops per fragment, no extra passes, works on the WebGL2 fallback too.
 * Order 42b: land on/above the sea around Blossom Isle gets much less fog + aerial haze, so the islet reads as a
 * destination from the main shore instead of a faint purple shape (the sea and sky around it keep the full fog).
 */
/** how much fog/haze is lifted from the islet's land (0 = none, 1 = all) */
export const ISLET_CLEAR = 0.72;
export interface HazeLook { haze: string; aerial: number; height: number; top: number }
export const HAZE: Record<string, HazeLook> = {
  classic: { haze: '#b8d4ec', aerial: 0.5, height: 0.32, top: 2.2 },
  spring: { haze: '#bcd8f0', aerial: 0.5, height: 0.34, top: 2.2 },
  summer: { haze: '#a8cdf0', aerial: 0.45, height: 0.24, top: 1.8 },
  autumn: { haze: '#e6b284', aerial: 0.6, height: 0.48, top: 2.6 },
  winter: { haze: '#c4d8f0', aerial: 0.62, height: 0.55, top: 2.8 },
  halloween: { haze: '#7a58a8', aerial: 0.66, height: 0.62, top: 3.0 },
};

export class Atmosphere {
  readonly node: THREE.Node;
  private hazeColor = uniform(new THREE.Color(HAZE.classic.haze));
  private aerial = uniform(HAZE.classic.aerial);
  private height = uniform(HAZE.classic.height);
  private top = uniform(HAZE.classic.top);
  private target: HazeLook = HAZE.classic;
  private tc = new THREE.Color(HAZE.classic.haze);
  /** 0 = outdoors, 1 = inside the cave (haze off) */
  under = 0;
  /** islet haze lift (uniform, 0..1) */
  readonly isletClear = uniform(ISLET_CLEAR);
  /** Order 49: time-of-day haze colour + strength (the game sets these each frame) */
  readonly tod = new THREE.Color(); todK = 0;
  private tmp = new THREE.Color();

  constructor(fogState: THREE.Fog) {
    const color = reference('color', 'color', fogState);
    const near = reference('near', 'float', fogState);
    const far = reference('far', 'float', fogState);
    const { hazeColor, aerial, height, top } = this;
    const isls = ISLETS.length ? ISLETS : [{ x: 1e5, z: 1e5, r: 1 }];
    const clearK = this.isletClear;
    this.node = Fn(() => {
      const viewZ = positionView.z.negate();
      // islet land (inside its shore + a bit, above sea level) keeps most of its colour at range
      // every archipelago islet (Order 48a): the nearest one wins
      let landK = smoothstep(float(isls[0].r * 1.15), float(isls[0].r * 0.8), length(positionWorld.xz.sub(vec2(isls[0].x, isls[0].z))));
      for (let k = 1; k < isls.length; k++) landK = max(landK, smoothstep(float(isls[k].r * 1.15), float(isls[k].r * 0.8), length(positionWorld.xz.sub(vec2(isls[k].x, isls[k].z)))));
      const onIslet = landK.mul(smoothstep(float(-0.1), float(0.5), positionWorld.y)).mul(clearK);
      const lift = float(1).sub(onIslet);
      const range = smoothstep(near, far, viewZ).mul(lift);
      // aerial perspective: starts well before the fog, desaturates + tints toward the haze
      const aer = smoothstep(near.mul(0.3), far.mul(0.85), viewZ).mul(aerial).mul(lift.mul(0.6).add(0.4));
      const rgb = output.rgb;
      const desat = mix(rgb, vec3(luminance(rgb)), aer.mul(0.45));
      const tinted = mix(desat, hazeColor, aer.mul(0.32));
      // height fog: below `top`, thicker the lower and farther it is
      const depth = top.sub(positionWorld.y).max(0).div(top.add(2.5)).min(1);
      const hf = depth.mul(smoothstep(float(6), far.mul(0.55), viewZ)).mul(height).mul(lift);
      return vec4(mix(tinted, color, max(range, hf).min(1)), output.a);
    })();
  }

  setTheme(id: string) {
    this.target = HAZE[id] ?? HAZE.classic;
    this.tc.set(this.target.haze);
  }
  /** snap straight to the theme look (no blend), e.g. at boot */
  snap() { const t = this.target; this.hazeColor.value.copy(this.tc); this.aerial.value = t.aerial; this.height.value = t.height; this.top.value = t.top; }

  update(dt: number) {
    const k = Math.min(1, dt * 1.5), t = this.target, off = 1 - this.under;
    this.hazeColor.value.lerp(this.todK > 0.001 ? this.tmp.copy(this.tc).lerp(this.tod, this.todK) : this.tc, this.todK > 0.001 ? 1 : k);
    this.aerial.value += (t.aerial * off - this.aerial.value) * k;
    this.height.value += (t.height * off - this.height.value) * k;
    this.top.value += (t.top - this.top.value) * k;
  }
  get debug() { return { aerial: +this.aerial.value.toFixed(3), height: +this.height.value.toFixed(3), top: +this.top.value.toFixed(2), haze: '#' + this.hazeColor.value.getHexString() }; }
}
