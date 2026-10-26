// Procedural infected-human models (Horrors.Fun look: red eyes, claws, fangs) built as rigidly skinned meshes. Geometry variants are shared;
// each zombie instance gets its own skeleton so animation is independent.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ZombieType } from '../config';
import { Rng } from '../core/rng';
import type { TextureLib } from '../render/textures';

export const BONE = {
  hips: 0, spine: 1, chest: 2, neck: 3, head: 4, armL: 5, foreL: 6, armR: 7, foreR: 8, thighL: 9, shinL: 10, thighR: 11, shinR: 12, jaw: 13,
} as const;

// Bone offsets relative to parent (bind pose, feet at y=0, facing +Z).
const BONE_DEF: [number, number, [number, number, number]][] = [
  [BONE.hips, -1, [0, 0.95, 0]],
  [BONE.spine, BONE.hips, [0, 0.13, 0]],
  [BONE.chest, BONE.spine, [0, 0.2, 0]],
  [BONE.neck, BONE.chest, [0, 0.22, 0]],
  [BONE.head, BONE.neck, [0, 0.08, 0]],
  [BONE.armL, BONE.chest, [0.21, 0.16, 0]],
  [BONE.foreL, BONE.armL, [0, -0.28, 0]],
  [BONE.armR, BONE.chest, [-0.21, 0.16, 0]],
  [BONE.foreR, BONE.armR, [0, -0.28, 0]],
  [BONE.thighL, BONE.hips, [0.1, -0.06, 0]],
  [BONE.shinL, BONE.thighL, [0, -0.43, 0]],
  [BONE.thighR, BONE.hips, [-0.1, -0.06, 0]],
  [BONE.shinR, BONE.thighR, [0, -0.43, 0]],
  [BONE.jaw, BONE.head, [0, -0.02, 0.03]],
];

function bonePositions(): THREE.Vector3[] {
  const abs: THREE.Vector3[] = [];
  for (const [i, p, off] of BONE_DEF) abs[i] = new THREE.Vector3(...off).add(p >= 0 ? abs[p] : new THREE.Vector3());
  return abs;
}

export interface ZombieVariant {
  key: string;
  type: ZombieType;
  geo: THREE.BufferGeometry;
  helmet: THREE.BufferGeometry | null;
}

interface Palette { shirt: THREE.Color; pants: THREE.Color; skin: THREE.Color; shoes: THREE.Color }

export class ZombieModels {
  readonly bodyMat: THREE.MeshStandardMaterial;
  readonly eyeMat: THREE.MeshBasicMaterial;
  readonly eliteEyeMat: THREE.MeshBasicMaterial;
  readonly helmetMat: THREE.MeshStandardMaterial;
  readonly eliteHelmetMat: THREE.MeshStandardMaterial;
  readonly variants: Record<ZombieType, ZombieVariant[]>;
  private rng = new Rng(4242);

