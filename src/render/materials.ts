// Shared material library. Everything that looks the same uses the same material instance.
import * as THREE from 'three';
import type { TextureLib, TexSet } from './textures';

function std(set: TexSet | null, color: number, rough = 0.85, metal = 0, extra: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
  if (set) {
    m.map = set.map;
    if (set.normal) { m.normalMap = set.normal; m.normalScale.set(0.9, 0.9); }
    if (set.rough) m.roughnessMap = set.rough;
  }
  return m;
}

export class Materials {
  asphalt: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  concreteDark: THREE.MeshStandardMaterial;
  sidewalk: THREE.MeshStandardMaterial;
  brick: THREE.MeshStandardMaterial;
  brickDark: THREE.MeshStandardMaterial;
  plaster: THREE.MeshStandardMaterial;
  plasterBlue: THREE.MeshStandardMaterial;
  corrugated: THREE.MeshStandardMaterial;
  corrugatedGreen: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  metalDark: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  rust: THREE.MeshStandardMaterial;
  dirt: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  olive: THREE.MeshStandardMaterial;
  oliveDark: THREE.MeshStandardMaterial;
  tarp: THREE.MeshStandardMaterial;
  sandbag: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  windowFacade: THREE.MeshStandardMaterial;
  windowLit: THREE.MeshStandardMaterial;
  hazardYellow: THREE.MeshStandardMaterial;
  hazardStripe: THREE.MeshStandardMaterial;
  white: THREE.MeshStandardMaterial;
  red: THREE.MeshStandardMaterial;
  fence: THREE.MeshStandardMaterial;
  containers: THREE.MeshStandardMaterial[];
  carPaints: THREE.MeshStandardMaterial[];
  burnt: THREE.MeshStandardMaterial;
  lampWarm: THREE.MeshBasicMaterial;
  lampCold: THREE.MeshBasicMaterial;
  beaconRed: THREE.MeshBasicMaterial;
  toxicGlow: THREE.MeshBasicMaterial;
  screenGreen: THREE.MeshBasicMaterial;
  screenAmber: THREE.MeshBasicMaterial;
  laneLine: THREE.MeshStandardMaterial;
  laneYellow: THREE.MeshStandardMaterial;
  puddle: THREE.MeshStandardMaterial;
  grimeDecal: THREE.MeshBasicMaterial;
  lightPoolWarm: THREE.MeshBasicMaterial;
  lightPoolRed: THREE.MeshBasicMaterial;
  lightPoolToxic: THREE.MeshBasicMaterial;
  lightPoolCold: THREE.MeshBasicMaterial;
  glowWarm: THREE.SpriteMaterial;
  glowRed: THREE.SpriteMaterial;
  glowToxic: THREE.SpriteMaterial;
  glowCold: THREE.SpriteMaterial;
  cable: THREE.LineBasicMaterial;

