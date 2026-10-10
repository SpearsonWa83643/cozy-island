import * as THREE from 'three/webgpu';
import { color, float, max, mix, normalize, positionLocal, pow, smoothstep, uniform, vec3, dot } from 'three/tsl';

export const SUN_DIR = new THREE.Vector3(-0.5, 0.78, -0.6).normalize();
export const HORIZON = new THREE.Color('#ffe0c2');
export const FOG_COLOR = new THREE.Color('#cfe3ea');
/** live fog/horizon colour (blended per biome by the game) */
export const skyFog = uniform(FOG_COLOR.clone());

/** Stylized gradient sky dome with a soft sun. Follows the camera. */
export function createSky(): THREE.Mesh {
  const sunDir = uniform(SUN_DIR.clone());
  const dir = normalize(positionLocal);
  const y = dir.y;
  const horizon = color(HORIZON);
  const low = color('#bfe4f2');
  const mid = color('#86c7ee');
  const zenith = color('#3f8fdc');
  let c = mix(skyFog, horizon, smoothstep(float(-0.08), float(0.0), y));
  c = mix(c, mix(low, skyFog, 0.35), smoothstep(float(0.0), float(0.12), y));
  c = mix(c, mid, smoothstep(float(0.1), float(0.4), y));
  c = mix(c, zenith, smoothstep(float(0.4), float(1.0), y));
  const s = max(dot(dir, sunDir), float(0));
  const sun = color('#fff3d6').mul(pow(s, float(1400)).mul(14).add(pow(s, float(40)).mul(0.6)).add(pow(s, float(6)).mul(0.18)));
  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
  mat.colorNode = vec3(c).add(sun);
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(800, 48, 24), mat);
  mesh.name = 'sky';
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}
