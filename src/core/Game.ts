import * as THREE from 'three/webgpu';
import { Physics } from './Physics';
import { Input, detectTouch } from './Input';
import type { System } from './System';
import { Renderer, type Quality } from '../render/Renderer';
import { Terrain } from '../world/Terrain';
import { createSky, FOG_COLOR, SUN_DIR } from '../world/Sky';
import { createWater } from '../world/Water';
import { Decor } from '../world/Decor';
import { Player } from '../player/Player';
import { CameraRig } from '../player/CameraRig';
import { BuildMode } from '../build/BuildMode';
import { Hud } from '../ui/Hud';
import { TouchControls } from '../ui/TouchControls';

export class Game {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 2000);
  renderer!: Renderer;
  physics = new Physics();
  input!: Input;
  systems: System[] = [];
  sun!: THREE.DirectionalLight;
  sky!: THREE.Mesh;
  player!: Player;
  rig!: CameraRig;
  build!: BuildMode;
  decor!: Decor;
  hud!: Hud;
  touch: TouchControls | null = null;
  readonly isTouch = detectTouch();
  terrain!: Terrain;
  ready = false;
  private timer = new THREE.Timer();
  private elapsed = 0;

  async start(container: HTMLElement) {
    const params = new URLSearchParams(location.search);
    this.renderer = new Renderer(container, params.has('webgl'));
    this.input = new Input(this.renderer.renderer.domElement);
    await this.physics.init();

    // --- World ---
    this.scene.fog = new THREE.Fog(FOG_COLOR, 70, 330);
    this.sky = createSky();
    this.scene.add(this.sky);

    const hemi = new THREE.HemisphereLight('#cfe9ff', '#e9c995', 1.5);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight('#fff0d8', 3.0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -38; sc.right = 38; sc.top = 38; sc.bottom = -38; sc.near = 1; sc.far = 160;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);

    this.terrain = new Terrain();
    this.scene.add(this.terrain.mesh);
    this.physics.addTrimesh(this.terrain.vertices, this.terrain.indices);
    this.scene.add(createWater(this.terrain.heightTexture));
    this.decor = new Decor(this.physics);
    this.scene.add(this.decor.group);

    // --- Actors ---
    this.player = new Player(this.physics, this.input, new THREE.Vector3(0, 0, 6));
    this.scene.add(this.player.object);
    this.rig = new CameraRig(this.camera, this.input, this.player);
    this.build = new BuildMode(this.scene, this.camera, this.terrain.mesh, this.physics, this.input, () => this.player.position);

    await this.renderer.init(this.scene, this.camera);
    this.hud = new Hud(this.renderer.backendName);
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
    // touch devices (iPad) default to Low; ?q= overrides
    const q = params.get('q');
    this.setQuality(q === 'low' || q === 'high' ? q : this.isTouch ? 'low' : 'high');

    this.systems.push(this.player, this.rig, this.build, { update: (dt) => this.decor.update(dt) });
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.resize();
    });

    this.step(1 / 60);
    this.rig.target.copy(this.player.position).add(new THREE.Vector3(0, 1.1, 0));
    this.rig.apply();
    await this.renderer.renderer.compileAsync(this.scene, this.camera);
    document.getElementById('loading')?.classList.add('hide');
    this.ready = true;
    this.renderer.renderer.setAnimationLoop(() => this.frame());
  }

  setQuality(q: Quality) {
    this.renderer.setQuality(q);
    this.decor.setDensity(q === 'high' ? 1 : 0.4);
    this.hud.setQuality(q);
  }

  /** Advance simulation by dt (also used by tests to step deterministically). */
  step(dt: number) {
    this.elapsed += dt;
    if (this.input.pressed.has('b')) this.build.toggle();
    for (const s of this.systems) s.update(dt, this.elapsed);
    this.physics.step(dt);
    // keep sky centered on camera and the shadow frustum following the player
    this.sky.position.copy(this.camera.position);
    const p = this.player.position;
    this.sun.target.position.set(p.x * 0.5, 0, p.z * 0.5);
    this.sun.position.copy(this.sun.target.position).addScaledVector(SUN_DIR, 60);
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
