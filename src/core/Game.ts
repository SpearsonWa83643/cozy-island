import * as THREE from 'three/webgpu';
import { Physics } from './Physics';
import { Input, detectTouch } from './Input';
import type { System } from './System';
import { Renderer, type Quality } from '../render/Renderer';
import { Terrain, heightAt, biomeWeights, surfaceAt, snowAt, type Surface } from '../world/Terrain';
import { createSky, SUN_DIR, skyFog } from '../world/Sky';
import { createWater } from '../world/Water';
import { Flora, fadeCam, fadeTarget } from '../world/Flora';
import { Particles } from '../world/Particles';
import { Fauna } from '../world/Fauna';
import { ATMOS, BIOME_COUNT, BIOME_NAMES, Biome } from '../world/Biomes';
import { Player } from '../player/Player';
import { CameraRig } from '../player/CameraRig';
import { BuildMode } from '../build/BuildMode';
import { Hud } from '../ui/Hud';
import { TouchControls } from '../ui/TouchControls';
import { AudioEngine } from '../audio/Audio';

const SPAWN = new THREE.Vector2(0, 6);

export class Game {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 2000);
  renderer!: Renderer;
  physics = new Physics();
  input!: Input;
  systems: System[] = [];
  sun!: THREE.DirectionalLight;
  hemi!: THREE.HemisphereLight;
  sky!: THREE.Mesh;
  player!: Player;
  rig!: CameraRig;
  build!: BuildMode;
  flora!: Flora;
  particles!: Particles;
  fauna!: Fauna;
  hud!: Hud;
  terrain!: Terrain;
  audio = new AudioEngine();
  touch: TouchControls | null = null;
  readonly isTouch = detectTouch();
  /** debug/test helper */
  heightAt = heightAt;
  ready = false;
  /** blended biome weights around the player (smoothed) */
  biome = new Float32Array(BIOME_COUNT);
  private timer = new THREE.Timer();
  private elapsed = 0;
  private fog = new THREE.Fog('#cfe3ea', 70, 330);
  private shore = { dist: 30, pan: 0, t: 0 };
  private forest = { v: 0, t: 0 };
  private tmpW = new Float32Array(BIOME_COUNT);

  async start(container: HTMLElement) {
    const params = new URLSearchParams(location.search);
    const T0 = performance.now(); const lap = (n: string) => { if (params.has('debug')) console.info(`[startup] ${n}: ${(performance.now() - T0).toFixed(0)} ms`); };
    this.renderer = new Renderer(container, params.has('webgl'));
    this.input = new Input(this.renderer.renderer.domElement);
    await this.physics.init();

    // --- World ---
    this.scene.fog = this.fog;
    this.sky = createSky();
    this.scene.add(this.sky);
    this.hemi = new THREE.HemisphereLight('#cfe9ff', '#e9c995', 1.5);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff0d8', 3.0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -34; sc.right = 34; sc.top = 34; sc.bottom = -34; sc.near = 1; sc.far = 180;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);

    lap('physics');
    this.terrain = new Terrain();
    lap('terrain');
    this.scene.add(this.terrain.mesh);
    this.physics.addTrimesh(this.terrain.vertices, this.terrain.indices);
    this.scene.add(createWater(this.terrain.heightTexture));
    lap('water');
    this.flora = new Flora(this.physics, SPAWN);
    lap('flora');
    this.scene.add(this.flora.group);
    this.particles = new Particles();
    this.scene.add(this.particles.group);
    this.fauna = new Fauna(this.flora.flowerSpots);
    lap('fauna');
    this.scene.add(this.fauna.group);

    // --- Actors ---
    this.player = new Player(this.physics, this.input, new THREE.Vector3(SPAWN.x, 0, SPAWN.y));
    this.scene.add(this.player.object);
    this.rig = new CameraRig(this.camera, this.input, this.player);
    this.build = new BuildMode(this.scene, this.camera, this.terrain, this.physics, this.input, () => this.player.position);
    this.fauna.blockers = (x, z) => this.build.occupiedAt(x, z);

    // --- Audio hooks ---
    this.player.onStep = (p, run) => this.audio.footstep(this.surfaceUnder(p), run ? 1.25 : 1);
    this.player.onJump = () => this.audio.jump();
    this.player.onLand = (p, impact) => this.audio.land(this.surfaceUnder(p), impact);
    this.build.onPlace = (type) => this.audio.place(type);
    this.build.onRemove = () => this.audio.remove();
    this.fauna.school.onSplash = (x, z, big) => {
      const p = this.player.position, d = Math.hypot(x - p.x, z - p.z);
      this.audio.splash(this.panOf(x, z), Math.max(0, 1 - d / 30) * (big ? 0.5 : 0.3), big);
    };

    await this.renderer.init(this.scene, this.camera);
    lap('renderer');
    this.hud = new Hud(this.renderer.backendName);
    this.hud.bindAudio(this.audio);
    this.hud.onQuality = (q) => this.setQuality(q);
    this.hud.onSelect = (i) => { if (!this.build.active) this.build.toggle(true); this.build.select(i); };
    if (this.isTouch) {
      this.touch = new TouchControls(this.input, this.build);
      this.rig.sensitivity = 1.4;
    }
    this.build.onChange = () => {
      this.hud.setBuild(this.build.active, this.build.selected, this.build.count, this.build.removeMode);
      this.touch?.sync();
    };
    const q = params.get('q');
    this.setQuality(q === 'low' || q === 'high' ? q : this.isTouch ? 'low' : 'high');

    this.systems.push(this.player, this.rig, this.build, {
      update: (dt, t) => {
        this.flora.update(dt);
        this.fauna.update(dt, t, this.player.position);
        this.particles.update(dt, t, this.player.position);
      },
    });
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.resize();
    });

    biomeWeights(SPAWN.x, SPAWN.y, this.biome);
    this.step(1 / 60);
    this.rig.target.copy(this.player.position).add(new THREE.Vector3(0, 1.1, 0));
    this.rig.apply();
    await this.renderer.renderer.compileAsync(this.scene, this.camera);
    lap('compile');
    document.getElementById('loading')?.classList.add('hide');
    this.ready = true;
    this.renderer.renderer.setAnimationLoop(() => this.frame());
  }

  setQuality(q: Quality) {
    this.renderer.setQuality(q);
    const high = q === 'high';
    const size = high ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose(); this.sun.shadow.map = null;
    }
    const ext = high ? 34 : 26, sc = this.sun.shadow.camera;
    sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.updateProjectionMatrix();
    this.flora.setQuality(high);
    this.fauna.setQuality(high);
    this.particles.setQuality(high);
    this.hud.setQuality(q);
  }

  surfaceUnder(p: THREE.Vector3): Surface {
    if (p.y > heightAt(p.x, p.z) + 0.35) return 'wood'; // standing on a placed block
    return surfaceAt(p.x, p.z);
  }

  private panOf(x: number, z: number) {
    const c = this.camera.position, yaw = this.rig.yaw;
    const dx = x - c.x, dz = z - c.z, l = Math.hypot(dx, dz) || 1;
    return Math.max(-1, Math.min(1, (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / l));
  }

  /** nearest open water: 24 rays out to 36 m */
  private probeShore(p: THREE.Vector3) {
    let best = 36, bx = 0, bz = 0;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      for (let r = 1.5; r < best; r += 1.5) {
        if (heightAt(p.x + ca * r, p.z + sa * r) < -0.3) { if (r < best) { best = r; bx = ca; bz = sa; } break; }
      }
    }
    this.shore.dist = best;
    this.shore.pan = best < 36 ? this.panOf(this.camera.position.x + bx * 10, this.camera.position.z + bz * 10) : 0;
  }

  private probeForest(p: THREE.Vector3) {
    let n = 0;
    for (const t of this.flora.trees) { const d = Math.hypot(t.x - p.x, t.z - p.z); if (d < 14) n += 1 - d / 14; }
    this.forest.v = Math.min(1, n / 6);
  }

  private updateAtmosphere(dt: number, p: THREE.Vector3) {
    biomeWeights(p.x, p.z, this.tmpW);
    const k = Math.min(1, dt * 1.5);
    for (let i = 0; i < BIOME_COUNT; i++) this.biome[i] += (this.tmpW[i] - this.biome[i]) * k;
    const fog = new THREE.Color(0, 0, 0), sun = new THREE.Color(0, 0, 0), sky = new THREE.Color(0, 0, 0), gr = new THREE.Color(0, 0, 0);
    let near = 0, far = 0, sunI = 0, hemiI = 0;
    for (let i = 0; i < BIOME_COUNT; i++) {
      const w = this.biome[i], a = ATMOS[i];
      fog.r += a.fog.r * w; fog.g += a.fog.g * w; fog.b += a.fog.b * w;
      sun.r += a.sun.r * w; sun.g += a.sun.g * w; sun.b += a.sun.b * w;
      sky.r += a.sky.r * w; sky.g += a.sky.g * w; sky.b += a.sky.b * w;
      gr.r += a.ground.r * w; gr.g += a.ground.g * w; gr.b += a.ground.b * w;
      near += a.near * w; far += a.far * w; sunI += a.sunI * w; hemiI += a.hemiI * w;
    }
    // high on the peak the air clears
    const alt = Math.min(1, Math.max(0, (p.y - 5) / 6));
    this.fog.color.copy(fog); this.fog.near = near + alt * 40; this.fog.far = far + alt * 60;
    skyFog.value.copy(fog);
    this.sun.color.copy(sun); this.sun.intensity = sunI;
    this.hemi.color.copy(sky); this.hemi.groundColor.copy(gr); this.hemi.intensity = hemiI;
    let best = 0; for (let i = 1; i < BIOME_COUNT; i++) if (this.biome[i] > this.biome[best]) best = i;
    this.hud.setBiome(BIOME_NAMES[best]);
  }

  /** Advance simulation by dt (also used by tests to step deterministically). */
  step(dt: number) {
    this.elapsed += dt;
    if (this.input.pressed.has('b')) this.build.toggle();
    for (const s of this.systems) s.update(dt, this.elapsed);
    this.physics.step(dt);
    this.sky.position.copy(this.camera.position);
    const p = this.player.position;
    this.sun.target.position.set(p.x, 0, p.z);
    this.sun.position.copy(this.sun.target.position).addScaledVector(SUN_DIR, 80);
    // vegetation between camera and player dithers out
    fadeCam.value.copy(this.camera.position);
    fadeTarget.value.set(p.x, p.y + 1.0, p.z);

    if (this.hud) this.updateAtmosphere(dt, p);
    this.shore.t -= dt; this.forest.t -= dt;
    if (this.shore.t <= 0) { this.probeShore(p); this.shore.t = 0.3; }
    if (this.forest.t <= 0) { this.probeForest(p); this.forest.t = 0.5; }
    const w = this.biome;
    this.audio.update({
      biome: w, shoreDist: this.shore.dist, shorePan: this.shore.pan, forest: this.forest.v,
      grass: (w[Biome.Meadow] + w[Biome.Autumn] * 0.7 + w[Biome.Marsh] * 0.8 + w[Biome.Tropical] * 0.5) * (1 - snowAt(p.x, p.z)),
      altitude: p.y,
    });
    this.input.endFrame();
  }

  private frame() {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.1);
    this.step(dt);
    this.renderer.render(this.scene, this.camera);
    this.hud.tick();
  }
}