  constructor(public tex: TextureLib) {
    const t = tex;
    this.asphalt = std(t.asphalt, 0xffffff, 1, 0, { envMapIntensity: 1.3 });
    this.concrete = std(t.concrete, 0xd8d6d0, 0.92);
    this.concreteDark = std(t.concrete, 0x8a8a88, 0.95);
    this.sidewalk = std(t.sidewalk, 0xdad8d2, 1, 0, { envMapIntensity: 1.1 });
    this.brick = std(t.brick, 0xffffff, 0.9);
    this.brickDark = std(t.brick, 0x9a9090, 0.92);
    this.plaster = std(t.plaster, 0xb9b4a8, 0.95);
    this.plasterBlue = std(t.plaster, 0x8394a0, 0.95);
    this.corrugated = std(t.corrugated, 0xb8bcc0, 1, 0.35);
    this.corrugatedGreen = std(t.corrugated, 0x6f8070, 1, 0.3);
    this.metal = std(t.metalPanel, 0xa4a8ac, 1, 0.5);
    this.metalDark = std(t.metalPanel, 0x55595e, 1, 0.55);
    this.steel = std(null, 0x777c82, 0.45, 0.8);
    this.rust = std(t.corrugated, 0x8a5a3c, 0.95, 0.3);
    this.dirt = std(t.dirt, 0xffffff, 1);
    this.wood = std(t.wood, 0xc8b8a0, 0.9);
    this.olive = std(t.metalPanel, 0x8a9460, 0.8, 0.15);
    this.oliveDark = std(t.metalPanel, 0x5c6448, 0.85, 0.15);
    this.tarp = std(t.plaster, 0x80845f, 0.95);
    this.sandbag = std(t.dirt, 0xb09d78, 1);
    this.rubber = std(null, 0x1b1b1c, 0.9);
    this.glass = new THREE.MeshStandardMaterial({ color: 0x1c252c, roughness: 0.08, metalness: 0.4, envMapIntensity: 1.6 });
    this.windowFacade = std(t.window, 0xffffff, 0.3, 0.3, { envMapIntensity: 1.4 });
    this.windowLit = new THREE.MeshStandardMaterial({ color: 0x302418, emissive: 0xffa94d, emissiveIntensity: 0.9, map: t.window.map, emissiveMap: t.window.map });
    this.hazardYellow = std(t.metalPanel, 0xc9a227, 0.7, 0.3);
    this.hazardStripe = std(null, 0x18181a, 0.8);
    this.white = std(t.plaster, 0xd8dcdc, 0.8);
    this.red = std(t.metalPanel, 0x8a2320, 0.7, 0.3);
    this.fence = new THREE.MeshStandardMaterial({ map: t.fence, alphaTest: 0.5, side: THREE.DoubleSide, color: 0xb0b4b8, metalness: 0.6, roughness: 0.5 });
    this.containers = [0x7a2f24, 0x2f4d6b, 0x4c5a37, 0x8a6a2a, 0x5c5f63, 0x2d5d5a].map((c) => std(t.corrugated, c, 0.9, 0.35));
    this.carPaints = [0x5b1c1c, 0x2a3b4c, 0x8c8c86, 0x23262a, 0x3d4a3a, 0x6a5a40].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.42, metalness: 0.35, map: t.grime, envMapIntensity: 1.6 }));
    this.burnt = std(t.corrugated, 0x2a2420, 1, 0.4);
    this.lampWarm = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc27a).multiplyScalar(3) });
    this.lampCold = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xcfe3ff).multiplyScalar(3) });
    this.beaconRed = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2a1a).multiplyScalar(4) });
    this.toxicGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xb45cff).multiplyScalar(2.2) });
    this.screenGreen = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x4dff9a).multiplyScalar(1.6) });
    this.screenAmber = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb34d).multiplyScalar(1.6) });
    this.laneLine = new THREE.MeshStandardMaterial({ color: 0xc8c8c0, roughness: 0.7, map: t.grime, polygonOffset: true, polygonOffsetFactor: -2 });
    this.laneYellow = new THREE.MeshStandardMaterial({ color: 0xb8952a, roughness: 0.7, map: t.grime, polygonOffset: true, polygonOffsetFactor: -2 });
    this.puddle = new THREE.MeshStandardMaterial({ color: 0x0c0f13, roughness: 0.04, metalness: 0.2, envMapIntensity: 2.2, transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -3 });
    this.grimeDecal = new THREE.MeshBasicMaterial({ map: t.smoke, color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const pool = (c: number, o: number) => new THREE.MeshBasicMaterial({ map: t.lightPool, color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.lightPoolWarm = pool(0xffa050, 0.42);
    this.lightPoolRed = pool(0xff2010, 0.45);
    this.lightPoolToxic = pool(0xa04cff, 0.35);
    this.lightPoolCold = pool(0x9fc4ff, 0.3);
    const glow = (c: number, o = 1) => new THREE.SpriteMaterial({ map: t.glow, color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false });
    this.glowWarm = glow(0xffb060, 0.9);
    this.glowRed = glow(0xff2a1a);
    this.glowToxic = glow(0xc070ff, 0.8);
    this.glowCold = glow(0xbfd8ff, 0.8);
    this.cable = new THREE.LineBasicMaterial({ color: 0x0c0c0c });
  }
}
