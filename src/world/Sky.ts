import * as THREE from 'three/webgpu';
import { float, floor, fract, length, max, mix, normalize, positionLocal, pow, sin, smoothstep, step, time, uniform, vec3, dot } from 'three/tsl';

export const SUN_DIR = new THREE.Vector3(-0.5, 0.78, -0.6).normalize();
/** the (Halloween) moon hangs low over the sea, opposite the sun, so it frames the island at dusk */
export const MOON_DIR = new THREE.Vector3(0.62, 0.17, 0.72).normalize();
export const HORIZON = new THREE.Color('#ffe0c2');
export const FOG_COLOR = new THREE.Color('#cfe3ea');
/** live fog/horizon colour (blended per biome by the game) */
export const skyFog = uniform(FOG_COLOR.clone());
/** live sky palette: the theme system lerps these (spring = the original day gradient) */
export const SKY_CLASSIC = { zenith: '#3f8fdc', mid: '#86c7ee', low: '#bfe4f2', horizon: '#ffe0c2' };
export const skyU = {
  zenith: uniform(new THREE.Color(SKY_CLASSIC.zenith)),
  mid: uniform(new THREE.Color(SKY_CLASSIC.mid)),
  low: uniform(new THREE.Color(SKY_CLASSIC.low)),
  horizon: uniform(new THREE.Color(SKY_CLASSIC.horizon)),
  sunGlow: uniform(1),
  moon: uniform(0),
  stars: uniform(0),
};
/** live sun / moon directions (Order 49: the day/night clock moves them along their arcs) */
/** 0..1 daylight on the scene (1 by day, ~0.2 at night): scales fake glows (foliage SSS, clouds) so nights stay dark */
export const dayU = uniform(1);
export const skyDirs = { sun: uniform(SUN_DIR.clone()), moon: uniform(MOON_DIR.clone()) };

/** Stylized gradient sky dome with a soft sun (and, when themed, a big friendly moon + stars). Follows the camera. */
export function createSky(): THREE.Mesh {
  const sunDir = skyDirs.sun;
  const moonDir = skyDirs.moon;
  const dir = normalize(positionLocal);
  const y = dir.y;
  let c = mix(skyFog, skyU.horizon, smoothstep(float(-0.08), float(0.0), y));
  c = mix(c, mix(skyU.low, skyFog, 0.35), smoothstep(float(0.0), float(0.12), y));
  c = mix(c, skyU.mid, smoothstep(float(0.1), float(0.4), y));
  c = mix(c, skyU.zenith, smoothstep(float(0.4), float(1.0), y));
  const s = max(dot(dir, sunDir), float(0));
  const sun = vec3(1.0, 0.953, 0.84).mul(pow(s, float(1400)).mul(14).add(pow(s, float(40)).mul(0.6)).add(pow(s, float(6)).mul(0.18))).mul(skyU.sunGlow);
  // moon: a big soft disc with a couple of gentle "mare" blotches and a wide halo
  const m = dot(dir, moonDir);
  const disc = smoothstep(float(0.9975), float(0.9982), m);
  const blot = sin(dir.x.mul(140)).mul(sin(dir.y.mul(170).add(1.3))).mul(0.5).add(0.5);
  const moonCol = mix(vec3(1.0, 0.96, 0.82), vec3(0.93, 0.86, 0.74), smoothstep(float(0.55), float(0.9), blot));
  const halo = pow(max(m, float(0)), float(220)).mul(0.35).add(pow(max(m, float(0)), float(18)).mul(0.12));
  const moon = moonCol.mul(disc.mul(1.6)).add(vec3(1.0, 0.85, 0.7).mul(halo)).mul(skyU.moon);
  // stars (Order 49b): hashed cells on the dome itself, so the whole star field costs no extra draw call. Each lit
  // cell holds one round, soft star of its own size, brightness and warmth that twinkles gently; they fade in from
  // the horizon and with skyU.stars (night / theme), so they fade out at dawn.
  const g = dir.mul(220), cell = floor(g);
  const h = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))).mul(43758.5453));
  const h2 = fract(h.mul(91.7).add(0.31));
  const r = length(fract(g).sub(0.5));
  const dot1 = smoothstep(float(0.16).add(h2.mul(0.2)), float(0.02), r);
  const tw = sin(time.mul(h2.mul(2.5).add(1.2)).add(h.mul(60))).mul(0.25).add(0.75);
  const starA = step(float(0.993), h).mul(dot1).mul(tw).mul(h2.mul(0.7).add(0.5))
    .mul(smoothstep(float(0.04), float(0.35), y)).mul(skyU.stars);
  const stars = mix(vec3(0.78, 0.85, 1.0), vec3(1.0, 0.92, 0.78), h2).mul(starA).mul(1.25);
  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
  mat.colorNode = vec3(c).add(sun).add(moon.mul(float(1).sub(disc.mul(0.0)))).add(stars);
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(800, 48, 24), mat);
  mesh.name = 'sky';
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}
