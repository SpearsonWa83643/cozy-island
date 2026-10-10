import * as THREE from 'three/webgpu';
import { heightAt } from '../world/Terrain';

const N = 44, SPACING = 0.8, START = 1.4, FADE_END = 9;

/**
 * Glowing footprint trail that flows from the player toward the active treasure.
 * One InstancedMesh (single draw call, unlit, no shadows) so it's cheap on iPad Low.
 * It fades out well before the X so the last stretch is still yours to discover.
 */
export class Guide {
  mesh: THREE.InstancedMesh;
  enabled = true;
  private vis = 0; // eased 0..1 show/hide
  private t = 0;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private s = new THREE.Vector3(); private p = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor() {
    const g = new THREE.CircleGeometry(0.15, 12).toNonIndexed();
    g.rotateX(-Math.PI / 2);
    g.scale(0.75, 1, 1.35); // footprint-ish oval
    // two-tone: bright core, warm amber rim, readable on sand, grass and snow alike
    const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
    const core = new THREE.Color('#fff7d6'), rim = new THREE.Color('#ff9d2e');
    for (let i = 0; i < pos.count; i++) { const c = Math.hypot(pos.getX(i), pos.getZ(i)) < 0.01 ? core : rim; col.set([c.r, c.g, c.b], i * 3); }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.MeshBasicNodeMaterial({ vertexColors: true, transparent: true, opacity: 0.92, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    mat.toneMapped = false;
    this.mesh = new THREE.InstancedMesh(g, mat, N);
    this.mesh.frustumCulled = false; this.mesh.castShadow = false; this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 3;
    this.mesh.name = 'treasure-guide';
  }

  update(dt: number, from: THREE.Vector3, to: THREE.Vector3 | null) {
    this.t += dt;
    const want = this.enabled && to ? 1 : 0;
    this.vis += (want - this.vis) * Math.min(1, dt * 3);
    if (this.vis < 0.01 || !to) { this.mesh.visible = false; return; }
    this.mesh.visible = true;
    const dx = to.x - from.x, dz = to.z - from.z, D = Math.hypot(dx, dz);
    const ux = dx / (D || 1), uz = dz / (D || 1);
    const yaw = Math.atan2(ux, uz);
    const flow = (this.t * 1.1) % SPACING; // dashes drift toward the chest
    const end = D - FADE_END;
    for (let i = 0; i < N; i++) {
      const d = START + i * SPACING + flow;
      let sc = 0;
      if (d < end) {
        const near = Math.min(1, (d - START) / 1.5);          // ease in at the player
        const far = Math.min(1, (end - d) / 5);               // fade out before the X
        const tail = 1 - Math.min(1, (d - START) / (N * SPACING)); // softer far away
        const pulse = 0.85 + 0.15 * Math.sin(this.t * 3 - d * 1.3);
        sc = near * far * (0.7 + 0.3 * tail) * pulse * this.vis;
      }
      const side = (i % 2 ? 1 : -1) * 0.13; // alternate left/right like footsteps
      const x = from.x + ux * d + uz * side, z = from.z + uz * d - ux * side;
      const h = heightAt(x, z);
      if (h < 0.03) sc = 0; // no prints on water
      this.p.set(x, h + 0.1, z);
      this.q.setFromAxisAngle(this.up, yaw);
      this.s.setScalar(Math.max(0.0001, sc));
      this.mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
