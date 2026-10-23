import * as THREE from 'three/webgpu';
import {
  cameraPosition, clamp, color, step, vec2, cos, dot, float, max, mix, mx_noise_float, normalize,
  positionLocal, positionWorld, pow, sin, smoothstep, texture, time, transformNormalToView, vec3,
} from 'three/tsl';
import { WORLD_SIZE, OCEAN_SIZE, ISLETS, ISLET_SIZE } from './config';
import { skyU } from './Sky';
import { waterDeep, waterK, waterMid, waterShallow } from '../theme/Season';

/** Stylized animated water: vertex swell, depth tint from the terrain height map, shoreline foam. */
export function createWater(heightTex: THREE.Texture, isletTex: THREE.Texture[] = []): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(OCEAN_SIZE, OCEAN_SIZE, 220, 220);
  geo.rotateX(-Math.PI / 2);
  const t = time;
  const p = positionLocal;
  const a1 = p.x.mul(0.35).add(t.mul(1.1));
  const a2 = p.z.mul(0.42).sub(t.mul(0.9));
  const a3 = p.x.add(p.z).mul(0.8).add(t.mul(1.7));
  // calmer water inland (pond) and in the lagoon, full swell offshore
  const amp = smoothstep(float(24), float(44), p.xz.length()).mul(0.85).add(0.15);
  const wave = sin(a1).mul(0.06).add(sin(a2).mul(0.05)).add(sin(a3).mul(0.025)).mul(amp);

  const mat = new THREE.MeshStandardNodeMaterial({ transparent: true, roughness: 0.38, metalness: 0.0 });
  mat.positionNode = p.add(vec3(0, wave, 0));

  // Analytic normal + high-frequency ripples (fragment only).
  const w = positionWorld;
  const dx = cos(a1).mul(0.021).add(cos(a3).mul(0.02))
    .add(cos(w.x.mul(2.3).add(w.z.mul(0.7)).add(t.mul(2.4))).mul(0.025))
    .add(mx_noise_float(vec3(w.x.mul(0.6), w.z.mul(0.6), t.mul(0.5))).mul(0.05));
  const dz = cos(a2).mul(0.021).add(cos(a3).mul(0.02))
    .add(cos(w.z.mul(2.1).sub(w.x.mul(0.9)).sub(t.mul(2.0))).mul(0.025))
    .add(mx_noise_float(vec3(w.z.mul(0.6).add(17), w.x.mul(0.6), t.mul(0.5))).mul(0.05));
  const fade = smoothstep(float(90), float(15), cameraPosition.sub(positionWorld).length());
  const nWorld = normalize(vec3(dx.negate().mul(fade.mul(0.7).add(0.3)), float(1), dz.negate().mul(fade.mul(0.7).add(0.3))));
  mat.normalNode = transformNormalToView(nWorld);

  const uvH = w.xz.div(WORLD_SIZE).add(0.5);
  let h = texture(heightTex, uvH).r.mul(10).sub(4);
  // archipelago islets (Order 42a): their own height maps, only inside each islet's box
  isletTex.forEach((tex, k) => {
    const d = ISLETS[k];
    const uvI = w.xz.sub(vec2(d.x, d.z)).div(ISLET_SIZE).add(0.5);
    const inside = step(0, uvI.x).mul(step(uvI.x, 1)).mul(step(0, uvI.y)).mul(step(uvI.y, 1));
    h = max(h, texture(tex, uvI).r.mul(10).sub(4).mul(inside).add(inside.oneMinus().mul(-10)));
  });
  const depth = clamp(h.negate(), 0, 6);

  // Classic island palette (clearer shallows, richer deep blue); season uniforms tint toward theme water when waterK > 0
  const classicShallow = color('#7ef5e2');
  const classicMidA = color('#2ad4c8');
  const classicMidB = color('#1498c0');
  const classicDeep = color('#0a4588');
  let base = mix(classicShallow, classicMidA, smoothstep(float(0.0), float(0.7), depth));
  base = mix(base, classicMidB, smoothstep(float(0.7), float(2.6), depth));
  base = mix(base, classicDeep, smoothstep(float(2.8), float(6.0), depth));
  let themed = mix(waterShallow, waterMid, smoothstep(float(0.0), float(2.4), depth));
  themed = mix(themed, waterDeep, smoothstep(float(2.6), float(6.0), depth));
  let col = mix(base, themed, waterK);

  // Softer foam bands — wide shoreline wash + gentle rolling crest lines
  const n = mx_noise_float(vec3(w.x.mul(0.9), w.z.mul(0.9), t.mul(0.35)));
  const shore = smoothstep(float(0.38), float(0.0), depth.add(n.mul(0.1)));
  const band = smoothstep(float(0.72), float(0.96), sin(depth.mul(7.5).sub(t.mul(1.45)).add(n.mul(1.4))))
    .mul(smoothstep(float(1.15), float(0.12), depth));
  const foam = clamp(max(shore.mul(0.92), band.mul(0.55)), 0, 1);

  // Fresnel sky tint
  const viewDir = normalize(cameraPosition.sub(w));
  const fres = pow(float(1).sub(max(dot(nWorld, viewDir), float(0))), float(3.6));
  col = mix(col, skyU.horizon.mul(1.05), fres.mul(0.5));
  // sparkle (kept subtle, mostly mid/deep so shallows stay clear)
  const sparkle = smoothstep(float(0.74), float(0.92), mx_noise_float(vec3(w.x.mul(3.0), w.z.mul(3.0), t.mul(1.2)))).mul(0.11);

  mat.colorNode = mix(col, color('#f4fffc'), foam.mul(0.88));
  mat.emissiveNode = vec3(sparkle).mul(smoothstep(float(0.45), float(2.8), depth));
  // clearer shallows: reef shelf readable; deep blue stays nearly opaque
  mat.opacityNode = clamp(max(mix(float(0.26), float(0.96), smoothstep(float(0.05), float(4.4), depth)), foam.mul(0.7)), 0, 1);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = false;
  mesh.name = 'water';
  mesh.renderOrder = 1;
  return mesh;
}
