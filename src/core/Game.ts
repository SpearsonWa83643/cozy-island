import * as THREE from 'three/webgpu';
import { Physics } from './Physics';
import { Input, detectTouch } from './Input';
import type { System } from './System';
import { Renderer, type Quality } from '../render/Renderer';
import { Terrain, heightAt, biomeWeights, surfaceAt, snowAt, type Surface } from '../world/Terrain';
import { createSky, SUN_DIR, skyFog, skyU, SKY_CLASSIC } from '../world/Sky';
import { theme, themeEvents, applyThemeCss, setTheme, themeForDate, resolveTheme, themeSource } from '../theme/theme';
import { Dress } from '../theme/Dress';
import { createWater } from '../world/Water';
import { Flora, fadeCam, fadeTarget } from '../world/Flora';
import { Particles } from '../world/Particles';
import { Fauna } from '../world/Fauna';
import { Reef } from '../world/Reef';
import { Cave } from '../world/Cave';
import { offshore, atOffshore, shoreRadius } from '../world/Shore';
import { ATMOS, BIOME_COUNT, BIOME_NAMES, Biome } from '../world/Biomes';
import { Player } from '../player/Player';
import { CameraRig } from '../player/CameraRig';
import { BuildMode } from '../build/BuildMode';
import { Hud } from '../ui/Hud';
import { TouchControls } from '../ui/TouchControls';
import { AudioEngine } from '../audio/Audio';
import { Gameplay } from '../game/Gameplay';

const SPAWN = new THREE.Vector2(0, 6);

