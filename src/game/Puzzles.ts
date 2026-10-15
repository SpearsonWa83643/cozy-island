import * as THREE from 'three/webgpu';
import { heightAt, surfaceAt, type Surface } from '../world/Terrain';
import { Baker } from '../world/Baker';
import type { Flora } from '../world/Flora';
import type { AudioEngine } from '../audio/Audio';
import type { WearDef } from './Items';
import { WEARABLES } from './Items';

const SOFT: Surface[] = ['grass', 'sand', 'snow', 'mud', 'leaves'];
const FOOT_CAP = 48;
const FOOT_LIFE = 4.2; // seconds until fully faded
const STONE_SEQ = [0, 2, 1, 3]; // tap/step order

type Foot = { x: number; z: number; y: number; yaw: number; age: number; live: boolean; left: boolean };
type Stone = { x: number; z: number; y: number; lit: boolean; mesh: THREE.Mesh; glow: THREE.Mesh };

/**
 * Soft-ground footprints + a cozy pressure-stone sequence puzzle.
 * Step stones in the glowing order to reveal a small reward chest.
 */
export class Puzzles {
  group = new THREE.Group();
  /** tests */
  steps = 0;
  stoneHits = 0;
  solved = false;

  private feet: Foot[] = [];
  private footMesh: THREE.InstancedMesh;
  private footI = 0;
  private lastFx = 0; private lastFz = 0;
  private leftNext = true;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion();
  private e = new THREE.Euler(); private s = new THREE.Vector3(); private v = new THREE.Vector3();

  stones: Stone[] = [];
  /** @internal test */ input: number[] = [];
  /** @internal test */ stoneCool = new Map<number, number>();
  private now = 0;
  /** @internal test */ chest!: THREE.Group;
  /** @internal test */ chestOpen = false;
  /** @internal test */ chestRevealed = false;
  private hintT = 0;
  private sign!: THREE.Group;
  private resetRock!: THREE.Mesh;
  private onReward: (pos: THREE.Vector3) => void;
  private toast: (h: string, ms?: number) => void;
  private audio: AudioEngine;

  constructor(
    flora: Flora,
    audio: AudioEngine,
    toast: (h: string, ms?: number) => void,
    onReward: (pos: THREE.Vector3) => void,
    alreadySolved = false,
  ) {
    this.audio = audio;
    this.toast = toast;
    this.onReward = onReward;
    this.group.name = 'puzzles';
    this.solved = alreadySolved;

    // footprints: soft oval discs
    const g = new THREE.CircleGeometry(0.11, 10).toNonIndexed();
    g.rotateX(-Math.PI / 2);
    g.scale(0.7, 1, 1.25);
    const mat = new THREE.MeshBasicNodeMaterial({
      color: '#3a2a18', transparent: true, opacity: 0.35, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2,
    });
    this.footMesh = new THREE.InstancedMesh(g, mat, FOOT_CAP);
    this.footMesh.frustumCulled = false;
    this.footMesh.renderOrder = 2;
    for (let i = 0; i < FOOT_CAP; i++) {
      this.feet.push({ x: 0, z: 0, y: 0, yaw: 0, age: 99, live: false, left: false });
      this.footMesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
    }
    this.group.add(this.footMesh);

    this.buildStones(flora);
    if (alreadySolved) {
      this.chestRevealed = true; this.chestOpen = true;
      this.chest.visible = true;
      this.chest.scale.setScalar(1);
      for (const s of this.stones) this.setLit(s, true);
    }
  }

  private buildStones(flora: Flora) {
    // meadow clearing east of spawn
    let cx = 8.5, cz = 4.5;
    for (let tries = 0; tries < 80; tries++) {
      const a = tries * 0.7, d = 7 + (tries % 5) * 0.6;
      const x = Math.cos(a) * d, z = 6 + Math.sin(a) * d;
      const h = heightAt(x, z);
      if (h < 0.9 || h > 4) continue;
      if (flora.trees.some((t) => Math.hypot(t.x - x, t.z - z) < 2.2)) continue;
      cx = x; cz = z; break;
    }
    const stoneGeo = stoneMeshGeo();
    const litMat = new THREE.MeshStandardNodeMaterial({ color: '#ffe08a', emissive: new THREE.Color('#ffb84d'), emissiveIntensity: 0.55, roughness: 0.55, flatShading: true });
    const dimMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    const glowGeo = new THREE.CircleGeometry(0.55, 20).rotateX(-Math.PI / 2);
    const glowMat = new THREE.MeshBasicNodeMaterial({ color: '#ffe08a', transparent: true, opacity: 0, depthWrite: false });

    const offsets: [number, number][] = [[-1.3, -1.1], [1.25, -1.0], [-1.15, 1.2], [1.35, 1.15]];
    offsets.forEach(([ox, oz], i) => {
      const x = cx + ox, z = cz + oz, y = heightAt(x, z);
      const mesh = new THREE.Mesh(stoneGeo, dimMat.clone());
      mesh.position.set(x, y - 0.02, z);
      mesh.rotation.y = i * 0.9;
      mesh.scale.setScalar(0.95 + (i % 2) * 0.08);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData.i = i;
      const glow = new THREE.Mesh(glowGeo, glowMat.clone());
      glow.position.set(x, y + 0.04, z);
      glow.visible = false;
      this.group.add(mesh, glow);
      this.stones.push({ x, z, y, lit: false, mesh, glow });
      // keep litMat reference on mesh for swapping
      mesh.userData.dim = mesh.material;
      mesh.userData.lit = litMat;
    });

    // clue sign
    this.sign = makeSign();
    this.sign.position.set(cx, heightAt(cx, cz) - 0.02, cz - 2.4);
    this.group.add(this.sign);

    // reset rock
    this.resetRock = new THREE.Mesh(stoneGeo, dimMat.clone());
    this.resetRock.position.set(cx + 2.6, heightAt(cx + 2.6, cz + 0.2) - 0.02, cz + 0.2);
    this.resetRock.scale.set(0.7, 0.55, 0.7);
    this.resetRock.castShadow = true;
    this.group.add(this.resetRock);

    // reward chest (hidden until solved)
    this.chest = makeChest();
    this.chest.position.set(cx, heightAt(cx, cz + 2.2), cz + 2.2);
    this.chest.visible = false;
    this.chest.scale.set(1, 0.01, 1);
    this.group.add(this.chest);
  }

