import * as THREE from 'three/webgpu';
import {
  cameraPosition, clamp, color, cos, dot, float, max, mix, mx_noise_float, normalize,
  positionLocal, positionWorld, pow, sin, smoothstep, texture, time, transformNormalToView, vec3,
} from 'three/tsl';
import { WORLD_SIZE } from './Terrain';
import { HORIZON } from './Sky';

/** Stylized animated water: vertex swell, depth tint from the terrain height map, shoreline foam. */
export function createWater(heightTex: THREE.Texture): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(1200, 1200, 220, 220);
  geo.rotateX(-Math.PI / 2);
  const t = time;
  const p = positionLocal;
  const a1 = p.x.mul(0.35).add(t.mul(1.1));
  const a2 = p.z.mul(0.42).sub(t.mul(0.9));
  const a3 = p.x.add(p.z).mul(0.8).add(t.mul(1.7));
  const wave = sin(a1).mul(0.06).add(sin(a2).mul(0.05)).add(sin(a3).mul(0.025));

  const mat = new THREE.MeshStandardNodeMaterial({ transparent: true, roughness: 0.42, metalness: 0.0 });
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
  const h = texture(heightTex, uvH).r.mul(10).sub(4);
  const depth = clamp(h.negate(), 0, 6);

  let col = mix(color('#7af0d8'), color('#2fc2cf'), smoothstep(float(0.0), float(0.9), depth));
  col = mix(col, color('#1a86c4'), smoothstep(float(0.9), float(3.2), depth));
  col = mix(col, color('#1466a8'), smoothstep(float(3.2), float(6.0), depth));

  // Foam
  const n = mx_noise_float(vec3(w.x.mul(0.9), w.z.mul(0.9), t.mul(0.35)));
  const shore = smoothstep(float(0.28), float(0.02), depth.add(n.mul(0.08)));
  const band = smoothstep(float(0.82), float(0.97), sin(depth.mul(9).sub(t.mul(1.6)).add(n.mul(1.5))))
    .mul(smoothstep(float(1.0), float(0.15), depth));
  const foam = clamp(max(shore, band.mul(0.75)), 0, 1);

  // Fresnel sky tint
  const viewDir = normalize(cameraPosition.sub(w));
  const fres = pow(float(1).sub(max(dot(nWorld, viewDir), float(0))), float(4));
  col = mix(col, color(HORIZON).mul(1.05), fres.mul(0.55));
  // sparkle
  const sparkle = smoothstep(float(0.72), float(0.9), mx_noise_float(vec3(w.x.mul(3.0), w.z.mul(3.0), t.mul(1.2)))).mul(0.12);

  mat.colorNode = mix(col, color('#ffffff'), foam);
  mat.emissiveNode = vec3(sparkle).mul(smoothstep(float(0.5), float(2.5), depth));
  mat.opacityNode = clamp(max(mix(float(0.5), float(0.96), smoothstep(float(0.0), float(1.6), depth)), foam), 0, 1);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = false;
  mesh.name = 'water';
  mesh.renderOrder = 1;
  return mesh;
}
