import * as THREE from 'three/webgpu';
import { Physics } from './Physics';
import { Input, detectTouch } from './Input';
import type { System } from './System';
import { Renderer, type Quality } from '../render/Renderer';
import { Terrain, heightAt, biomeWeights, surfaceAt, snowAt, type Surface, WORLD_SIZE } from '../world/Terrain';
import { createSky, SUN_DIR, skyFog, skyU, SKY_CLASSIC } from '../world/Sky';
import { theme, themeEvents, applyThemeCss, setTheme, themeForDate, resolveTheme, themeSource } from '../theme/theme';
import { Dress } from '../theme/Dress';
import { createWater } from '../world/Water';
import { Loader, nextPaint } from '../ui/Loader';
import { Flora, fadeCam, fadeTarget } from '../world/Flora';
import { Particles } from '../world/Particles';
import { Fauna } from '../world/Fauna';
import { Reef } from '../world/Reef';
import { Cave } from '../world/Cave';
import { offshore, atOffshore, shoreRadius } from '../world/Shore';
import { ATMOS, BIOME_COUNT, BIOME_NAMES, Biome } from '../world/Biomes';
import { Player } from '../player/Player';
import { CameraRig } from '../player/CameraRig';
import { Mount } from '../player/Mount';
import type { BuildMode } from '../build/BuildMode';
import { MountPicker } from '../ui/MountPicker';
import { isMountUnlocked, mountById, unlockedMounts } from '../player/MountDefs';
import { Hud } from '../ui/Hud';
import { TouchControls } from '../ui/TouchControls';
import { AudioEngine } from '../audio/Audio';
import { Gameplay } from '../game/Gameplay';
import { beginLoadTiming, type LoadTiming } from './LoadTiming';

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
  mount!: Mount;
  build: BuildMode | null = null;
  private buildP: Promise<BuildMode> | null = null;
  private buildWait: ((b: BuildMode) => void)[] = [];
  mountPicker!: MountPicker;
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
  loadTiming!: LoadTiming;
  /** blended biome weights around the player (smoothed) */
  biome = new Float32Array(BIOME_COUNT);
  private timer = new THREE.Timer();
  private elapsed = 0;
  private fog = new THREE.Fog('#cfe3ea', 70, 330);
  private shore = { dist: 30, pan: 0, t: 0 };
  private forest = { v: 0, t: 0 };
  private tmpW = new Float32Array(BIOME_COUNT);
  private water!: THREE.Mesh;

  async start(container: HTMLElement) {
    const params = new URLSearchParams(location.search);
    this.loadTiming = beginLoadTiming();
    const loader = new Loader();
    loader.set(0.03, 'start');
    const P: Record<string, number> = { physics: 0.1, terrain: 0.18, water: 0.24, flora: 0.33, cave: 0.38, fauna: 0.42, reef: 0.48, renderer: 0.55, gameplay: 0.59, dress: 0.63 };
    /** mark + advance the loading bar; `paint` yields so the bar visibly moves (only at a few heavy points). */
    const lap = async (n: string, paint = false) => { this.loadTiming.mark(n); loader.set(P[n] ?? 0, n); if (paint) await nextPaint(); };
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

    await lap('physics', true);
    this.terrain = new Terrain();
    await lap('terrain');
    this.scene.add(this.terrain.mesh);
    if (params.has('trimesh')) this.physics.addTrimesh(this.terrain.vertices, this.terrain.indices);
    else this.physics.addHeightfield(this.terrain.heights, this.terrain.segments, WORLD_SIZE);
    this.water = createWater(this.terrain.heightTexture);
    this.scene.add(this.water);
    await lap('water');
    this.flora = new Flora(this.physics, SPAWN);
    this.terrain.bakeAO(this.flora.aoPoints);
    await lap('flora', true);
    this.cave = new Cave(this.physics);
    this.scene.add(this.cave.outside, this.cave.interior);
    await lap('cave');
    this.scene.add(this.flora.group);
    this.particles = new Particles();
    this.scene.add(this.particles.group);
    this.fauna = new Fauna(this.flora.flowerSpots);
    await lap('fauna');
    this.scene.add(this.fauna.group);
    this.reef = new Reef();
    this.scene.add(this.reef.group);
    await lap('reef', true);

    // --- Actors ---
    this.player = new Player(this.physics, this.input, new THREE.Vector3(SPAWN.x, 0, SPAWN.y));
    this.scene.add(this.player.object);
    this.rig = new CameraRig(this.camera, this.input, this.player);
    this.fauna.blockers = (x, z) => this.build?.occupiedAt(x, z) ?? false;

    // --- Audio hooks ---
    this.player.onStep = (p, run) => {
      const surf = this.surfaceUnder(p);
      this.audio.footstep(surf, run ? 1.25 : 1);
      this.play?.puzzles?.footstep(p, this.player.facingYaw, surf, run);
    };
    this.player.onJump = () => this.audio.jump();
    this.player.onLand = (p, impact) => this.audio.land(this.surfaceUnder(p), impact);
    this.player.onSwimStart = (p) => { this.audio.splash(0, 0.55, true); this.reef.ring(p.x, p.z, 1.1, 1.3); this.reef.ring(p.x, p.z, 0.6, 0.9); };
    this.player.onSwimEnd = (p) => { this.audio.splash(0, 0.25, false); this.reef.ring(p.x, p.z, 0.7, 1); };
    this.player.onStroke = (p, mov) => { this.audio.stroke(mov); if (mov > 0.2) this.reef.ring(p.x, p.z, 0.55 + mov * 0.2, 1.1); };
    this.reef.onSplash = (x, z, big) => {
      const p = this.player.position, d = Math.hypot(x - p.x, z - p.z);
      this.audio.splash(this.panOf(x, z), Math.max(0, 1 - d / 40) * (big ? 0.55 : 0.3), big);
    };
    // build SFX / onChange wired in ensureBuild()
    this.fauna.school.onSplash = (x, z, big) => {
      const p = this.player.position, d = Math.hypot(x - p.x, z - p.z);
      this.audio.splash(this.panOf(x, z), Math.max(0, 1 - d / 30) * (big ? 0.5 : 0.3), big);
    };

    await this.renderer.init(this.scene, this.camera);
    await lap('renderer', true);
    this.hud = new Hud(this.renderer.backendName);
    this.hud.bindAudio(this.audio);
    this.hud.bindHand(this.input);

    this.hud.onQuality = (q) => this.setQuality(q);
    this.hud.onSelect = (i) => { void this.ensureBuild().then((b) => { if (!b.active) b.toggle(true); b.select(i); }); };
    if (this.isTouch) {
      this.touch = new TouchControls(this.input, () => this.build);
      this.rig.sensitivity = 1.4;
    }
    this.play = new Gameplay(this, SPAWN);
    await lap('gameplay');
    // eagle mount (Call Mount): after Gameplay so toasts / save / walk cancel are ready
    const sd = () => this.play.save.data;
    this.mountPicker = new MountPicker(sd, {
      pick: (id) => { sd().mountId = id; this.play.save.touch(); this.mount.call(id); },
      ui: () => this.audio.ui(), deny: () => this.audio.ui(),
    });
    this.mount = new Mount(this.player, this.input, this.rig, {
      blocked: () => !!this.play.friend?.open || !!this.build?.active || this.play.previewing || this.play.lockMoving || this.mountPicker.open,
      mustLand: () => !!this.build?.active || this.cave.inside,
      toast: (h, ms) => this.play.toast(h, ms),
      sfx: (k) => this.audio.mount(k),
      cancelWalk: () => this.play.walk.cancel(false),
      onRide: () => { this.play.save.data.mountRides = (this.play.save.data.mountRides ?? 0) + 1; this.play.save.touch(); },
      openPicker: () => { if (unlockedMounts(sd()).length < 2) return false; this.mountPicker.show(); return true; },
      tourStops: () => {
        const out: { x: number; z: number }[] = [this.cave.outsideSpot];
        const pp = this.dress?.patch; if (pp && (pp.x || pp.z)) out.push({ x: pp.x, z: pp.z });
        return out;
      },
    });
    // last picked mount (if still unlocked) is the one Call Mount / V brings
    { const m = mountById(sd().mountId); if (isMountUnlocked(m, sd())) this.mount.select(m.id); }
    for (const o of this.mount.groups) this.scene.add(o);
    this.touch?.bindMount(() => this.mount.press(), () => this.mount.buttonState, () => this.mount.def.icon);
    this.play.bindMount(this.mount);
    if (!this.isTouch) {
      const btn = document.createElement('button');
      btn.className = 'mount-btn desktop'; btn.type = 'button';
      btn.innerHTML = '<span class="mi">🦅</span><span class="ml">Call Mount <kbd>V</kbd></span>';
      let lastIcon = '';
      btn.addEventListener('click', (e) => { e.stopPropagation(); this.audio.unlock(); this.mount.press(); });
      document.body.appendChild(btn);
      const tick = () => {
        const st = this.mount.buttonState;
        btn.classList.toggle('busy', st === 'busy'); btn.classList.toggle('blocked', st === 'blocked');
        btn.classList.toggle('on', st === 'hop' || st === 'land'); btn.classList.toggle('hide', !!this.build?.active);
        const ml = btn.querySelector('.ml')!, mi = btn.querySelector('.mi')!;
        const ic = st === 'land' ? '🛬' : this.mount.def.icon;
        if (ic !== lastIcon) { mi.innerHTML = ic; lastIcon = ic; }
        const lbl = st === 'land' ? 'Land <kbd>V</kbd>' : st === 'hop' ? 'Hop on <kbd>V</kbd>' : st === 'busy' ? '…' : 'Call Mount <kbd>V</kbd>';
        if (ml.innerHTML !== lbl) ml.innerHTML = lbl;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }

    applyThemeCss();
    this.hud.bindDock(() => !!this.play.save.data.panelsOpen, (o) => { this.play.save.data.panelsOpen = o; this.play.save.touch(); });
    const syncBuild = () => {
      const b = this.build; if (!b) return;
      this.hud.syncBuildables((i) => b.available(i));
      if (!b.available(b.selected)) b.select(0);
    };
    themeEvents.on(syncBuild);
    this.dress = new Dress(this);
    this.scene.add(this.dress.group);
    themeEvents.on(() => this.dress.rebuild());
    await lap('dress', true);
    const q = params.get('q');
    this.setQuality(q === 'low' || q === 'high' ? q : this.isTouch ? 'low' : 'high');

    this.systems.push(this.player, this.rig, this.mount, { update: (dt, t) => this.build?.update(dt) }, {
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
    // Phase 0: feature chunks download while shaders warm up behind the loading screen
    const lazy = Promise.all([this.ensureBuild(), this.play.prefetchLazy()]);
    await this.warmUp(loader);
    await lap('compile');
    await lazy;
    loader.set(1, undefined, 'Ready!');
    loader.hide();
    this.ready = true;
    this.renderer.renderer.setAnimationLoop(() => this.frame());
  }

  /**
   * Progressive shader warm-up (Phase 0, Order 17): reveal the world one group at a time,
   * compile its pipelines and render one hidden frame, yielding between steps so the
   * loading bar keeps moving instead of one long freeze on the first visible frame.
   */
  private async warmUp(loader: Loader) {
    const chunks = <T,>(a: T[], n: number) => Array.from({ length: n }, (_, i) => a.slice(Math.floor((i * a.length) / n), Math.floor(((i + 1) * a.length) / n)));
    const steps: [THREE.Object3D[], string][] = [
      [[this.terrain.mesh, this.water], 'Warming up the sunshine…'],
      // flora is the heaviest set of materials: split it so the bar keeps moving
      ...chunks(this.flora.group.children, 3).map((c, i) => [c, ['Brushing the leaves…', 'Combing the grass…', 'Opening the flowers…'][i]] as [THREE.Object3D[], string]),
      [[this.player.object, ...this.mount.groups], 'Fluffing your hair…'],
      [[this.fauna.group, this.particles.group], 'Waking the butterflies…'],
      [[this.reef.group, this.cave.outside, this.cave.interior], 'Polishing the shells…'],
      [[this.dress.group], 'Hanging the decorations…'],
    ];
    // Hide drawables only (never lights): toggling a light would change the lighting setup
    // and force every material to recompile again on the next step.
    const drawables = (roots: THREE.Object3D[]) => {
      const out: THREE.Object3D[] = [];
      for (const r of roots) r.traverse((o) => { if ((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite) out.push(o); });
      return out;
    };
    const per = steps.map(([g]) => drawables(g));
    const all = per.flat();
    const vis = new Map(all.map((o) => [o, o.visible] as const));
    for (const o of all) o.visible = false;
    const r = this.renderer.renderer;
    const p0 = 0.64, p1 = 0.98;
    // Shader/pipeline compile doesn't depend on resolution, so warm up on a tiny target:
    // keeps the cost to compile time instead of filling full-res pixels six times.
    const pr = r.getPixelRatio();
    r.setPixelRatio(1);
    r.setSize(96, 72, false);
    try {
      for (let i = 0; i < steps.length; i++) {
        const [group, text] = steps[i];
        const items = per[i];
        loader.set(p0 + ((p1 - p0) * i) / steps.length, undefined, text);
        await nextPaint();
        for (const o of items) o.visible = vis.get(o)!;
        const t0 = performance.now();
        for (const o of group) await r.compileAsync(o, this.camera, this.scene);
        const t1 = performance.now();
        this.renderer.render(this.scene, this.camera); // hidden frame: shadow + post pipelines for what's visible so far
        if (this.loadTiming.enabled) console.log(`[warmup] ${i} compile ${(t1 - t0).toFixed(0)}ms render ${(performance.now() - t1).toFixed(0)}ms`);
      }
    } finally {
      for (const [o, v] of vis) o.visible = v;
      r.setPixelRatio(pr);
      this.renderer.resize();
    }
    loader.set(p1, undefined, 'Almost there…');
    await nextPaint();
  }

  /** Load BuildMode chunk on demand (also called after ready to restore saves). */
  ensureBuild(): Promise<BuildMode> {
    if (this.build) return Promise.resolve(this.build);
    if (this.buildP) return this.buildP;
    this.buildP = import('../build/BuildMode').then(({ BuildMode }) => {
      const b = new BuildMode(this.scene, this.camera, this.terrain, this.physics, this.input, () => this.player.position);
      b.onPlace = (type) => this.audio.place(type);
      b.onRemove = () => this.audio.remove();
      b.onChange = () => {
        this.hud.setBuild(b.active, b.selected, b.count, b.removeMode);
        this.touch?.sync();
      };
      this.build = b;
      this.hud.syncBuildables((i) => b.available(i));
      if (!b.available(b.selected)) b.select(0);
      for (const w of this.buildWait) w(b);
      this.buildWait.length = 0;
      return b;
    });
    return this.buildP;
  }

  /** Run once BuildMode is ready (Gameplay restore hooks). */
  whenBuild(fn: (b: BuildMode) => void) {
    if (this.build) fn(this.build);
    else this.buildWait.push(fn);
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
    if (this.play?.friend?.open) { this.play.friend.update(dt); this.input.endFrame(); return; }
    if (this.input.pressed.has('b') && !this.cave.inside) void this.ensureBuild().then((b) => b.toggle());
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
    this.loadTiming?.firstFrame();
  }
}
