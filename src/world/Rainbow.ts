import * as THREE from 'three/webgpu';
import { cos, float, length, positionLocal, smoothstep, uniform, vec3 } from 'three/tsl';

/** Order 50d: a soft rainbow arc after a rain shower clears in daylight. One additive mesh (one draw, hidden when off),
 *  centred on the anti-solar point like a real bow (42 deg radius), kept a little above the horizon when the sun is high. */
export class Rainbow {
  strength = uniform(0);
  mesh: THREE.Mesh;
  private v = new THREE.Vector3();
  private static D = 430;
  constructor() {
    const geo = new THREE.RingGeometry(0.84, 1, 72, 1, 0, Math.PI);
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const r = length(positionLocal.xy), t = r.sub(0.84).div(0.16); // 0 inner (violet) .. 1 outer (red)
    const spec = vec3(0.5).add(cos(t.mul(-0.78).add(vec3(0.02, 0.36, 0.69)).mul(6.2832)).mul(0.5));
    mat.colorNode = spec;
    // soft edges, thicker colour in the middle, base of the arc fades into the haze
    const edge = smoothstep(float(0), float(0.22), t).mul(smoothstep(float(1), float(0.72), t));
    const base = smoothstep(float(0.0), float(0.28), positionLocal.y);
    mat.opacityNode = edge.mul(base).mul(this.strength).mul(0.42);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'rainbow'; this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.renderOrder = -1;
  }
  /** k: 0..1 final strength; sunDir: unit vector toward the sun */
  update(k: number, cam: THREE.Vector3, sunDir: THREE.Vector3) {
    this.strength.value = k; this.mesh.visible = k > 0.002; if (!this.mesh.visible) return;
    const D = Rainbow.D, el = Math.asin(Math.max(-1, Math.min(1, sunDir.y)));
    const hl = Math.hypot(sunDir.x, sunDir.z) || 1;
    // anti-solar direction, its depression capped so the bow always rises clear of the horizon
    const dep = Math.min(Math.max(el, 0), 0.22);
    this.v.set(-sunDir.x / hl * Math.cos(dep), -Math.sin(dep), -sunDir.z / hl * Math.cos(dep));
    this.mesh.position.copy(cam).addScaledVector(this.v, D);
    this.mesh.scale.setScalar(D * 0.9);
    this.mesh.lookAt(cam);
  }
}
