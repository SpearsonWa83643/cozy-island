import * as THREE from 'three/webgpu';
import { pass, uv, vec3, vec4, float, smoothstep, length, mix, dot, uniform } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

export type Quality = 'low' | 'high';

/** WebGPU renderer (auto WebGL2 fallback) + bloom/grade post pipeline + quality presets. */
/** live colour grade (theme system sets these) */
export const gradeU = { tint: uniform(new THREE.Color('#ffffff')), sat: uniform(1.12), vignette: uniform(new THREE.Color(1.0, 0.93, 0.86)), tod: uniform(new THREE.Color(1, 1, 1)) };
export function applyGrade(g: { tint: string; sat: number; vignette: string }) { gradeU.tint.value.set(g.tint); gradeU.sat.value = g.sat; gradeU.vignette.value.set(g.vignette); }

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
    // polish 2026-11-19: start the GPU backend (WebGPU adapter/device or the WebGL context) now so it overlaps the
    // Rapier WASM compile and the world-gen workers; init() below awaits the same (memoised) promise.
    this.renderer.init().catch(() => { /* surfaced by init() */ });
  }

  async init(scene: THREE.Scene, camera: THREE.Camera) {
    await this.renderer.init();
    const backend = (this.renderer as unknown as { backend: { isWebGPUBackend?: boolean } }).backend;
    this.backendName = backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2 (fallback)';
    // polish 2026-11-21: one shader per instanced material instead of one per instanced mesh.
    // three puts the instance matrices of any InstancedMesh that fits the uniform-buffer limit into a
    // per-mesh uniform array (`mat4 bufferN[count]`), and that array's name and size end up in the vertex
    // shader text, so every flora chunk, rock set, critter swarm etc. compiled its own program
    // (297 vertex shaders for 42 fragment shaders at load). Reporting a 0-byte limit sends them all down
    // three's existing instanced-attribute path, whose shader text is the same for every mesh, so the
    // program/pipeline caches hit. Only fallback decisions read this limit (instancing, skinning, range
    // nodes; the game uses no skinning or range nodes); regular uniform blocks are unaffected. ?ubo restores.
    if (!new URLSearchParams(location.search).has('ubo')) {
      const caps = (backend as unknown as { capabilities?: { getUniformBufferLimit?: () => number } }).capabilities;
      if (caps?.getUniformBufferLimit) caps.getUniformBufferLimit = () => 0;
    }

    this.pipeline = new THREE.RenderPipeline(this.renderer);
    const scenePass = pass(scene, camera);
    const color = scenePass.getTextureNode('output');
    const glow = bloom(color, 0.28, 0.45, 0.82);
    // gentle grade: saturation lift + warm vignette
    const c = color.add(glow).rgb;
    const lum = dot(c, vec3(0.299, 0.587, 0.114));
    const sat = mix(vec3(lum), c, gradeU.sat).mul(gradeU.tint).mul(gradeU.tod);
    const d = length(uv().sub(0.5));
    const vig = smoothstep(float(0.85), float(0.35), d).mul(0.22).add(0.78);
    const graded = sat.mul(mix(gradeU.vignette, vec3(1), vig)).mul(vig.mul(0.15).add(0.85));
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