  /** Called from player onStep when walking on soft ground. */
  footstep(p: THREE.Vector3, yaw: number, surface: Surface, running: boolean) {
    if (!SOFT.includes(surface)) return;
    if (Math.hypot(p.x - this.lastFx, p.z - this.lastFz) < (running ? 0.55 : 0.42)) return;
    this.lastFx = p.x; this.lastFz = p.z;
    const side = this.leftNext ? -1 : 1;
    this.leftNext = !this.leftNext;
    const ox = Math.cos(yaw) * 0.12 * side, oz = -Math.sin(yaw) * 0.12 * side;
    const f = this.feet[this.footI];
    f.x = p.x + ox; f.z = p.z + oz; f.y = heightAt(f.x, f.z) + 0.03;
    f.yaw = yaw; f.age = 0; f.live = true; f.left = side < 0;
    this.footI = (this.footI + 1) % FOOT_CAP;
    this.steps++;
  }

  /** Player position each frame: pressure stones + chest open. */
  sense(p: THREE.Vector3, dt: number) {
    this.now += dt;
    this.hintT -= dt;
    // reset rock
    if (Math.hypot(p.x - this.resetRock.position.x, p.z - this.resetRock.position.z) < 0.85) {
      if (this.input.length || this.stones.some((s) => s.lit)) this.reset();
    }
    if (this.solved && this.chestRevealed && !this.chestOpen) {
      if (Math.hypot(p.x - this.chest.position.x, p.z - this.chest.position.z) < 1.4) this.openChest();
      return;
    }
    if (this.solved) return;
    for (let i = 0; i < this.stones.length; i++) {
      const s = this.stones[i];
      if (Math.hypot(p.x - s.x, p.z - s.z) < 0.7) this.press(i);
    }
  }

  private press(i: number) {
    const until = this.stoneCool.get(i) ?? 0;
    if (until > this.now) return;
    this.stoneCool.set(i, this.now + 0.85);
    const expect = STONE_SEQ[this.input.length];
    // debounce: same stone while standing after success
    if (this.input.length && this.input[this.input.length - 1] === i) return;
    this.stoneHits++;
    if (i !== expect) {
      this.audio.pop(0.5);
      this.toast('🪨 Not that one — watch the order!', 1600);
      this.reset(false);
      // flash the next correct one briefly
      const next = this.stones[STONE_SEQ[0]];
      this.pulse(next);
      return;
    }
    this.input.push(i);
    this.setLit(this.stones[i], true);
    this.audio.pop(1.2 + this.input.length * 0.15);
    if (this.input.length === STONE_SEQ.length) this.solve();
    else if (this.hintT <= 0) { this.hintT = 8; /* quiet */ }
  }

  private pulse(s: Stone) {
    s.glow.visible = true;
    (s.glow.material as THREE.MeshBasicNodeMaterial).opacity = 0.55;
  }

  private setLit(s: Stone, on: boolean) {
    s.lit = on;
    s.mesh.material = on ? (s.mesh.userData.lit as THREE.Material) : (s.mesh.userData.dim as THREE.Material);
    s.glow.visible = on;
    (s.glow.material as THREE.MeshBasicNodeMaterial).opacity = on ? 0.45 : 0;
  }

  reset(toast = true) {
    this.input = [];
    for (const s of this.stones) this.setLit(s, false);
    if (toast && !this.solved) {
      this.audio.pop(1.6);
      this.toast('🪨 Stones reset — try the path again', 1800);
    }
  }

  private solve() {
    this.solved = true;
    this.chestRevealed = true;
    this.chest.visible = true;
    this.audio.chest(1);
    this.toast('✨ The stones glow! A little chest appeared — walk over and open it.', 3200);
  }

