import type * as RapierNS from '@dimforge/rapier3d';

export type Rapier = typeof RapierNS;

/** Thin wrapper around a Rapier world. WASM loads as its own file via vite-plugin-wasm. */
export class Physics {
  world!: RapierNS.World;
  R!: Rapier;
  async init() {
    // Dynamic import so load-timing's "physics" mark includes WASM fetch+init.
    const mod = await import('@dimforge/rapier3d');
    this.R = mod;
    this.world = new mod.World({ x: 0, y: -20, z: 0 });
  }
  addTrimesh(vertices: Float32Array, indices: Uint32Array) {
    const body = this.world.createRigidBody(this.R.RigidBodyDesc.fixed());
    return this.world.createCollider(this.R.ColliderDesc.trimesh(vertices, indices), body);
  }
  addBox(x: number, y: number, z: number, hx: number, hy: number, hz: number, rotY = 0) {
    const q = { x: 0, y: Math.sin(rotY / 2), z: 0, w: Math.cos(rotY / 2) };
    const desc = this.R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setRotation(q);
    return this.world.createCollider(desc);
  }
  addCylinder(x: number, y: number, z: number, halfH: number, r: number) {
    return this.world.createCollider(this.R.ColliderDesc.cylinder(halfH, r).setTranslation(x, y, z));
  }
  addBall(x: number, y: number, z: number, r: number) {
    return this.world.createCollider(this.R.ColliderDesc.ball(r).setTranslation(x, y, z));
  }
  remove(c: RapierNS.Collider) { this.world.removeCollider(c, false); }
  step(dt: number) {
    this.world.timestep = Math.min(dt, 1 / 30);
    this.world.step();
  }
}
