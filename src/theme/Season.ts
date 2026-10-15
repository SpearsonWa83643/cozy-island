import * as THREE from 'three/webgpu';
import { clamp, dot, mix, mx_noise_float, normalWorld, positionWorld, smoothstep, uniform, vec3, vertexColor } from 'three/tsl';

/**
 * Seasonal look of the island itself (not the dress props): leaf colour, snow on top faces, grass + ground tint.
 * Shared TSL uniforms read by flora, grass and terrain materials; lerped toward the active theme's targets
 * every frame so a theme switch fades in over ~1 s. No dependencies on the theme module (avoids import cycles).
 */
export interface SeasonLook {
  /** leaf target colours (mixed by world-space noise) + strength; null keeps the biome greens */
  leaf: [string, string, string] | null; leafK: number;
  /** snow on upward faces of foliage/rocks (0..1) */
  snow: number;
  /** multiplicative grass blade tint */
  grass: string;
  /** ground (grass areas) target colour + strength */
  ground: string | null; groundK: number;
  /** optional water shallow / mid / deep targets + blend (null keeps the classic island palette) */
  water?: [string, string, string] | null; waterK?: number;
}
export const NO_SEASON: SeasonLook = { leaf: null, leafK: 0, snow: 0, grass: '#ffffff', ground: null, groundK: 0 };

const v3 = (hex: string) => { const c = new THREE.Color(hex); return new THREE.Vector3(c.r, c.g, c.b); };
export const leafA = uniform(v3('#e8892a'));
export const leafB = uniform(v3('#d0452a'));
export const leafC = uniform(v3('#e8b83a'));
export const leafK = uniform(0);
export const snowK = uniform(0);
export const grassTint = uniform(v3('#ffffff'));
export const groundCol = uniform(v3('#ffffff'));
export const groundK = uniform(0);
/** live water palette (Water.ts); defaults match the classic shallow→deep ramp */
export const waterShallow = uniform(v3('#7ef5e2'));
export const waterMid = uniform(v3('#14a8c8'));
export const waterDeep = uniform(v3('#0c4a8a'));
export const waterK = uniform(0);

const LUM = vec3(0.3, 0.59, 0.11);
/** colour multiplier for vertex-coloured foliage: recolours green leaves (keeping their light/dark), frosts tops */
export function seasonFoliage() {
  const vc = vertexColor();
  const lum = dot(vc, LUM);
  const green = smoothstep(0.02, 0.12, vc.y.sub(vc.x.max(vc.z)));
  const n = mx_noise_float(positionWorld.mul(0.22));
  const tgt = mix(mix(leafA, leafB, smoothstep(-0.3, 0.3, n)), leafC, smoothstep(0.25, 0.6, mx_noise_float(positionWorld.mul(0.09).add(7))));
  const tl = dot(tgt, LUM).max(0.05);
  const recol = clamp(tgt.mul(lum.div(tl)).mul(1.15).div(vc.max(0.04)), 0, 6);
  const leafMul = mix(vec3(1), recol, leafK.mul(green));
  // snow caps: upward faces (broken up by noise so caps look drifted, not painted), plus a cold frost on the rest
  const top = smoothstep(-0.05, 0.5, normalWorld.y.add(n.mul(0.3))).mul(snowK);
  const snowMul = clamp(vec3(0.95, 0.97, 1).div(vc.max(0.04)), 0, 8);
  const frostMul = clamp(vec3(0.82, 0.88, 0.98).mul(lum.mul(0.9).add(0.28)).div(vc.max(0.04)), 0, 8);
  return mix(mix(leafMul, frostMul, snowK.mul(0.45)), snowMul, top);
}
/** colour multiplier for terrain grass areas (mask = grass weight, n = low-freq noise for patchy snow) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function seasonGround(mask: any, n: any) {
  const vc = vertexColor();
  const lum = dot(vc, LUM);
  const gc = groundCol;
  const tl = dot(gc, LUM).max(0.05);
  const recol = clamp(gc.mul(lum.div(tl).mul(0.6).add(0.4)).div(vc.max(0.04)), 0, 8);
  const k = groundK.mul(mask).mul(smoothstep(-0.55, 0.15, n.add(groundK.mul(0.3))));
  return mix(vec3(1), recol, k);
}

const tmpC = new THREE.Color(), tmpV = new THREE.Vector3();
const toV = (hex: string) => { tmpC.set(hex); return tmpV.set(tmpC.r, tmpC.g, tmpC.b); };
/** ease the uniforms toward a look (call every frame) */
const WATER_DEFAULT: [string, string, string] = ['#7ef5e2', '#14a8c8', '#0c4a8a'];
export function updateSeason(look: SeasonLook, dt: number) {
  const k = Math.min(1, dt * 1.6);
  if (look.leaf) {
    leafA.value.lerp(toV(look.leaf[0]), k); leafB.value.lerp(toV(look.leaf[1]), k); leafC.value.lerp(toV(look.leaf[2]), k);
  }
  leafK.value += ((look.leaf ? look.leafK : 0) - leafK.value) * k;
  snowK.value += (look.snow - snowK.value) * k;
  grassTint.value.lerp(toV(look.grass), k);
  if (look.ground) groundCol.value.lerp(toV(look.ground), k);
  groundK.value += ((look.ground ? look.groundK : 0) - groundK.value) * k;
  const w = look.water ?? WATER_DEFAULT;
  waterShallow.value.lerp(toV(w[0]), k); waterMid.value.lerp(toV(w[1]), k); waterDeep.value.lerp(toV(w[2]), k);
  waterK.value += ((look.water ? (look.waterK ?? 1) : 0) - waterK.value) * k;
}
/** jump straight to a look (first frame / tests) */
export function snapSeason(look: SeasonLook) { updateSeason(look, 10); }
