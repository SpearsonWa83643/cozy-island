import * as THREE from 'three/webgpu';
import { pass, uv, vec3, vec4, float, smoothstep, length, mix, dot } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

export type Quality = 'low' | 'high';

/** WebGPU renderer (auto WebGL2 fallback) + bloom/grade post pipeline + quality presets. */
export class Renderer {
  renderer: THREE.WebGPURenderer;
  pipeline!: THREE.RenderPipeline;
  quality: Quality = 'high';
  backendName = 'unknown';
  private usePost = true;

  constructor(container: HTMLElement, forceWebGL: boolean) {
    this.renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);
  }

  async init(scene: THREE.Scene, camera: THREE.Camera) {
    await this.renderer.init();
    const backend = (this.renderer as unknown as { backend: { isWebGPUBackend?: boolean } }).backend;
    this.backendName = backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2 (fallback)';

    this.pipeline = new THREE.RenderPipeline(this.renderer);
    const scenePass = pass(scene, camera);
    const color = scenePass.getTextureNode('output');
    const glow = bloom(color, 0.28, 0.45, 0.82);
    // gentle grade: saturation lift + warm vignette
    const c = color.add(glow).rgb;
    const lum = dot(c, vec3(0.299, 0.587, 0.114));
    const sat = mix(vec3(lum), c, float(1.12));
    const d = length(uv().sub(0.5));
    const vig = smoothstep(float(0.85), float(0.35), d).mul(0.22).add(0.78);
    const graded = sat.mul(mix(vec3(1.0, 0.93, 0.86), vec3(1), vig)).mul(vig.mul(0.15).add(0.85));
    this.pipeline.outputNode = vec4(graded, float(1));
  }

  setQuality(q: Quality) {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(q === 'high' ? Math.min(dpr, 2) : Math.min(dpr, 1) * 0.8);
    this.usePost = q === 'high';
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  resize() { this.renderer.setSize(window.innerWidth, window.innerHeight); }

  render(scene: THREE.Scene, camera: THREE.Camera) {
    if (this.usePost) this.pipeline.render();
    else this.renderer.render(scene, camera);
  }
}
