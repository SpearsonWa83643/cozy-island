import RAPIER from '@dimforge/rapier3d-compat';

export type Rapier = typeof RAPIER;

/** Thin wrapper around a Rapier world. */
export class Physics {
  world!: RAPIER.World;
  R!: Rapier;
  async init() {
    await RAPIER.init();
    this.R = RAPIER;
    this.world = new RAPIER.World({ x: 0, y: -20, z: 0 });
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
  remove(c: RAPIER.Collider) { this.world.removeCollider(c, false); }
  step(dt: number) {
    this.world.timestep = Math.min(dt, 1 / 30);
    this.world.step();
  }
}