const CAVE_FOG = new THREE.Color('#0b0912'), CAVE_SUN = new THREE.Color('#ffd9a8'), CAVE_SKY = new THREE.Color('#6a5a9a'), CAVE_GR = new THREE.Color('#1a2a30');

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
  reef!: Reef;
  cave!: Cave;
  /** 0..1 eased blend toward the cave atmosphere */
  caveK = 0;
  private hiddenForCave: THREE.Object3D[] = [];
  hud!: Hud;
  terrain!: Terrain;
  audio = new AudioEngine();
  touch: TouchControls | null = null;
  play!: Gameplay;
  readonly isTouch = detectTouch();
  /** debug/test helper */
  heightAt = heightAt;
  coast = { offshore, atOffshore, shoreRadius };
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
    this.terrain.bakeAO(this.flora.aoPoints);
    lap('flora');
    this.cave = new Cave(this.physics);
    this.scene.add(this.cave.outside, this.cave.interior);
    lap('cave');
    this.scene.add(this.flora.group);
    this.particles = new Particles();
    this.scene.add(this.particles.group);
    this.fauna = new Fauna(this.flora.flowerSpots);
    lap('fauna');
    this.scene.add(this.fauna.group);
    this.reef = new Reef();
    this.scene.add(this.reef.group);
    lap('reef');

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
    this.player.onSwimStart = (p) => { this.audio.splash(0, 0.55, true); this.reef.ring(p.x, p.z, 1.1, 1.3); this.reef.ring(p.x, p.z, 0.6, 0.9); };
    this.player.onSwimEnd = (p) => { this.audio.splash(0, 0.25, false); this.reef.ring(p.x, p.z, 0.7, 1); };
    this.player.onStroke = (p, mov) => { this.audio.stroke(mov); if (mov > 0.2) this.reef.ring(p.x, p.z, 0.55 + mov * 0.2, 1.1); };
    this.reef.onSplash = (x, z, big) => {
      const p = this.player.position, d = Math.hypot(x - p.x, z - p.z);
      this.audio.splash(this.panOf(x, z), Math.max(0, 1 - d / 40) * (big ? 0.55 : 0.3), big);
    };
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
    this.hud.bindHand(this.input);

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
    this.play = new Gameplay(this, SPAWN);
    lap('gameplay');
    applyThemeCss();
    this.hud.bindDock(() => !!this.play.save.data.panelsOpen, (o) => { this.play.save.data.panelsOpen = o; this.play.save.touch(); });
    const syncBuild = () => { this.hud.syncBuildables((i) => this.build.available(i)); if (!this.build.available(this.build.selected)) this.build.select(0); };
    syncBuild(); themeEvents.on(syncBuild);
    this.dress = new Dress(this);
    this.scene.add(this.dress.group);
    themeEvents.on(() => this.dress.rebuild());
    lap('dress');
    const q = params.get('q');
    this.setQuality(q === 'low' || q === 'high' ? q : this.isTouch ? 'low' : 'high');

    this.systems.push(this.player, this.rig, this.build, {
      update: (dt, t) => {
        this.flora.update(dt);
        this.fauna.update(dt, t, this.play.followCtx);
        this.particles.update(dt, t, this.player.position);
        this.reef.update(dt, t, this.player.position, this.player.swimming, Math.min(1, this.player.speed / 2.5));
    this.cave.update(dt, t, this.player.position);
        this.dress.update(dt, t);
      },
    }, this.play);
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
    this.reef.setQuality(high);
    this.play?.forage.setQuality(high);
    this.cave?.setQuality(high);
    this.hud.setQuality(q);
  }

  surfaceUnder(p: THREE.Vector3): Surface {
    if (this.cave?.inside) return 'rock';
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

  /** go underground (or come back): only one side is drawn; the player/camera use the cave's floor and ceiling */
  setCave(on: boolean) {
    const c = this.cave;
    if (c.inside === on) return;
    c.inside = on;
    this.player.ground = on ? (x, z) => c.floorAt(x, z) : heightAt;
    this.player.inCave = on;
    this.rig.cave = on ? c : null;
    if (on) {
      const keep = new Set<THREE.Object3D>([c.interior, this.player.object, this.hemi, this.sun, this.sun.target, this.camera]);
      if (this.play) { keep.add(this.play.forage.group); keep.add(this.play.walk.marker); }
      this.hiddenForCave = this.scene.children.filter((o) => o.visible && !keep.has(o));
      for (const o of this.hiddenForCave) o.visible = false;
      c.interior.visible = true;
      this.caveK = Math.max(this.caveK, 0.85); // you arrive with eyes already adjusting
    } else {
      for (const o of this.hiddenForCave) o.visible = true;
      this.hiddenForCave = [];
      c.interior.visible = false;
      this.caveK = Math.min(this.caveK, 0.15);
    }
    this.scene.background = on ? new THREE.Color('#06050a') : null;
  }

  dress!: Dress;
  /** theme system handle (tests / console) */
  themes = { current: () => theme, source: () => themeSource, set: setTheme, forDate: (iso: string) => themeForDate(new Date(iso + 'T12:00:00')), resolve: () => resolveTheme() };
  /** eased 0..1 strength of the active theme's sky (so a live switch fades rather than pops) */
  themeK = 0;
  private skyTarget = { zenith: new THREE.Color(), mid: new THREE.Color(), low: new THREE.Color(), horizon: new THREE.Color() };
  private applyThemeSky(dt: number) {
    const ts = theme.sky;
    this.themeK += ((ts ? ts.blend : 0) - this.themeK) * Math.min(1, dt * 1.2);
    const k = this.themeK, T = this.skyTarget;
    for (const key of ['zenith', 'mid', 'low', 'horizon'] as const) {
      T[key].set(SKY_CLASSIC[key]); if (ts) T[key].lerp(new THREE.Color(ts[key]), k);
      skyU[key].value.copy(T[key]);
    }
    skyU.sunGlow.value = 1 + ((ts?.sunGlow ?? 1) - 1) * k; skyU.moon.value = (ts?.moon ?? 0) * k; skyU.stars.value = (ts?.stars ?? 0) * k;
    if (!ts || k < 0.001) return;
    this.fog.color.lerp(new THREE.Color(ts.fog), k); this.fog.near += (ts.fogNear - this.fog.near) * k; this.fog.far += (ts.fogFar - this.fog.far) * k;
    skyFog.value.copy(this.fog.color);
    this.sun.color.lerp(new THREE.Color(ts.sun), k); this.sun.intensity += (ts.sunI - this.sun.intensity) * k;
    this.hemi.color.lerp(new THREE.Color(ts.hemiSky), k); this.hemi.groundColor.lerp(new THREE.Color(ts.hemiGround), k); this.hemi.intensity += (ts.hemiI - this.hemi.intensity) * k;
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
    this.applyThemeSky(dt);
    // underground: deep violet fog, a dim cool fill and a faint warm key (the crystals' glow is baked into the rock)
    this.caveK += ((this.cave?.inside ? 1 : 0) - this.caveK) * Math.min(1, dt * 2.5);
    const ck = this.caveK;
    if (ck > 0.001) {
      this.fog.color.lerp(CAVE_FOG, ck); this.fog.near += (6 - this.fog.near) * ck; this.fog.far += (32 - this.fog.far) * ck;
      skyFog.value.copy(this.fog.color);
      this.sun.color.lerp(CAVE_SUN, ck); this.sun.intensity += (0.45 - this.sun.intensity) * ck;
      this.hemi.color.lerp(CAVE_SKY, ck); this.hemi.groundColor.lerp(CAVE_GR, ck); this.hemi.intensity += (0.55 - this.hemi.intensity) * ck;
    }
    if (this.cave?.inside) { this.hud.setBiome('Crystal Cave'); return; }
    let best = 0; for (let i = 1; i < BIOME_COUNT; i++) if (this.biome[i] > this.biome[best]) best = i;
    this.hud.setBiome(BIOME_NAMES[best]);
  }

  /** Advance simulation by dt (also used by tests to step deterministically). */
  step(dt: number) {
    this.elapsed += dt;
    // friend close-up: the world is paused; only the studio animates
    if (this.play?.friend.open) { this.play.friend.update(dt); this.input.endFrame(); return; }
    if (this.input.pressed.has('b') && !this.cave.inside) this.build.toggle();
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
      swim: this.player.swimBlend,
      cave: this.caveK,
      reef: Math.max(0, 1 - Math.abs(this.player.offshoreDist - 7) / 12) * (this.player.depth > 0.4 ? 1 : 0),
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
