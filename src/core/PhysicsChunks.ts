import type * as RapierNS from '@dimforge/rapier3d';
import type { Physics } from './Physics';
import { PHYS_CHUNK_SIZE, PHYS_RING } from '../world/config';

interface Tile { ci: number; cj: number; i0: number; i1: number; j0: number; j1: number; col: RapierNS.Collider | null }

/**
 * Big island 4/7 (Order 36): terrain physics streams with the player. The height grid is cut into
 * ~PHYS_CHUNK_SIZE m tiles, and only the (2·PHYS_RING+1)² ring around the player's tile has a Rapier
 * heightfield collider. Tiles are vertex-aligned and share their edge rows, so there is no seam to
 * fall through at a border. Build pieces, trees, rocks and landmarks keep their own colliders.
 * Flying mounts never touch the terrain collider (they follow the analytic height function).
 * Call `update()` with the player's position before every physics step.
 */
export class PhysicsChunks {
  readonly tiles: Tile[] = [];
  readonly per: number;
  private cx = Number.NaN; private cz = Number.NaN;
  /** colliders created / removed since start (debug + tests) */
  stats = { added: 0, removed: 0 };
  constructor(private physics: Physics, private grid: Float32Array, private seg: number, private size: number, tileSize = PHYS_CHUNK_SIZE, private ring = PHYS_RING) {
    this.per = Math.max(1, Math.round(size / tileSize));
    const cuts = Array.from({ length: this.per + 1 }, (_, k) => Math.round((k * seg) / this.per));
    for (let cj = 0; cj < this.per; cj++) for (let ci = 0; ci < this.per; ci++)
      this.tiles.push({ ci, cj, i0: cuts[ci], i1: cuts[ci + 1], j0: cuts[cj], j1: cuts[cj + 1], col: null });
  }
  get active() { let n = 0; for (const t of this.tiles) if (t.col) n++; return n; }
  /** tile column/row containing world (x, z), clamped to the grid */
  tileOf(x: number, z: number) {
    const f = (v: number) => Math.max(0, Math.min(this.per - 1, Math.floor(((v + this.size / 2) / this.size) * this.per)));
    return { ci: f(x), cj: f(z) };
  }
  update(x: number, z: number, force = false) {
    const { ci, cj } = this.tileOf(x, z);
    if (!force && ci === this.cx && cj === this.cz) return;
    this.cx = ci; this.cz = cj;
    // add first, then remove: the ground under the player is never missing for a step
    for (const t of this.tiles) {
      const near = Math.abs(t.ci - ci) <= this.ring && Math.abs(t.cj - cj) <= this.ring;
      if (near && !t.col) { t.col = this.build(t); this.stats.added++; }
    }
    for (const t of this.tiles) {
      const near = Math.abs(t.ci - ci) <= this.ring && Math.abs(t.cj - cj) <= this.ring;
      if (!near && t.col) { const b = t.col.parent(); if (b) this.physics.world.removeRigidBody(b); else this.physics.remove(t.col); t.col = null; this.stats.removed++; }
    }
  }
  private build(t: Tile) {
    const n = this.seg + 1, step = this.size / this.seg;
    const nx = t.i1 - t.i0, nz = t.j1 - t.j0; // segments in this tile
    const heights = new Float32Array((nx + 1) * (nz + 1));
    // Rapier: column-major, rows along z, cols along x
    for (let ix = 0; ix <= nx; ix++) for (let iz = 0; iz <= nz; iz++) heights[iz + ix * (nz + 1)] = this.grid[(t.j0 + iz) * n + (t.i0 + ix)];
    const w = nx * step, d = nz * step;
    const cx = -this.size / 2 + (t.i0 + nx / 2) * step, cz = -this.size / 2 + (t.j0 + nz / 2) * step;
    const R = this.physics.R;
    const body = this.physics.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(cx, 0, cz));
    return this.physics.world.createCollider(R.ColliderDesc.heightfield(nz, nx, heights, { x: w, y: 1, z: d }), body);
  }
}
