import * as THREE from 'three/webgpu';

/**
 * Bakes several primitive parts into one non-indexed geometry with vertex colours
 * and a per-vertex `sway` weight (0 = rigid, 1 = moves with wind). One prototype
 * geometry = one InstancedMesh = one draw call for any number of plants/creatures.
 */
export class Baker {
  private parts: { g: THREE.BufferGeometry; c: THREE.Color; sway: number | ((y: number) => number) }[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();

  add(geo: THREE.BufferGeometry, color: string | THREE.Color, pos: [number, number, number] = [0, 0, 0],
    rot: [number, number, number] = [0, 0, 0], scale: number | [number, number, number] = 1, sway: number | ((y: number) => number) = 0) {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone());
    const s = typeof scale === 'number' ? new THREE.Vector3(scale, scale, scale) : new THREE.Vector3(...scale);
    this.q.setFromEuler(this.e.set(rot[0], rot[1], rot[2]));
    this.m.compose(new THREE.Vector3(...pos), this.q, s);
    g.applyMatrix4(this.m);
    this.parts.push({ g, c: typeof color === 'string' ? new THREE.Color(color) : color.clone(), sway });
    return this;
  }

  build(): THREE.BufferGeometry {
    let n = 0;
    for (const p of this.parts) n += p.g.attributes.position.count;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), sw = new Float32Array(n);
    let o = 0;
    for (const p of this.parts) {
      const a = p.g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < a.count; i++) {
        pos[(o + i) * 3] = a.getX(i); pos[(o + i) * 3 + 1] = a.getY(i); pos[(o + i) * 3 + 2] = a.getZ(i);
        col[(o + i) * 3] = p.c.r; col[(o + i) * 3 + 1] = p.c.g; col[(o + i) * 3 + 2] = p.c.b;
        sw[o + i] = typeof p.sway === 'function' ? p.sway(a.getY(i)) : p.sway;
      }
      o += a.count;
      p.g.dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('sway', new THREE.BufferAttribute(sw, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/** Randomly jitter vertices of a (non-indexed) geometry consistently across shared corners. */
export function jitter(geo: THREE.BufferGeometry, rnd: () => number, amt = 0.2) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position as THREE.BufferAttribute;
  const seen = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let f = seen.get(k);
    if (f === undefined) { f = 1 - amt + rnd() * amt * 2; seen.set(k, f); }
    p.setXYZ(i, p.getX(i) * f, p.getY(i) * f, p.getZ(i) * f);
  }
  return g;
}