  private openChest() {
    if (this.chestOpen) return;
    this.chestOpen = true;
    this.audio.chest(2);
    this.onReward(this.chest.position.clone().add(new THREE.Vector3(0, 0.6, 0)));
  }

  /** Nearest interactable for Gameplay prompts (chest / reset). */
  target(p: THREE.Vector3): { kind: 'open' | 'reset'; label: string; icon: string; key: string; pos: THREE.Vector3; run: () => void } | null {
    if (this.chestRevealed && !this.chestOpen && Math.hypot(p.x - this.chest.position.x, p.z - this.chest.position.z) < 1.6) {
      return {
        kind: 'open', icon: '🎁', label: 'Open', key: 'open:stonechest',
        pos: this.chest.position.clone().add(new THREE.Vector3(0, 0.8, 0)),
        run: () => this.openChest(),
      };
    }
    if (!this.solved && Math.hypot(p.x - this.resetRock.position.x, p.z - this.resetRock.position.z) < 1.3) {
      return {
        kind: 'reset', icon: '🪨', label: 'Reset', key: 'reset:stones',
        pos: this.resetRock.position.clone().add(new THREE.Vector3(0, 0.5, 0)),
        run: () => this.reset(true),
      };
    }
    return null;
  }

  update(dt: number) {
    // footprints fade
    let nLive = 0;
    for (let i = 0; i < FOOT_CAP; i++) {
      const f = this.feet[i];
      if (!f.live) { this.footMesh.setMatrixAt(i, this.m.makeScale(0, 0, 0)); continue; }
      f.age += dt;
      const u = Math.min(1, f.age / FOOT_LIFE);
      if (u >= 1) { f.live = false; this.footMesh.setMatrixAt(i, this.m.makeScale(0, 0, 0)); continue; }
      const sc = 1 - u * 0.25;
      const fade = 1 - u;
      this.q.setFromEuler(this.e.set(0, f.yaw + (f.left ? 0.08 : -0.08), 0));
      this.s.set(sc * fade, 1, sc * fade);
      this.footMesh.setMatrixAt(i, this.m.compose(this.v.set(f.x, f.y, f.z), this.q, this.s));
      nLive++;
    }
    this.footMesh.instanceMatrix.needsUpdate = true;
    (this.footMesh.material as THREE.MeshBasicNodeMaterial).opacity = 0.32;

    // chest pop-in
    if (this.chestRevealed && this.chest.scale.y < 0.99) {
      const sy = Math.min(1, this.chest.scale.y + dt * 2.2);
      this.chest.scale.set(1, sy, 1);
    }
    // glow breathe on lit stones + hint next
    for (const s of this.stones) {
      if (!s.lit) continue;
      const mat = s.glow.material as THREE.MeshBasicNodeMaterial;
      mat.opacity = 0.35 + Math.sin(performance.now() * 0.004 + s.x) * 0.12;
    }
    if (!this.solved && this.input.length < STONE_SEQ.length) {
      const next = this.stones[STONE_SEQ[this.input.length]];
      if (next && !next.lit) {
        next.glow.visible = true;
        const mat = next.glow.material as THREE.MeshBasicNodeMaterial;
        mat.opacity = 0.18 + Math.sin(performance.now() * 0.005) * 0.12;
      }
    }
  }
}

function stoneMeshGeo(): THREE.BufferGeometry {
  const b = new Baker(); b.ao = true;
  b.add(new THREE.CylinderGeometry(0.42, 0.48, 0.18, 8), '#9a98a8', [0, 0.09, 0]);
  b.add(new THREE.SphereGeometry(0.4, 8, 5, 0, 6.28, 0, 1.2), '#b0aeb8', [0, 0.16, 0], [0, 0, 0], [1, 0.45, 1]);
  return b.build();
}

function makeSign(): THREE.Group {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.1, 6), new THREE.MeshStandardNodeMaterial({ color: '#7a5232', flatShading: true }));
  post.position.y = 0.55;
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.06), new THREE.MeshStandardNodeMaterial({ color: '#c9a06a', flatShading: true }));
  board.position.set(0, 1.05, 0.02);
  g.add(post, board);
  g.castShadow = true;
  return g;
}

function makeChest(): THREE.Group {
  const g = new THREE.Group();
  const b = new Baker(); b.ao = false;
  b.add(new THREE.BoxGeometry(0.55, 0.32, 0.4), '#b87a45', [0, 0.16, 0]);
  b.add(new THREE.BoxGeometry(0.57, 0.08, 0.42), '#9a6234', [0, 0.36, 0]);
  b.add(new THREE.BoxGeometry(0.08, 0.12, 0.06), '#ffd84d', [0, 0.22, 0.22]);
  const mesh = new THREE.Mesh(b.build(), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.7, flatShading: true }));
  mesh.castShadow = true;
  g.add(mesh);
  return g;
}

/** Pick a not-yet-owned common/uncommon wearable for the stone chest. */
export function stoneChestLoot(owned: Record<string, number>): WearDef | null {
  const pool = WEARABLES.filter((w) => w.rarity <= 1 && !owned[w.id]);
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}
