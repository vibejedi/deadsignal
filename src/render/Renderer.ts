// WebGL renderer, blood-moon night lighting, sky dome, environment reflections and restrained post-processing.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

export type Quality = 'low' | 'medium' | 'high';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uDamage: { value: 0 },
    uToxic: { value: 0 },
    uLowHealth: { value: 0 },
    uVignette: { value: 0.38 },
    uGrain: { value: 0.035 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uDamage, uToxic, uLowHealth, uVignette, uGrain;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float r = length(d * vec2(1.0, 0.8));
      // Low health desaturation
      float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(c.rgb, vec3(lum), uLowHealth * 0.6);
      // Vignette
      c.rgb *= 1.0 - smoothstep(0.35, 0.95, r) * uVignette;
      // Damage: red edges
      float edge = smoothstep(0.25, 0.8, r);
      c.rgb = mix(c.rgb, vec3(0.55, 0.02, 0.0), edge * uDamage * 0.75);
      // Contamination: sickly violet tint and pulsing edges
      float pulse = 0.75 + 0.25 * sin(uTime * 4.0);
      c.rgb = mix(c.rgb, c.rgb * vec3(1.05, 0.7, 1.15) + vec3(0.05, 0.0, 0.07), uToxic * 0.7);
      c.rgb = mix(c.rgb, vec3(0.45, 0.1, 0.6), edge * uToxic * 0.45 * pulse);
      // Film grain
      c.rgb += (hash(vUv * 1000.0 + uTime) - 0.5) * uGrain;
      gl_FragColor = c;
    }
  `,
};

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private viewPass: RenderPass;
  readonly grade: ShaderPass;
  private quality: Quality = 'high';
  private renderScale = 1;
  private sky: THREE.Mesh;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.id = 'game-canvas';
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.05, 700);
    this.scene.add(this.camera);
    const fogColor = new THREE.Color(0x1c0f16);
    this.scene.fog = new THREE.FogExp2(fogColor.getHex(), 0.0135);
    this.scene.background = fogColor;

    // Horrors.Fun night: violet sky fill, pale moonlight key with shadows, blood-red horizon.
    this.hemi = new THREE.HemisphereLight(0x6a5a7e, 0x241418, 1.35);
    this.scene.add(this.hemi);
    const ambient = new THREE.AmbientLight(0x3d2c3c, 0.55);
    this.scene.add(ambient);
    this.sun = new THREE.DirectionalLight(0xb7a8d6, 1.25);
    this.sun.position.set(40, 60, 25);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -48; sc.right = 48; sc.top = 48; sc.bottom = -48; sc.near = 1; sc.far = 180;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.sky = this.buildSky(fogColor);
    this.scene.add(this.sky);
    this.buildEnvironment();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.viewPass = new RenderPass(this.scene, this.camera);
    this.viewPass.clear = false;
    this.viewPass.clearDepth = true;
    this.composer.addPass(this.viewPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.42, 0.55, 0.88);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.resize();
  }

  setViewModel(scene: THREE.Scene, cam: THREE.Camera): void {
    this.viewPass.scene = scene;
    this.viewPass.camera = cam;
    // Share the pre-filtered environment so metallic weapon parts have something to reflect.
    scene.environment = this.scene.environment;
    scene.environmentIntensity = 0.9;
  }

  showViewModel(v: boolean): void {
    this.viewPass.enabled = v;
  }

  private buildSky(fog: THREE.Color): THREE.Mesh {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uFog: { value: fog } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() { vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uFog;
        varying vec3 vDir;
        float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        void main() {
          float h = vDir.y;
          vec3 zenith = vec3(0.03, 0.015, 0.04);
          vec3 mid = vec3(0.11, 0.05, 0.1);
          // Blood-red glow low in the west (-X)
          float west = pow(max(0.0, dot(normalize(vec3(vDir.x, 0.0, vDir.z)), normalize(vec3(-1.0, 0.0, 0.35)))), 3.0);
          vec3 horizon = mix(uFog * 1.05, vec3(0.5, 0.08, 0.1), west * 0.6);
          vec3 c = mix(horizon, mid, smoothstep(0.0, 0.18, h));
          c = mix(c, zenith, smoothstep(0.18, 0.7, h));
          // Faint stars near the zenith
          vec3 q = floor(vDir * 420.0);
          float s = step(0.9975, hash(q)) * smoothstep(0.25, 0.7, h);
          c += vec3(s) * 0.6;
          // Contamination glow on the northern horizon (-Z)
          float north = pow(max(0.0, -vDir.z), 6.0) * (1.0 - smoothstep(0.0, 0.25, h));
          c += vec3(0.1, 0.03, 0.14) * north;
          if (h < 0.0) c = uFog;
          gl_FragColor = vec4(c, 1.0);
        }
      `,
    });
    const m = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), mat);
    m.renderOrder = -1;
    m.frustumCulled = false;
    return m;
  }

  /** Pre-filtered environment from the sky + a few warm light cards, for wet-surface reflections. */
  private buildEnvironment(): void {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    envScene.add(this.sky.clone());
    const cardMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffa860).multiplyScalar(4), side: THREE.DoubleSide });
    for (let i = 0; i < 6; i++) {
      const c = new THREE.Mesh(new THREE.PlaneGeometry(20, 4), cardMat);
      const a = (i / 6) * Math.PI * 2;
      c.position.set(Math.cos(a) * 120, 8, Math.sin(a) * 120);
      c.lookAt(0, 8, 0);
      envScene.add(c);
    }
    const green = new THREE.Mesh(new THREE.PlaneGeometry(40, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xb45cff).multiplyScalar(1.5), side: THREE.DoubleSide }));
    green.position.set(0, 10, -150);
    envScene.add(green);
    const rt = pmrem.fromScene(envScene, 0.02);
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();
  }

  setQuality(q: Quality, renderScale: number): void {
    this.quality = q;
    this.renderScale = renderScale;
    const dpr = window.devicePixelRatio || 1;
    const cap = q === 'high' ? 2 : q === 'medium' ? 1.25 : 1;
    this.renderer.setPixelRatio(Math.min(dpr, cap) * renderScale);
    const shadows = q !== 'low';
    if (this.renderer.shadowMap.enabled !== shadows) {
      this.renderer.shadowMap.enabled = shadows;
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (!m) return;
        (Array.isArray(m) ? m : [m]).forEach((mm) => { mm.needsUpdate = true; });
      });
    }
    const size = q === 'high' ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.bloom.enabled = q !== 'low';
    this.resize();
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w, h);
  }

  get pixelHeight(): number {
    return this.renderer.domElement.height;
  }

  /** Keeps the shadow frustum centred on the player, snapped to texels to avoid shimmering. */
  followShadow(x: number, z: number): void {
    const size = 96;
    const texel = size / this.sun.shadow.mapSize.x;
    const sx = Math.round(x / texel) * texel, sz = Math.round(z / texel) * texel;
    this.sun.position.set(sx + 40, 60, sz + 25);
    this.sun.target.position.set(sx, 0, sz);
    this.sun.target.updateMatrixWorld();
  }

  render(time: number): void {
    this.sky.position.copy(this.camera.position);
    this.grade.uniforms.uTime.value = time;
    this.renderer.info.reset();
    this.composer.render();
  }

  get qualityLevel(): Quality {
    return this.quality;
  }

  get scale(): number {
    return this.renderScale;
  }
}