  constructor(tex: TextureLib) {
    this.bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.02, map: tex.grime });
    this.eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff1a2e).multiplyScalar(3.2) });
    this.eliteEyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff1030).multiplyScalar(5) });
    this.helmetMat = new THREE.MeshStandardMaterial({ color: 0x3b4034, roughness: 0.55, metalness: 0.5, map: tex.grime });
    this.eliteHelmetMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.4, metalness: 0.75, map: tex.grime, emissive: 0x3a0610, emissiveIntensity: 0.8 });
    this.variants = { shambler: [], runner: [], armored: [], elite: [] };
    for (let i = 0; i < 6; i++) this.variants.shambler.push(this.build('shambler', i));
    for (let i = 0; i < 4; i++) this.variants.runner.push(this.build('runner', i));
    for (let i = 0; i < 3; i++) this.variants.armored.push(this.build('armored', i));
    this.variants.elite.push(this.build('elite', 0));
  }

  private palette(type: ZombieType): Palette {
    const r = this.rng;
    const shirts = [0x5a5f66, 0x6b4a3a, 0x3d4a5c, 0x7a7466, 0x4a5a3a, 0x8a8a84, 0x5c2e2a, 0x2e3438];
    const pants = [0x2c3038, 0x3a3428, 0x4a4a44, 0x232528, 0x3c4a5a];
    const skins = [0x9a8a88, 0xa89a96, 0x8a7a82, 0xb0a29e, 0x7e7078];
    if (type === 'armored') return { shirt: new THREE.Color(0x4a5238), pants: new THREE.Color(0x3a4030), skin: new THREE.Color(r.pick(skins)), shoes: new THREE.Color(0x1a1a18) };
    if (type === 'elite') return { shirt: new THREE.Color(0x2a2c2a), pants: new THREE.Color(0x222420), skin: new THREE.Color(0x6e5a62), shoes: new THREE.Color(0x121212) };
    // Hazmat worker variant for some shamblers
    if (type === 'shambler' && r.chance(0.2)) return { shirt: new THREE.Color(0x7a5a2a), pants: new THREE.Color(0x6a4c22), skin: new THREE.Color(r.pick(skins)), shoes: new THREE.Color(0x1a1a18) };
    return { shirt: new THREE.Color(r.pick(shirts)), pants: new THREE.Color(r.pick(pants)), skin: new THREE.Color(r.pick(skins)), shoes: new THREE.Color(0x1c1a18) };
  }

  private build(type: ZombieType, idx: number): ZombieVariant {
    const P = bonePositions();
    const pal = this.palette(type);
    const r = this.rng;
    const body: THREE.BufferGeometry[] = [];
    const eyes: THREE.BufferGeometry[] = [];
    const blood = new THREE.Color(0x5a0810);
    const bulky = type === 'armored' || type === 'elite';
    const thin = type === 'runner';
    const shoulderW = bulky ? 1.18 : thin ? 0.92 : 1 + r.range(-0.05, 0.08);
    const bellyW = type === 'shambler' && r.chance(0.3) ? 1.18 : 1;
    const sleeveless = thin || r.chance(0.25);
    const oneArmHang = false;
    void oneArmHang;

    const part = (g: THREE.BufferGeometry, bone: number, color: THREE.Color, x: number, y: number, z: number,
      opts: { rx?: number; ry?: number; rz?: number; sx?: number; sy?: number; sz?: number; bloodChance?: number; grime?: number } = {}) => {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(opts.rx ?? 0, opts.ry ?? 0, opts.rz ?? 0)),
        new THREE.Vector3(opts.sx ?? 1, opts.sy ?? 1, opts.sz ?? 1));
      let geo = g.index ? g.toNonIndexed() : g;
      geo.applyMatrix4(m);
      for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
      const n = geo.attributes.position.count;
      const cols = new Float32Array(n * 3);
      const si = new Uint16Array(n * 4);
      const sw = new Float32Array(n * 4);
      const tmp = new THREE.Color();
      const pos = geo.attributes.position;
      for (let i = 0; i < n; i++) {
        tmp.copy(color);
        const shade = 1 - r.range(0, opts.grime ?? 0.25);
        tmp.multiplyScalar(shade);
        // Blood stains concentrated around the mouth / chest front
        if (opts.bloodChance && pos.getZ(i) > z && r.chance(opts.bloodChance)) tmp.lerp(blood, r.range(0.5, 0.9));
        cols[i * 3] = tmp.r; cols[i * 3 + 1] = tmp.g; cols[i * 3 + 2] = tmp.b;
        si[i * 4] = bone;
        sw[i * 4] = 1;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
      geo = geo.index ? geo.toNonIndexed() : geo;
      return geo;
    };

    // Torso
    body.push(part(new THREE.BoxGeometry(0.34 * bellyW, 0.2, 0.21), BONE.hips, pal.pants, 0, 0.94, 0));
    body.push(part(new THREE.BoxGeometry(0.31 * bellyW, 0.22, 0.2 * bellyW), BONE.spine, pal.shirt, 0, 1.1, 0.005, { bloodChance: 0.3 }));
    body.push(part(new THREE.BoxGeometry(0.4 * shoulderW, 0.27, 0.23), BONE.chest, pal.shirt, 0, 1.32, 0, { bloodChance: 0.35 }));
    body.push(part(new THREE.BoxGeometry(0.46 * shoulderW, 0.09, 0.19), BONE.chest, pal.shirt, 0, 1.465, -0.005));
    // Exposed ribs through a torn shirt: runners always, some shamblers
    if (thin || (type === 'shambler' && r.chance(0.35))) {
      body.push(part(new THREE.BoxGeometry(0.22, 0.17, 0.02), BONE.chest, blood.clone().multiplyScalar(0.6), 0.03, 1.28, 0.116));
      for (let i = 0; i < 4; i++) body.push(part(new THREE.BoxGeometry(0.2 - i * 0.02, 0.014, 0.018), BONE.chest, new THREE.Color(0xd8cdbd), 0.03, 1.34 - i * 0.04, 0.124, { bloodChance: 0.4, grime: 0.15 }));
    }
    // Neck & head
    body.push(part(new THREE.CylinderGeometry(0.052, 0.06, 0.12, 8), BONE.neck, pal.skin, 0, 1.53, 0));
    const headG = new THREE.SphereGeometry(0.11, 12, 10);
    body.push(part(headG, BONE.head, pal.skin, 0, 1.665, 0.01, { sx: 0.95, sy: 1.12, sz: 1.05, grime: 0.35 }));
    body.push(part(new THREE.BoxGeometry(0.15, 0.035, 0.05), BONE.head, pal.skin.clone().multiplyScalar(0.8), 0, 1.71, 0.09)); // brow
    body.push(part(new THREE.BoxGeometry(0.03, 0.05, 0.04), BONE.head, pal.skin, 0, 1.665, 0.115)); // nose
    body.push(part(new THREE.BoxGeometry(0.1, 0.02, 0.02), BONE.head, new THREE.Color(0x1a0a08), 0, 1.69, 0.1)); // dark sockets
    body.push(part(new THREE.BoxGeometry(0.12, 0.05, 0.1), BONE.jaw, pal.skin, 0, 1.575, 0.04, { bloodChance: 0.85 }));
    body.push(part(new THREE.BoxGeometry(0.09, 0.012, 0.02), BONE.jaw, new THREE.Color(0xc8c0a0), 0, 1.6, 0.09)); // teeth
    body.push(part(new THREE.BoxGeometry(0.085, 0.04, 0.02), BONE.head, new THREE.Color(0x120406), 0, 1.625, 0.098)); // mouth
    for (let i = 0; i < 5; i++) body.push(part(new THREE.ConeGeometry(0.008, 0.026, 4), BONE.head, new THREE.Color(0xd2c6a8), -0.032 + i * 0.016, 1.632, 0.108, { rx: Math.PI, grime: 0.2 })); // upper fangs
    // Hair / cap for some
    if (!bulky && r.chance(0.5)) body.push(part(new THREE.SphereGeometry(0.115, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.2), BONE.head, new THREE.Color(r.pick([0x1a1410, 0x3a2a1a, 0x5a5048, 0x222222])), 0, 1.68, -0.005, { sy: 1.05 }));
    // Eyes (emissive group)
    for (const s of [-1, 1]) eyes.push(part(new THREE.SphereGeometry(0.02, 6, 4), BONE.head, new THREE.Color(1, 1, 1), s * 0.038, 1.69, 0.1, { grime: 0 }));
    // Arms
    for (const s of [1, -1]) {
      const arm = s > 0 ? BONE.armL : BONE.armR, fore = s > 0 ? BONE.foreL : BONE.foreR;
      const x = s * 0.22 * shoulderW;
      const upperCol = sleeveless ? pal.skin : pal.shirt;
      body.push(part(new THREE.CapsuleGeometry(bulky ? 0.06 : 0.048, 0.19, 3, 8), arm, upperCol, x, P[arm].y - 0.14, 0));
      body.push(part(new THREE.CapsuleGeometry(bulky ? 0.05 : 0.04, 0.2, 3, 8), fore, pal.skin, x, P[fore].y - 0.12, 0, { bloodChance: 0.3 }));
      body.push(part(new THREE.BoxGeometry(0.06, 0.1, 0.035), fore, pal.skin.clone().multiplyScalar(0.85), x, P[fore].y - 0.3, 0.01));
      body.push(part(new THREE.BoxGeometry(0.05, 0.06, 0.03), fore, pal.skin.clone().multiplyScalar(0.8), x, P[fore].y - 0.37, 0.03, { rx: 0.4 })); // fingers curled
      for (let c = 0; c < 3; c++) body.push(part(new THREE.ConeGeometry(0.008, 0.07, 4), fore, new THREE.Color(0xcfc3ae), x - 0.018 + c * 0.018, P[fore].y - 0.43, 0.05, { rx: Math.PI - 0.5, bloodChance: 0.5, grime: 0.2 })); // claws
    }
    // Legs
    for (const s of [1, -1]) {
      const th = s > 0 ? BONE.thighL : BONE.thighR, sh = s > 0 ? BONE.shinL : BONE.shinR;
      const x = s * 0.1;
      body.push(part(new THREE.CapsuleGeometry(bulky ? 0.08 : 0.068, 0.3, 3, 8), th, pal.pants, x, P[th].y - 0.21, 0));
      body.push(part(new THREE.CapsuleGeometry(bulky ? 0.065 : 0.055, 0.32, 3, 8), sh, pal.pants, x, P[sh].y - 0.2, 0));
      body.push(part(new THREE.BoxGeometry(0.1, 0.07, 0.25), sh, pal.shoes, x, 0.04, 0.045));
    }
    // Armour for armored / elite
    if (bulky) {
      const plate = type === 'elite' ? new THREE.Color(0x2a2c2e) : new THREE.Color(0x4d5440);
      body.push(part(new THREE.BoxGeometry(0.46 * shoulderW, 0.32, 0.29), BONE.chest, plate, 0, 1.3, 0.005, { grime: 0.35 }));
      body.push(part(new THREE.BoxGeometry(0.36, 0.14, 0.26), BONE.spine, plate.clone().multiplyScalar(0.85), 0, 1.1, 0.0));
      for (const s of [1, -1]) {
        const arm = s > 0 ? BONE.armL : BONE.armR, th = s > 0 ? BONE.thighL : BONE.thighR, sh = s > 0 ? BONE.shinL : BONE.shinR;
        body.push(part(new THREE.SphereGeometry(0.1, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), arm, plate, s * 0.25 * shoulderW, P[arm].y - 0.02, 0, { sy: 0.8 }));
        body.push(part(new THREE.BoxGeometry(0.15, 0.2, 0.08), th, plate, s * 0.1, P[th].y - 0.2, 0.07));
        body.push(part(new THREE.BoxGeometry(0.12, 0.2, 0.06), sh, plate, s * 0.1, P[sh].y - 0.16, 0.065));
      }
      // Pouches / webbing
      body.push(part(new THREE.BoxGeometry(0.1, 0.08, 0.06), BONE.spine, new THREE.Color(0x3a3a2a), 0.12, 1.06, 0.14));
      body.push(part(new THREE.BoxGeometry(0.1, 0.08, 0.06), BONE.spine, new THREE.Color(0x3a3a2a), -0.12, 1.06, 0.14));
      if (type === 'elite') {
        // Heavy collar + back tank with glowing contamination
        body.push(part(new THREE.CylinderGeometry(0.2, 0.26, 0.12, 10), BONE.chest, plate, 0, 1.5, -0.01));
        body.push(part(new THREE.CylinderGeometry(0.09, 0.09, 0.4, 10), BONE.chest, new THREE.Color(0x3a3a3a), 0, 1.3, -0.2));
        eyes.push(part(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8), BONE.chest, new THREE.Color(1, 1, 1), 0, 1.3, -0.26, { grime: 0 }));
        for (let i = 0; i < 4; i++) body.push(part(new THREE.ConeGeometry(0.03, 0.14, 5), BONE.chest, new THREE.Color(0x5a5a5a), -0.18 + i * 0.12, 1.5, -0.1, { rx: -0.6 }));
      }
    }
    const bodyGeo = mergeGeometries(body, false)!;
    const eyeGeo = mergeGeometries(eyes, false)!;
    const geo = mergeGeometries([bodyGeo, eyeGeo], true)!;
    geo.computeBoundingSphere();
    let helmet: THREE.BufferGeometry | null = null;
    if (bulky) {
      const h = new THREE.SphereGeometry(0.135, 14, 8, 0, Math.PI * 2, 0, Math.PI / 1.85);
      const brim = new THREE.CylinderGeometry(0.145, 0.15, 0.03, 14).translate(0, 0.0, 0);
      const visor = new THREE.BoxGeometry(0.2, 0.06, 0.04).translate(0, -0.02, 0.12);
      const parts = [h, brim, visor].map((g) => { const n = g.toNonIndexed(); for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k); return n; });
      helmet = mergeGeometries(parts, false);
    }
    return { key: `${type}${idx}`, type, geo, helmet };
  }

  /** Creates a skinned mesh instance for a variant with a fresh skeleton. */
  instantiate(v: ZombieVariant): { mesh: THREE.SkinnedMesh; bones: THREE.Bone[]; helmet: THREE.Mesh | null } {
    const bones: THREE.Bone[] = [];
    for (const [i, p, off] of BONE_DEF) {
      const b = new THREE.Bone();
      b.position.set(...off);
      bones[i] = b;
      if (p >= 0) bones[p].add(b);
    }
    const eye = v.type === 'elite' ? this.eliteEyeMat : this.eyeMat;
    const mesh = new THREE.SkinnedMesh(v.geo, [this.bodyMat, eye]);
    mesh.add(bones[BONE.hips]);
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones));
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    // Generous fixed bounds so culling never pops animated limbs.
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 2.2);
    let helmet: THREE.Mesh | null = null;
    if (v.helmet) {
      helmet = new THREE.Mesh(v.helmet, v.type === 'elite' ? this.eliteHelmetMat : this.helmetMat);
      helmet.position.set(0, 0.095, 0.005);
      helmet.castShadow = true;
      bones[BONE.head].add(helmet);
      if (v.type === 'elite') {
        const visor = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.025, 0.02), this.eliteEyeMat);
        visor.position.set(0, -0.02, 0.14);
        helmet.add(visor);
      }
    }
    return { mesh, bones, helmet };
  }
}
