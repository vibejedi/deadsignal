// The Exclusion Zone district: geometry, colliders, navigation and points of interest.
// North is -Z. Low threat in the south (insertion), medium in the depot, high in the compound.
import * as THREE from 'three';
import { WORLD, type RegionId } from '../config';
import { Rng } from '../core/rng';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { InstanceSet, StaticBatch, prep, worldBox, worldQuad } from '../render/geom';
import type { Materials } from '../render/materials';
import { signTexture } from '../render/textures';
import { CollisionWorld, type Surface } from './Collision';
import { NavGrid } from './NavGrid';
import { buildProps, type PropDef, type PropName } from './props';

export type ShapeKind = 'building' | 'interior' | 'road' | 'sidewalk' | 'lot' | 'container' | 'prop' | 'wall' | 'fence' | 'yard' | 'compound';
export interface MapShape { x0: number; z0: number; x1: number; z1: number; kind: ShapeKind }
export interface P2 { x: number; z: number }
export interface Station extends P2 { yaw: number; kind: 'buy' | 'upgrade' }
export interface CrateSpot extends P2 { y: number; yaw: number; region: RegionId }

export interface Poi {
  playerSpawn: P2 & { yaw: number };
  transmitter: P2;
  lzPad: P2;
  radio: P2;
  heliLand: P2;
  boardPoint: P2;
  stations: Station[];
  crates: CrateSpot[];
  spawns: Record<RegionId, P2[]>;
  eliteSpawn: P2;
  compoundCenter: P2;
  reactor: P2;
}

interface Opening { a: number; b: number; h: number }
interface DoorSpec { side: 'n' | 's' | 'e' | 'w'; a: number; b: number; h: number }
interface BuildingSpec {
  x0: number; z0: number; x1: number; z1: number; h: number;
  wall: THREE.Material; trim?: THREE.Material;
  enterable?: boolean; interiorH?: number; doors?: DoorSpec[];
  windows?: boolean; lit?: number; floorMat?: THREE.Material; interiorWall?: THREE.Material;
  sign?: { text: string[]; side: 'n' | 's' | 'e' | 'w'; bg: string; fg: string; y?: number; w?: number; glow?: boolean };
  roofClutter?: boolean;
}

export interface AnimatedLight { light: THREE.PointLight; base: number; mode: 'flicker' | 'pulse' | 'steady'; phase: number }

export class Level {
  readonly root = new THREE.Group();
  readonly world = new CollisionWorld(WORLD.minX, WORLD.minZ, WORLD.maxX, WORLD.maxZ);
  readonly nav = new NavGrid(WORLD.minX, WORLD.minZ, WORLD.maxX, WORLD.maxZ);
  readonly shapes: MapShape[] = [];
  readonly lights: AnimatedLight[] = [];
  readonly beacons: THREE.Sprite[] = [];
  readonly poi: Poi;
  defenseRing!: THREE.Mesh;
  transmitterBeacon!: THREE.Sprite;
  lzMarker!: THREE.Mesh;
  private spores!: THREE.Points;
  private sporeBase!: Float32Array;
  private batch = new StaticBatch();
  private noShadowBatch = new StaticBatch();
  private inst = new InstanceSet();
  private P: Record<PropName, PropDef>;
  private rng = new Rng(20260922);

  constructor(private M: Materials) {
    this.P = buildProps(M);
    this.poi = {
      playerSpawn: { x: 0, z: 93, yaw: 0 },
      transmitter: { x: 40, z: 6 },
      lzPad: { x: 40, z: 46 },
      radio: { x: 30.5, z: 46 },
      heliLand: { x: 41, z: 46 },
      boardPoint: { x: 41, z: 43.2 },
      stations: [
        { x: 9.3, z: 88, yaw: -Math.PI / 2, kind: 'buy' },
        { x: 13.2, z: 10, yaw: -Math.PI / 2, kind: 'buy' },
        { x: -58.9, z: 13, yaw: Math.PI / 2, kind: 'upgrade' },
      ],
      crates: [],
      spawns: { low: [], medium: [], high: [] },
      eliteSpawn: { x: 16, z: -60 },
      compoundCenter: { x: 0, z: -72 },
      reactor: { x: 0, z: -72 },
    };
    this.buildGround();
    this.buildBoundary();
    this.buildLowDistrict();
    this.buildDepot();
    this.buildCompound();
    this.buildLZ();
    this.buildSkyline();
    this.buildStationsColliders();
    this.buildCrateSpots();
    this.batch.build(this.root, { castShadow: true, receiveShadow: true });
    this.noShadowBatch.build(this.root, { castShadow: false, receiveShadow: true });
    this.inst.build(this.root);
    this.nav.build(this.world);
    this.buildSpawnPoints();
  }

  // ------------------------------------------------------------------------------------------
  // Primitive helpers
  // ------------------------------------------------------------------------------------------
  private solid(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: THREE.Material, tile = 2,
    opts: { surface?: Surface; floor?: boolean; solid?: boolean; shadow?: boolean } = {}): void {
    (opts.shadow === false ? this.noShadowBatch : this.batch).add(mat, worldBox(x0, y0, z0, x1, y1, z1, tile));
    this.world.add(x0, y0, z0, x1, y1, z1, { surface: opts.surface ?? surfaceFor(mat, this.M), floor: opts.floor, solid: opts.solid });
  }

  private vis(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: THREE.Material, tile = 2, shadow = true): void {
    (shadow ? this.batch : this.noShadowBatch).add(mat, worldBox(x0, y0, z0, x1, y1, z1, tile));
  }

  private quad(x0: number, z0: number, x1: number, z1: number, y: number, mat: THREE.Material, tile = 4): void {
    this.noShadowBatch.add(mat, worldQuad(x0, z0, x1, z1, y, tile));
  }

  /** Places an instanced prop. `rot` is in quarter turns so colliders stay axis-aligned. */
  prop(name: PropName, x: number, z: number, rot = 0, y = 0, addShape = false): void {
    const d = this.P[name];
    const ry = rot * (Math.PI / 2);
    this.inst.place(d.tpl, x, y, z, ry);
    const cols = d.colliders === 'bounds'
      ? [[d.tpl.bounds.min.x, d.tpl.bounds.min.y, d.tpl.bounds.min.z, d.tpl.bounds.max.x, d.tpl.bounds.max.y, d.tpl.bounds.max.z]]
      : d.colliders === 'none' ? [] : d.colliders;
    for (const c of cols) {
      const [ax, az] = rotXZ(c[0], c[2], rot);
      const [bx, bz] = rotXZ(c[3], c[5], rot);
      this.world.add(x + Math.min(ax, bx), y + c[1], z + Math.min(az, bz), x + Math.max(ax, bx), y + c[4], z + Math.max(az, bz),
        { surface: d.surface, solid: d.solid ?? true, floor: d.floor });
      if (addShape) this.shapes.push({ x0: x + Math.min(ax, bx), z0: z + Math.min(az, bz), x1: x + Math.max(ax, bx), z1: z + Math.max(az, bz), kind: name.startsWith('container') ? 'container' : 'prop' });
    }
  }

  /** Decorative prop with free rotation and no collider (debris, trash). */
  deco(name: PropName, x: number, z: number, ry: number, y = 0): void {
    this.inst.place(this.P[name].tpl, x, y, z, ry);
  }

  /** Wall running along X at depth z, with door openings (a..b along X). */
  private wallX(z: number, x0: number, x1: number, h: number, t: number, mat: THREE.Material, openings: Opening[] = [], y0 = 0): void {
    const segs = splitSpan(x0, x1, openings);
    for (const [a, b] of segs) this.solid(a, y0, z - t / 2, b, h, z + t / 2, mat, 2.5);
    for (const o of openings) {
      this.solid(o.a, o.h, z - t / 2, o.b, h, z + t / 2, mat, 2.5);
      // door frame trim
      this.vis(o.a - 0.12, 0, z - t / 2 - 0.04, o.a, o.h + 0.12, z + t / 2 + 0.04, this.M.metalDark, 1);
      this.vis(o.b, 0, z - t / 2 - 0.04, o.b + 0.12, o.h + 0.12, z + t / 2 + 0.04, this.M.metalDark, 1);
      this.vis(o.a, o.h, z - t / 2 - 0.04, o.b, o.h + 0.12, z + t / 2 + 0.04, this.M.metalDark, 1);
    }
  }

  private wallZ(x: number, z0: number, z1: number, h: number, t: number, mat: THREE.Material, openings: Opening[] = [], y0 = 0): void {
    const segs = splitSpan(z0, z1, openings);
    for (const [a, b] of segs) this.solid(x - t / 2, y0, a, x + t / 2, h, b, mat, 2.5);
    for (const o of openings) {
      this.solid(x - t / 2, o.h, o.a, x + t / 2, h, o.b, mat, 2.5);
      this.vis(x - t / 2 - 0.04, 0, o.a - 0.12, x + t / 2 + 0.04, o.h + 0.12, o.a, this.M.metalDark, 1);
      this.vis(x - t / 2 - 0.04, 0, o.b, x + t / 2 + 0.04, o.h + 0.12, o.b + 0.12, this.M.metalDark, 1);
      this.vis(x - t / 2 - 0.04, o.h, o.a, x + t / 2 + 0.04, o.h + 0.12, o.b, this.M.metalDark, 1);
    }
  }

  private sign(text: string[], x: number, y: number, z: number, ry: number, w: number, h: number,
    opts: { bg: string; fg: string; hazard?: boolean; symbol?: 'bio'; glow?: boolean; border?: string }): THREE.Mesh {
    const tex = signTexture(text, { bg: opts.bg, fg: opts.fg, hazard: opts.hazard, symbol: opts.symbol, border: opts.border, w: 512, h: Math.round(512 * (h / w)) });
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, metalness: 0.1 });
    if (opts.glow) { mat.emissive = new THREE.Color(0xffffff); mat.emissiveMap = tex; mat.emissiveIntensity = 0.55; }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    this.root.add(m);
    return m;
  }

  private building(s: BuildingSpec): void {
    const { x0, z0, x1, z1, h } = s;
    const M = this.M;
    const t = 0.3;
    this.shapes.push({ x0, z0, x1, z1, kind: s.enterable ? 'interior' : 'building' });
    if (s.enterable) {
      const ih = s.interiorH ?? 3.4;
      const doors = s.doors ?? [];
      const op = (side: DoorSpec['side']) => doors.filter((d) => d.side === side).map((d) => ({ a: d.a, b: d.b, h: d.h }));
      this.wallX(z0 + t / 2, x0, x1, h, t, s.wall, op('n'));
      this.wallX(z1 - t / 2, x0, x1, h, t, s.wall, op('s'));
      this.wallZ(x0 + t / 2, z0 + t, z1 - t, h, t, s.wall, op('w'));
      this.wallZ(x1 - t / 2, z0 + t, z1 - t, h, t, s.wall, op('e'));
      // Floor slab (walkable) and ceiling
      this.solid(x0 + t, 0, z0 + t, x1 - t, 0.12, z1 - t, s.floorMat ?? M.concreteDark, 3, { floor: true, shadow: false });
      this.solid(x0 + t, ih, z0 + t, x1 - t, ih + 0.25, z1 - t, s.interiorWall ?? M.plaster, 3);
      // Interior wall lining (slightly inset visual so the inside reads differently)
      const iw = s.interiorWall ?? M.plaster;
      this.vis(x0 + t, 0.12, z0 + t, x1 - t, ih, z0 + t + 0.02, iw, 2.5, false);
      this.vis(x0 + t, 0.12, z1 - t - 0.02, x1 - t, ih, z1 - t, iw, 2.5, false);
      this.vis(x0 + t, 0.12, z0 + t, x0 + t + 0.02, ih, z1 - t, iw, 2.5, false);
      this.vis(x1 - t - 0.02, 0.12, z0 + t, x1 - t, ih, z1 - t, iw, 2.5, false);
      // Re-cut the lining at doors so the openings stay visible
      // (lining sits inside the wall thickness zone only at 2cm, the door frames overlap it)
      this.vis(x0, h, z0, x1, h + 0.3, z1, M.concreteDark, 3); // roof slab
    } else {
      this.solid(x0, 0, z0, x1, h, z1, s.wall, 2.5);
      this.vis(x0, h, z0, x1, h + 0.25, z1, M.concreteDark, 3);
    }
    // Parapet + cornice
    const pt = 0.25;
    this.vis(x0 - 0.1, h, z0 - 0.1, x1 + 0.1, h + 0.7, z0 + pt, s.trim ?? M.concrete, 2);
    this.vis(x0 - 0.1, h, z1 - pt, x1 + 0.1, h + 0.7, z1 + 0.1, s.trim ?? M.concrete, 2);
    this.vis(x0 - 0.1, h, z0, x0 + pt, h + 0.7, z1, s.trim ?? M.concrete, 2);
    this.vis(x1 - pt, h, z0, x1 + 0.1, h + 0.7, z1, s.trim ?? M.concrete, 2);
    // Base plinth
    this.vis(x0 - 0.06, 0, z0 - 0.06, x1 + 0.06, 0.5, z0 + 0.1, M.concreteDark, 2);
    this.vis(x0 - 0.06, 0, z1 - 0.1, x1 + 0.06, 0.5, z1 + 0.06, M.concreteDark, 2);
    this.vis(x0 - 0.06, 0, z0, x0 + 0.1, 0.5, z1, M.concreteDark, 2);
    this.vis(x1 - 0.1, 0, z0, x1 + 0.06, 0.5, z1, M.concreteDark, 2);
    if (s.windows !== false) this.windows(s);
    if (s.roofClutter) {
      const rx = (x0 + x1) / 2, rz = (z0 + z1) / 2;
      this.deco('acUnit', rx - 2, rz, 0, h);
      this.deco('acUnit', rx + 3, rz + 1.5, Math.PI / 2, h);
      this.vis(rx + 4, h, rz - 3, rx + 5.2, h + 2.2, rz - 1.8, M.metalDark, 1);
    }
    if (s.sign) {
      const sg = s.sign;
      const w = sg.w ?? 6, hh = w * 0.28, y = sg.y ?? 4.2;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const off = 0.08;
      const pos: Record<string, [number, number, number]> = {
        n: [cx, z0 - off, Math.PI], s: [cx, z1 + off, 0], e: [x1 + off, cz, Math.PI / 2], w: [x0 - off, cz, -Math.PI / 2],
      };
      const [px, pz, ry] = pos[sg.side];
      this.sign(sg.text, px, y, pz, ry, w, hh, { bg: sg.bg, fg: sg.fg, glow: sg.glow });
    }
  }

  private windows(s: BuildingSpec): void {
    const { x0, z0, x1, z1, h } = s;
    const floors = Math.floor((h - 1) / 3.3);
    const doors = s.doors ?? [];
    const lit = s.lit ?? 0.06;
    const put = (side: 'n' | 's' | 'e' | 'w') => {
      const along = side === 'n' || side === 's';
      const a0 = along ? x0 : z0, a1 = along ? x1 : z1;
      const len = a1 - a0;
      const n = Math.floor((len - 1.5) / 3.2);
      if (n <= 0) return;
      const gap = len / n;
      for (let f = 0; f < floors; f++) {
        const y = 1.1 + f * 3.3;
        if (y + 1.7 > h - 0.4) continue;
        for (let i = 0; i < n; i++) {
          const c = a0 + gap * (i + 0.5);
          if (f === 0 && doors.some((d) => d.side === side && c > d.a - 1.2 && c < d.b + 1.2)) continue;
          if (f === 0 && s.enterable && this.rng.chance(0.3)) continue;
          const boarded = this.rng.chance(0.18);
          const isLit = !boarded && this.rng.chance(lit);
          const mat = isLit ? this.M.windowLit : this.M.windowFacade;
          const w = 1.4, wh = 1.7, d = 0.05;
          let bx0: number, bx1: number, bz0: number, bz1: number;
          if (along) {
            const z = side === 'n' ? z0 - d : z1;
            bx0 = c - w / 2; bx1 = c + w / 2; bz0 = z; bz1 = z + d;
          } else {
            const x = side === 'w' ? x0 - d : x1;
            bz0 = c - w / 2; bz1 = c + w / 2; bx0 = x; bx1 = x + d;
          }
          this.vis(bx0, y, bz0, bx1, y + wh, bz1, mat, 1.4, false);
          // Sill
          if (along) this.vis(bx0 - 0.1, y - 0.12, side === 'n' ? z0 - 0.15 : z1, bx1 + 0.1, y, side === 'n' ? z0 : z1 + 0.15, this.M.concrete, 1, false);
          else this.vis(side === 'w' ? x0 - 0.15 : x1, y - 0.12, bz0 - 0.1, side === 'w' ? x0 : x1 + 0.15, y, bz1 + 0.1, this.M.concrete, 1, false);
          if (boarded) {
            for (let k = 0; k < 3; k++) {
              const py = y + 0.3 + k * 0.5;
              if (along) this.vis(bx0 - 0.1, py, side === 'n' ? bz0 - 0.04 : bz1, bx1 + 0.1, py + 0.22, side === 'n' ? bz0 : bz1 + 0.04, this.M.wood, 1, false);
              else this.vis(side === 'w' ? bx0 - 0.04 : bx1, py, bz0 - 0.1, side === 'w' ? bx0 : bx1 + 0.04, py + 0.22, bz1 + 0.1, this.M.wood, 1, false);
            }
          }
        }
      }
    };
    put('n'); put('s'); put('e'); put('w');
  }

  private streetlight(x: number, z: number, rot: number, real = false): void {
    this.prop('streetlight', x, z, rot);
    const [dx, dz] = rotXZ(0, 1.75, rot);
    const lx = x + dx, lz = z + dz;
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), this.M.lightPoolWarm);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(lx, 0.05, lz);
    this.root.add(pool);
    const g = new THREE.Sprite(this.M.glowWarm);
    g.position.set(lx, 6.9, lz);
    g.scale.set(2.4, 2.4, 1);
    this.root.add(g);
    if (real) this.addLight(0xffb070, 22, 20, lx, 6.5, lz, 'steady');
  }

  private addLight(color: number, intensity: number, dist: number, x: number, y: number, z: number, mode: AnimatedLight['mode']): THREE.PointLight {
    // Intensities are authored as relative values; scale into three.js physical candela.
    intensity *= 4;
    const l = new THREE.PointLight(color, intensity, dist * 1.3, 1.6);
    l.position.set(x, y, z);
    this.root.add(l);
    this.lights.push({ light: l, base: intensity, mode, phase: this.rng.range(0, 10) });
    return l;
  }

  private beacon(x: number, y: number, z: number, mat: THREE.SpriteMaterial, size = 1.6): THREE.Sprite {
    const s = new THREE.Sprite(mat.clone());
    s.position.set(x, y, z);
    s.scale.set(size, size, 1);
    s.userData.phase = this.rng.range(0, 6);
    this.root.add(s);
    this.beacons.push(s);
    return s;
  }

  // ------------------------------------------------------------------------------------------
  // Districts
  // ------------------------------------------------------------------------------------------
  private buildGround(): void {
    const M = this.M;
    // Base ground: cracked concrete lot material across the whole district.
    this.quad(-90, -130, 90, 120, 0, M.concreteDark, 6);
    // Roads
    const road = (x0: number, z0: number, x1: number, z1: number) => {
      this.quad(x0, z0, x1, z1, 0.015, M.asphalt, 7);
      this.shapes.push({ x0, z0, x1, z1, kind: 'road' });
    };
    road(-7, -27, 7, 100); // Main street
    road(-70, 58, 70, 70); // Cross street
    road(-69, -24, 69, -13); // Perimeter road
    road(-66, 31, 7, 37.5); // Service lane (dock)
    // Lane markings: dashed centre line on main street, solid on cross street
    for (let z = -25; z < 98; z += 6) {
      if (z > 56 && z < 72) continue;
      this.quad(-0.1, z, 0.1, z + 3, 0.025, M.laneYellow, 1);
    }
    for (let x = -68; x < 68; x += 6) {
      if (x > -9 && x < 9) continue;
      this.quad(x, 63.9, x + 3, 64.1, 0.025, M.laneLine, 1);
    }
    for (let x = -66; x < 66; x += 6) {
      if (x > -9 && x < 9) continue;
      this.quad(x, -18.6, x + 3, -18.4, 0.025, M.laneLine, 1);
    }
    // Crosswalks at the main intersection
    for (let i = 0; i < 7; i++) {
      const x = -6 + i * 2;
      this.quad(x, 71.2, x + 1, 74, 0.025, M.laneLine, 1);
      this.quad(x, 54, x + 1, 56.8, 0.025, M.laneLine, 1);
    }
    // Sidewalks (raised 0.15, walkable curbs)
    const walk = (x0: number, z0: number, x1: number, z1: number) => {
      this.solid(x0, 0, z0, x1, 0.15, z1, M.sidewalk, 3, { floor: true, shadow: false });
      this.vis(x0, 0.0, z0, x1, 0.16, z0 + 0.12, M.concrete, 1, false);
      this.shapes.push({ x0, z0, x1, z1, kind: 'sidewalk' });
    };
    walk(-12, 73, -7, 99);
    walk(7, 73, 12, 99);
    walk(-70, 70, -12, 73);
    walk(12, 70, 69, 73);
    walk(-69, 55, -7, 58);
    walk(7, 55, 69, 58);
    walk(-12, 40, -7, 55);
    walk(7, 38, 12, 55);
    // Puddles
    const puddles: [number, number, number, number][] = [
      [-3, 80, 2.6, 1.6], [4, 66, 3.4, 1.8], [-5, 40, 2.2, 1.4], [2, 20, 3, 2], [-2, -6, 3.6, 2.2], [20, 62, 4, 2],
      [-40, 64, 3, 1.5], [-20, -18, 4, 2.5], [30, -20, 3, 1.8], [-4, -40, 3, 2], [18, -70, 3.5, 2.2], [45, 48, 3, 1.6], [-30, 34, 3, 1.6],
    ];
    for (const [x, z, w, d] of puddles) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(1, 20), M.puddle);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.03, z);
      m.scale.set(w, d, 1);
      m.rotation.z = this.rng.range(0, 3);
      this.root.add(m);
    }
  }

  private buildBoundary(): void {
    const M = this.M;
    const H = 6;
    // Perimeter walls (concrete with fence topping)
    this.solid(-71, 0, 99.2, 71, H, 101, M.concreteDark, 3);
    this.solid(-71, 0, -111, 71, H, -109.2, M.concreteDark, 3);
    this.solid(-71, 0, -111, -69.2, H, 101, M.concreteDark, 3);
    this.solid(69.2, 0, -111, 71, H, 101, M.concreteDark, 3);
    this.shapes.push({ x0: -71, z0: 99.2, x1: 71, z1: 101, kind: 'wall' }, { x0: -71, z0: -111, x1: 71, z1: -109.2, kind: 'wall' },
      { x0: -71, z0: -111, x1: -69.2, z1: 101, kind: 'wall' }, { x0: 69.2, z0: -111, x1: 71, z1: 101, kind: 'wall' });
    // Fence topping + posts along the perimeter (visual)
    const fenceTop = (ax: number, az: number, bx: number, bz: number) => {
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.floor(len / 3);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        this.deco('fencePanel', ax + (bx - ax) * t, az + (bz - az) * t, Math.abs(bx - ax) > 1 ? 0 : Math.PI / 2, H);
      }
    };
    fenceTop(-69, 100, 69, 100);
    fenceTop(-69, -110, 69, -110);
    fenceTop(-70, -108, -70, 98);
    fenceTop(70, -108, 70, 98);
    // Quarantine signs along the walls
    const qs = ['QUARANTINE ZONE', 'NO ENTRY - LETHAL FORCE AUTHORISED'];
    for (const z of [-80, -40, 10, 45, 85]) {
      this.sign(qs, -69.15, 3, z, Math.PI / 2, 4, 1.4, { bg: '#c9a227', fg: '#111', hazard: true });
      this.sign(qs, 69.15, 3, z + 7, -Math.PI / 2, 4, 1.4, { bg: '#c9a227', fg: '#111', hazard: true });
    }
    // Collapsed road barricades at the cross street ends
    for (const s of [-1, 1]) {
      const x = s * 66;
      this.prop('rubbleBig', x - s * 0.5, 61, 1);
      this.prop('container1', x, 66.5, 0);
      this.prop('jersey', x - s * 4.5, 60, 1);
      this.prop('jersey', x - s * 4.5, 63.4, 1);
      this.prop('hedgehog', x - s * 7, 68, 0);
      this.deco('rubble', x - s * 5, 68.5, 0.7);
    }
    // Perimeter road ends
    for (const s of [-1, 1]) {
      this.prop('rubbleBig', s * 65.5, -18.5, 1);
      this.prop('jersey', s * 61, -22, 1);
      this.prop('hedgehog', s * 61, -15, 0);
    }
    // Insertion gate: closed checkpoint gate behind the player spawn
    this.solid(-8, 0, 98.6, 8, 5, 99.2, M.metalDark, 2);
    for (let i = 0; i < 8; i++) this.vis(-7.6 + i * 2, 0.3, 98.4, -7.2 + i * 2, 4.8, 98.6, M.hazardYellow, 1);
    this.sign(['QUARANTINE CHECKPOINT 7', 'JOINT TASK FORCE ARGUS'], 0, 4.1, 98.35, Math.PI, 7, 1.6, { bg: '#1b1f1c', fg: '#e8e2cf', border: '#c9a227' });
  }

  private buildLowDistrict(): void {
    const M = this.M;
    // --- Pharmacy (enterable) -----------------------------------------------------------------
    this.building({
      x0: -28, z0: 76, x1: -12, z1: 92, h: 7.5, wall: M.brick, trim: M.concrete, enterable: true, interiorH: 3.4,
      doors: [{ side: 'e', a: 82, b: 84.6, h: 2.6 }, { side: 'n', a: -21, b: -19, h: 2.5 }],
      sign: { text: ['PHARMACY', '24 HR'], side: 'e', bg: '#1c3b2f', fg: '#7dffb0', y: 3.3, w: 5, glow: true }, lit: 0.1, roofClutter: true,
    });
    this.prop('shelf', -24, 80, 0); this.prop('shelf', -24, 84, 0); this.prop('shelf', -18, 80, 0);
    this.prop('counter', -16, 88.5, 0); this.prop('shelf', -26.9, 88, 1);
    this.deco('trash', -19, 85, 1); this.deco('crateSmall', -21.5, 88.5, 0.4);
    this.addLight(0xff3030, 9, 12, -20, 3, 84, 'flicker');
    // --- Auto garage (enterable, with a crouch-only side shutter) -------------------------------
    this.building({
      x0: 12, z0: 76, x1: 30, z1: 94, h: 6.5, wall: M.plasterBlue, trim: M.concreteDark, enterable: true, interiorH: 4.2,
      doors: [{ side: 'w', a: 80, b: 88, h: 3.6 }, { side: 'n', a: 24, b: 26, h: 2.4 }],
      sign: { text: ['MERIDIAN AUTO', 'REPAIR · TIRES'], side: 'w', bg: '#2a2d31', fg: '#f0b04a', y: 4.8, w: 6 }, lit: 0.05,
    });
    // Half-closed roller shutter on the north door: only a crouching player fits (1.25m gap).
    this.solid(24, 1.25, 75.95, 26, 2.4, 76.35, M.corrugated, 1, { surface: 'metal' });
    this.vis(23.9, 1.2, 75.8, 26.1, 1.3, 75.95, M.metalDark, 1);
    this.prop('sedan2', 20, 85, 0); this.prop('locker', 29.2, 80, 3); this.prop('locker', 29.2, 81, 3);
    this.prop('bench', 16, 92.5, 0); this.prop('barrel', 28.5, 92.5, 0); this.deco('spool', 26, 88, 0);
    // --- Solid blocks -----------------------------------------------------------------------
    this.building({ x0: -64, z0: 76, x1: -32, z1: 98, h: 12, wall: M.brickDark, trim: M.concrete, lit: 0.08, roofClutter: true });
    this.building({ x0: 36, z0: 78, x1: 66, z1: 98, h: 10, wall: M.plaster, trim: M.concreteDark, lit: 0.07, roofClutter: true,
      sign: { text: ['HOTEL VANTAGE'], side: 'w', bg: '#401d1d', fg: '#ffcf8a', y: 7, w: 7, glow: true } });
    this.building({ x0: -64, z0: 40, x1: -42, z1: 54, h: 9, wall: M.brick, trim: M.concrete, lit: 0.05 });
    this.building({ x0: -36, z0: 40, x1: -12, z1: 54, h: 11, wall: M.plaster, trim: M.concreteDark, lit: 0.08, roofClutter: true,
      sign: { text: ['CIVIC RECORDS'], side: 's', bg: '#23282c', fg: '#d8d4c8', y: 4.5, w: 6 } });
    // --- Insertion checkpoint ----------------------------------------------------------------
    this.prop('humvee', -4, 87, 0);
    this.prop('truck', 5.5, 93.5, 2);
    this.prop('tent', -8.5, 95, 0);
    this.prop('sandbags', -3, 80.5, 0); this.prop('sandbags', -1, 80.5, 0); this.prop('sandbags', 3, 80.5, 0); this.prop('sandbags', 5, 80.5, 0);
    this.prop('sandbags', -5.3, 81.5, 1);
    this.prop('crate', 9.5, 91.5, 0); this.prop('crateSmall', 10, 85, 1); this.prop('crateSmall', 8.2, 97.5, 0);
    this.prop('floodlight', -3.5, 96.8, 0);
    this.prop('generator', 1.5, 97.5, 0);
    this.addLight(0xd8e6ff, 28, 28, -6, 7, 93, 'steady');
    const flood = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), M.lightPoolCold);
    flood.rotation.x = -Math.PI / 2; flood.position.set(-4, 0.05, 88); this.root.add(flood);
    this.prop('jersey', -4.5, 77.5, 0); this.prop('jersey', 4.5, 77.5, 0);
    // --- Streets: vehicles, lights and debris ------------------------------------------------
    this.streetlight(-8.2, 84, 1, false); this.streetlight(8.2, 71.8, 3, true);
    this.streetlight(-8.2, 48, 1); this.streetlight(8.2, 26, 3); this.streetlight(-8.2, 6, 1, true);
    this.streetlight(-30, 71.5, 2); this.streetlight(34, 56.5, 0); this.streetlight(-52, 56.5, 0); this.streetlight(56, 71.5, 2);
    this.prop('sedan0', -4, 66, 1); this.prop('sedanBurnt', 3.5, 60.5, 0); this.prop('sedan1', -24, 61, 1);
    this.prop('van', 22, 67, 1); this.prop('sedan3', 44, 60.5, 1); this.prop('sedanBurnt', -46, 66, 1);
    this.prop('sedan2', 4.5, 45, 0); this.prop('sedan0', -4.5, 29, 2); this.prop('sedanBurnt', 3.8, 8, 0);
    this.prop('dumpster', -31, 94, 1); this.prop('dumpster', -39, 43, 1); this.prop('dumpster', 33, 80, 1);
    this.deco('trash', -30.5, 90, 0.4); this.deco('trash', 32.5, 88, 2); this.deco('trash', -10.8, 76, 1); this.deco('trash', 10.8, 60, 2);
    this.deco('trash', -38, 50, 0.2); this.deco('trash', 10.5, 40, 1.5);
    this.prop('pole', -11.2, 56.5, 0); this.prop('pole', 11.2, 42, 0); this.prop('pole', -11.2, 20, 0);
    this.prop('barrier', -3, 72, 0); this.prop('barrier', 36, 64, 1);
    this.prop('cone', -1, 58.5, 0); this.deco('cone', 1.2, 57.8, 0.4); this.deco('cone', 5.6, 71.2, 0);
    this.prop('rubble', -18, 64.5, 0); this.prop('rubble', 50, 66.5, 1);
    this.prop('sandbags', 12, 57, 0); this.prop('sandbags', 14, 57, 0);
    this.cables([[-11.2, 8.8, 56.5], [11.2, 8.8, 42], [-11.2, 8.8, 20]]);
  }

  private cables(pts: [number, number, number][]): void {
    const verts: number[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      for (const off of [-0.9, 0.9]) {
        const a = pts[i], b = pts[i + 1];
        for (let s = 0; s < 16; s++) {
          const t0 = s / 16, t1 = (s + 1) / 16;
          const sag = (t: number) => -Math.sin(t * Math.PI) * 1.4;
          verts.push(a[0] + (b[0] - a[0]) * t0 + off, a[1] + sag(t0), a[2] + (b[2] - a[2]) * t0);
          verts.push(a[0] + (b[0] - a[0]) * t1 + off, a[1] + sag(t1), a[2] + (b[2] - a[2]) * t1);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    this.root.add(new THREE.LineSegments(g, this.M.cable));
  }

  private buildDepot(): void {
    const M = this.M;
    // --- Warehouse (enterable) ----------------------------------------------------------------
    this.building({
      x0: -60, z0: -8, x1: -20, z1: 26, h: 10, wall: M.corrugated, trim: M.metalDark, enterable: true, interiorH: 8.6,
      doors: [{ side: 'e', a: 4, b: 12, h: 5.2 }, { side: 'n', a: -42, b: -39.6, h: 2.5 }, { side: 's', a: -32, b: -29.6, h: 2.5 }],
      windows: false, interiorWall: M.corrugatedGreen, floorMat: M.concrete,
      sign: { text: ['KESSLER FREIGHT', 'DEPOT 4'], side: 'e', bg: '#1e2a36', fg: '#e3e0d6', y: 7.2, w: 9 },
    });
    // Roller door frame (raised shutter visible above the opening)
    this.vis(-19.9, 5.2, 3.8, -19.5, 6.2, 12.2, M.corrugated, 1);
    this.vis(-19.9, 0, 3.6, -19.4, 5.4, 4.0, M.hazardYellow, 1);
    this.vis(-19.9, 0, 12.0, -19.4, 5.4, 12.4, M.hazardYellow, 1);
    // Skylight strips / ceiling lights
    for (let x = -54; x <= -26; x += 7) {
      this.vis(x - 0.2, 8.3, -4, x + 0.2, 8.4, 22, M.lampCold, 1, false);
    }
    this.addLight(0xc8dcff, 40, 34, -44, 7.5, 5, 'steady');
    this.addLight(0xc8dcff, 30, 28, -30, 7.5, 16, 'steady');
    // Racks
    this.prop('rack', -50, 1.6, 0); this.prop('rack', -42, 1.6, 0); this.prop('rack', -34, 1.6, 0);
    this.prop('rack', -50, 10.6, 0); this.prop('rack', -42, 10.6, 0);
    this.prop('rack', -46, 18.6, 0); this.prop('rack', -38, 18.6, 0); this.prop('rack', -30, 18.6, 0);
    this.prop('forklift', -26, 17, 1);
    this.prop('pallets', -25, -4, 0); this.prop('pallets', -27, -5.8, 0); this.prop('crate', -23.2, -6, 0);
    this.prop('pallets', -56, 22.5, 0); this.prop('barrel', -57.5, 24.5, 0); this.prop('barrel', -58.5, 23.7, 0);
    this.prop('bench', -58.5, 6.5, 1); this.prop('locker', -59.2, 17.5, 1); this.prop('locker', -59.2, 18.5, 1);
    // --- Loading dock (raised platform + stairs) ----------------------------------------------
    this.solid(-58, 0, 26, -40, 1.2, 30.5, M.concrete, 2, { floor: true });
    for (let i = 0; i < 3; i++) this.solid(-40 + i * 0.8, 0, 26.6, -40 + (i + 1) * 0.8, 1.2 - 0.3 * (i + 1), 29.6, M.concrete, 1, { floor: true });
    this.vis(-58, 1.2, 30.2, -40, 1.26, 30.5, M.hazardYellow, 1);
    for (const x of [-55, -49, -43]) {
      this.vis(x - 1.8, 1.2, 25.8, x + 1.8, 4.6, 26.0, M.corrugated, 1); // closed shutters
      this.vis(x - 1.9, 0.3, 30.5, x - 1.5, 1.0, 30.8, M.rubber, 1);
      this.vis(x + 1.5, 0.3, 30.5, x + 1.9, 1.0, 30.8, M.rubber, 1);
    }
    // Dock railing on the platform's west end
    this.solid(-58, 1.2, 26, -57.8, 2.2, 30.5, M.hazardYellow, 1, { surface: 'metal' });
    this.shapes.push({ x0: -58, z0: 26, x1: -40, z1: 30.5, kind: 'prop' });
    this.prop('truck', -50, 34.9, 0);
    this.prop('crateSmall', -46, 27.5, 0, 1.2); this.prop('pallets', -44, 28, 0, 1.2);
    this.prop('sedan1', -30, 34, 1);
    // --- Yard: containers, gantry crane, transmitter ------------------------------------------
    this.shapes.push({ x0: 12, z0: -10, x1: 66, z1: 28, kind: 'yard' });
    this.quad(12, -12, 69, 29, 0.012, M.dirt, 6);
    const c = (n: number, x: number, z: number, rot: number, stack = 1) => {
      this.prop(`container${n}` as PropName, x, z, rot, 0, true);
      if (stack > 1) this.prop(`container${(n + 2) % 6}` as PropName, x, z, rot, 2.6);
    };
    // Row A (north), length along X
    c(0, 19, -6, 1, 1); c(1, 25.2, -6, 1, 2); c(3, 47, -6, 1, 1); c(4, 53.2, -6, 1, 2);
    // Row B (south)
    c(2, 18.5, 23.5, 1, 2); c(5, 24.7, 23.5, 1, 1); c(0, 50, 23.5, 1, 1); c(1, 56.2, 23.5, 1, 2); c(3, 62.4, 23.5, 1, 1);
    // East column, length along Z
    c(4, 63, 2, 0, 2); c(2, 63, 11, 0, 1);
    // Mid-yard stacks forming cover lanes around the transmitter
    c(5, 28, 8, 0, 1); c(3, 52, 12, 0, 2); c(1, 35.5, 17, 1, 1);
    // Gantry crane
    for (const [x, z] of [[30, -1], [30, 17], [50, -1], [50, 17]]) this.solid(x - 0.5, 0, z - 0.5, x + 0.5, 13, z + 0.5, M.hazardYellow, 2, { surface: 'metal' });
    this.vis(29.5, 13, -1.5, 30.5, 14.2, 17.5, M.hazardYellow, 2);
    this.vis(49.5, 13, -1.5, 50.5, 14.2, 17.5, M.hazardYellow, 2);
    this.vis(29, 14.2, 3, 51, 15.4, 5, M.hazardYellow, 2);
    this.vis(29, 14.2, 11, 51, 15.4, 13, M.hazardYellow, 2);
    this.vis(37, 12.5, 2.6, 41, 14.2, 5.4, M.metalDark, 1);
    this.beacon(30, 15.8, 4, M.glowRed, 1.2); this.beacon(50, 15.8, 12, M.glowRed, 1.2);
    // Transmitter mast on a pad
    const T = this.poi.transmitter;
    this.solid(T.x - 3, 0, T.z - 3, T.x + 3, 0.3, T.z + 3, M.concrete, 2, { floor: true, shadow: false });
    this.solid(T.x - 0.6, 0.3, T.z - 0.6, T.x + 0.6, 16, T.z + 0.6, M.metalDark, 1, { surface: 'metal' });
    for (let y = 1.3; y < 16; y += 1.4) {
      this.vis(T.x - 0.75, y, T.z - 0.75, T.x + 0.75, y + 0.08, T.z + 0.75, M.steel, 1);
    }
    this.vis(T.x - 0.05, 16, T.z - 0.05, T.x + 0.05, 19, T.z + 0.05, M.steel, 1);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1]]) this.vis(T.x + dx * 0.6 - 0.35, 12, T.z + dz * 0.6 - 0.35, T.x + dx * 0.6 + 0.35, 13.4, T.z + dz * 0.6 + 0.35, M.white, 1);
    this.prop('generator', T.x + 2.6, T.z - 1.4, 1, 0.3);
    this.solid(T.x - 2.4, 0.3, T.z + 1.2, T.x - 1.2, 1.5, T.z + 2.2, M.olive, 1, { surface: 'metal' }); // control console
    this.vis(T.x - 2.3, 1.1, T.z + 2.21, T.x - 1.3, 1.4, T.z + 2.24, M.screenAmber, 1, false);
    this.transmitterBeacon = this.beacon(T.x, 19.3, T.z, M.glowRed, 2.2);
    this.addLight(0xff3020, 10, 18, T.x, 4, T.z, 'pulse');
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(18, 18), new THREE.MeshBasicMaterial({ map: M.tex.ring, color: 0xffa040, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(T.x, 0.35, T.z);
    ring.visible = false;
    this.root.add(ring);
    this.defenseRing = ring;
    this.sign(['UPLINK RELAY 03', 'ARGUS SIGNALS'], T.x - 1.8, 2.4, T.z + 2.25, 0, 1.8, 0.6, { bg: '#20262a', fg: '#ffb34d' });
    // Yard clutter
    this.prop('forklift', 40, 20, 0); this.prop('spool', 22, 14, 0); this.prop('spool', 45, 0, 1);
    this.prop('pallets', 58, -1, 0); this.prop('barrel', 36, -2.5, 0); this.prop('barrel', 36.8, -1.8, 0);
    this.prop('floodlight', 16, -1, 1); this.prop('crate', 57, 17, 0); this.prop('crate', 58.3, 17.5, 0);
    this.prop('jersey', 14, 30, 0); this.prop('jersey', 60, 30, 0);
    for (let x = 18; x < 58; x += 3) if (x < 34 || x > 44) this.prop('fencePanel', x, 30.5, 0);
    this.shapes.push({ x0: 16.5, z0: 30.4, x1: 33.5, z1: 30.6, kind: 'fence' }, { x0: 44.5, z0: 30.4, x1: 57.5, z1: 30.6, kind: 'fence' });
    // Perimeter road clutter
    this.prop('sedanBurnt', -30, -20, 1); this.prop('truck', 26, -18.5, 1); this.prop('barrier', -48, -15, 0);
    this.prop('sedan3', 52, -21, 1); this.prop('rubble', -10, -14.5, 0);
    this.streetlight(-24, -12.4, 0); this.streetlight(40, -12.4, 0);
  }

  private buildCompound(): void {
    const M = this.M;
    // Compound wall with the main gate and a collapsed breach
    const wz0 = -27, wz1 = -26;
    const H = 4.6;
    this.solid(-69.2, 0, wz0, -6, H, wz1, M.concrete, 2);
    this.solid(6, 0, wz0, 44, H, wz1, M.concrete, 2);
    this.solid(50, 0, wz0, 69.2, H, wz1, M.concrete, 2);
    this.shapes.push({ x0: -69.2, z0: wz0, x1: -6, z1: wz1, kind: 'wall' }, { x0: 6, z0: wz0, x1: 44, z1: wz1, kind: 'wall' }, { x0: 50, z0: wz0, x1: 69.2, z1: wz1, kind: 'wall' });
    for (let x = -67.5; x < 68; x += 3) {
      if ((x > -7 && x < 7) || (x > 43 && x < 51)) continue;
      this.deco('fencePanel', x, wz0 + 0.5, 0, H);
    }
    // Razor wire coils along the wall top
    const coilGeo = new THREE.TorusGeometry(0.35, 0.02, 4, 10);
    const coils = new THREE.InstancedMesh(coilGeo, M.steel, 180);
    let ci = 0;
    const tmp = new THREE.Object3D();
    for (let x = -68; x < 68 && ci < 180; x += 0.8) {
      if ((x > -6 && x < 6) || (x > 44 && x < 50)) continue;
      tmp.position.set(x, H + 2.8, wz0 + 0.5);
      tmp.rotation.set(0, Math.PI / 2, 0);
      tmp.updateMatrix();
      coils.setMatrixAt(ci++, tmp.matrix);
    }
    coils.count = ci;
    this.root.add(coils);
    // Breach rubble (passable path through the middle)
    this.prop('rubble', 43, -24, 0); this.prop('rubble', 51, -29, 1);
    this.deco('rubble', 47, -26.5, 0.4);
    this.vis(44, 0, wz0 - 0.3, 45.2, 2.2, wz1 + 0.2, M.concreteDark, 1);
    this.vis(48.8, 0, wz0 - 0.2, 50, 3.0, wz1 + 0.3, M.concreteDark, 1);
    // Gate: guard booth + barrier arms
    this.solid(6.5, 0, -32, 9.5, 2.8, -29, M.white, 2);
    this.vis(6.4, 2.8, -32.1, 9.6, 3.0, -28.9, M.metalDark, 1);
    this.vis(6.45, 1.2, -31, 6.5, 2.2, -29.6, M.glass, 1, false);
    this.vis(-6, 1.0, -26.6, 0.5, 1.12, -26.4, M.red, 1);
    this.vis(-0.5, 1.0, -26.6, 0, 1.12, -26.4, M.white, 1);
    this.solid(-6.4, 0, -26.8, -5.8, 1.2, -26.2, M.metalDark, 1);
    this.solid(5.8, 0, -26.8, 6.4, 1.2, -26.2, M.metalDark, 1);
    this.sign(['HALCYON BIOTECHNICA', 'RESTRICTED · BIOHAZARD LEVEL 4'], 0, 5.2, -25.9, 0, 9, 1.8, { bg: '#e6e6e0', fg: '#8a1a14', symbol: 'bio' });
    this.vis(-6, 4.3, -26.8, 6, 6.2, -26.2, M.metalDark, 1);
    for (const x of [-30, 25, 60]) this.sign(['BIOHAZARD', 'CONTAMINATION BEYOND'], x, 2.5, -25.95, 0, 3, 1.2, { bg: '#c9a227', fg: '#111', symbol: 'bio' });
    this.shapes.push({ x0: -69, z0: -109, x1: 69, z1: -27, kind: 'compound' });
    this.quad(-69, -109, 69, -27, 0.012, M.concrete, 5);
    // Compound internal road
    this.quad(-5, -70, 5, -27, 0.02, M.asphalt, 7);

    // --- Reactor containment tower (landmark) ------------------------------------------------
    const R = this.poi.reactor;
    const tower = new THREE.Group();
    tower.position.set(R.x, 0, R.z);
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(7.2, 9, 26, 32, 1, true), M.concreteDark);
    shell.position.y = 13;
    shell.castShadow = shell.receiveShadow = true;
    tower.add(shell);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(7.4, 7.4, 1.2, 32), M.metalDark);
    cap.position.y = 26.4;
    tower.add(cap);
    for (let i = 0; i < 6; i++) {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(9.15 - i * 0.33, 9.15 - i * 0.33, 0.4, 32, 1, true), M.metalDark);
      ring.position.y = 2.2 + i * 4.2;
      tower.add(ring);
    }
    // Glowing vents around the base
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const v = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.2), M.toxicGlow);
      v.position.set(Math.cos(a) * 8.85, 3.5, Math.sin(a) * 8.85);
      v.lookAt(Math.cos(a) * 20, 3.5, Math.sin(a) * 20);
      tower.add(v);
      const band = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 0.2), M.toxicGlow);
      band.position.set(Math.cos(a) * 7.5, 22, Math.sin(a) * 7.5);
      band.lookAt(Math.cos(a) * 20, 22, Math.sin(a) * 20);
      tower.add(band);
    }
    // Service ladder + gantry
    const ladder = new THREE.Mesh(new THREE.BoxGeometry(0.8, 24, 0.3), M.steel);
    ladder.position.set(0, 13, 8.4);
    ladder.rotation.x = -0.075;
    tower.add(ladder);
    this.root.add(tower);
    this.beacon(R.x, 27.8, R.z, M.glowRed, 3.5);
    this.beacon(R.x + 7, 26.5, R.z, M.glowRed, 1.6);
    this.beacon(R.x - 7, 26.5, R.z, M.glowRed, 1.6);
    const toxicPool = new THREE.Mesh(new THREE.PlaneGeometry(34, 34), M.lightPoolToxic);
    toxicPool.rotation.x = -Math.PI / 2; toxicPool.position.set(R.x, 0.06, R.z); this.root.add(toxicPool);
    this.addLight(0xa04cff, 30, 34, R.x, 5, R.z + 12, 'pulse');
    // Octagon collider approximation
    this.world.add(R.x - 9, 0, R.z - 3.7, R.x + 9, 26, R.z + 3.7, { surface: 'concrete' });
    this.world.add(R.x - 3.7, 0, R.z - 9, R.x + 3.7, 26, R.z + 9, { surface: 'concrete' });
    this.world.add(R.x - 6.5, 0, R.z - 6.5, R.x + 6.5, 26, R.z + 6.5, { surface: 'concrete' });
    this.shapes.push({ x0: R.x - 9, z0: R.z - 9, x1: R.x + 9, z1: R.z + 9, kind: 'building' });
    // Pipe racks from the tower to the lab
    this.prop('pipeRack', -14, -63, 1); this.prop('pipeRack', -20, -58.5, 0); this.prop('pipeRack', -26, -58.5, 0);
    this.vis(-29.5, 5.35, -59.1, -9, 5.8, -58.6, M.steel, 1);

    // --- Research lab (enterable) -------------------------------------------------------------
    this.building({
      x0: -58, z0: -68, x1: -30, z1: -44, h: 7.5, wall: M.white, trim: M.metalDark, enterable: true, interiorH: 3.6,
      doors: [{ side: 'e', a: -57, b: -54.4, h: 2.6 }, { side: 's', a: -47, b: -44.4, h: 2.6 }, { side: 'n', a: -40, b: -37.6, h: 2.6 }],
      interiorWall: M.white, floorMat: M.metal, lit: 0.12,
      sign: { text: ['HALCYON LAB B', 'VECTOR ANALYSIS'], side: 's', bg: '#dfe3e3', fg: '#1d3a4a', y: 4.3, w: 6 },
    });
    // Interior partition with a doorway
    this.wallZ(-44, -67.7, -44.3, 3.6, 0.2, M.white, [{ a: -59, b: -56.6, h: 2.4 }, { a: -51, b: -49, h: 2.4 }]);
    this.prop('labTable', -52, -64, 0); this.prop('labTable', -52, -60, 0); this.prop('labTable', -37, -64, 0);
    this.prop('tube', -35, -48.5, 0); this.prop('tube', -38, -48.5, 0); this.prop('tube', -41, -48.5, 0);
    this.prop('desk', -33, -60, 1); this.prop('locker', -57.2, -47, 1); this.prop('locker', -57.2, -48, 1);
    this.prop('shelf', -48.5, -66.9, 0);
    this.addLight(0xff2a2a, 8, 14, -44, 3, -56, 'flicker');
    // --- Decontamination area and military response -------------------------------------------
    this.prop('deconTent', 24, -40, 0); this.prop('deconTent', 31, -40, 0);
    this.prop('humvee', 16, -48, 0); this.prop('sandbags', 20, -34, 0); this.prop('sandbags', 22, -34, 0);
    this.prop('hazBarrel', 28, -46, 0); this.prop('hazBarrel', 28.7, -46.6, 0); this.prop('hazBarrel', 27.4, -46.8, 0);
    this.prop('floodlight', -20, -38, 3); this.prop('floodlight', 26, -96, 0);
    this.prop('crateSmall', 34, -46, 0); this.prop('crateSmall', 35, -45, 1);
    // --- Crashed helicopter wreck ----------------------------------------------------------------
    const wreck = new THREE.Group();
    wreck.position.set(42, 0, -82);
    wreck.rotation.set(0.12, 0.6, -0.3);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.4, 4.2, 4, 10), M.burnt);
    body.rotation.x = Math.PI / 2; body.position.y = 1.4; body.castShadow = true;
    wreck.add(body);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 5, 8), M.burnt);
    boom.rotation.x = Math.PI / 2 - 0.2; boom.position.set(0, 1.9, -5); boom.castShadow = true;
    wreck.add(boom);
    for (let i = 0; i < 3; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 5.5), M.metalDark);
      blade.position.set(0, 3, 0); blade.rotation.set(0.2 * i, i * 2.1, 0.3); blade.castShadow = true;
      wreck.add(blade);
    }
    this.root.add(wreck);
    this.world.add(39.5, 0, -85, 45, 2.6, -79, { surface: 'metal' });
    this.world.add(38, 0, -88, 41, 2.6, -85, { surface: 'metal' });
    this.shapes.push({ x0: 38, z0: -88, x1: 45, z1: -79, kind: 'prop' });
    const fire = new THREE.Sprite(M.glowWarm.clone());
    fire.position.set(42, 1.5, -82); fire.scale.set(4, 4, 1); this.root.add(fire);
    this.beacons.push(fire); fire.userData.phase = 0; fire.userData.fire = true;
    // --- Barrels, containers and a storage bunker ---------------------------------------------
    this.prop('container2', -50, -95, 1, 0, true); this.prop('container5', -43.8, -95, 1, 0, true); this.prop('container0', -50, -95, 1, 2.6);
    this.prop('container4', 54, -60, 0, 0, true); this.prop('container1', 54, -52, 0, 0, true);
    this.building({ x0: -20, z0: -104, x1: -2, z1: -92, h: 5, wall: M.concreteDark, trim: M.metalDark, windows: false,
      sign: { text: ['COLD STORAGE', 'AUTHORISED PERSONNEL'], side: 's', bg: '#3a3f44', fg: '#e0e0da', y: 3.2, w: 5 } });
    for (const [x, z] of [[-12, -88], [-10.8, -88.6], [12, -95], [13, -94.2], [48, -40], [-60, -34], [-59.2, -34.8], [58, -100]]) this.prop('hazBarrel', x, z, 0);
    for (const [x, z, s] of [[-11, -86.5, 3], [12.5, -93, 4], [47.5, -42, 3.5], [30, -60, 5], [-24, -80, 4]]) {
      const g = new THREE.Mesh(new THREE.CircleGeometry(1, 20), new THREE.MeshBasicMaterial({ color: 0x3aff3a, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
      g.rotation.x = -Math.PI / 2; g.position.set(x, 0.035, z); g.scale.set(s, s * 0.7, 1); this.root.add(g);
    }
    this.prop('jersey', -30, -34, 0); this.prop('jersey', -33, -34, 0); this.prop('hedgehog', 8, -40, 0); this.prop('hedgehog', -10, -46, 0);
    this.prop('truck', -8, -34, 1);
    this.prop('sedanBurnt', 60, -80, 0); this.prop('rubble', 20, -100, 0); this.prop('rubble', -64, -70, 1);
    this.prop('barrier', 36, -64, 0); this.prop('barrier', 40, -64, 0);
    // Spore particles drifting from the reactor
    const n = 400;
    const pos = new Float32Array(n * 3);
    this.sporeBase = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const a = this.rng.range(0, Math.PI * 2), r = this.rng.range(9, 38);
      this.sporeBase[i * 4] = R.x + Math.cos(a) * r;
      this.sporeBase[i * 4 + 1] = this.rng.range(0.3, 9);
      this.sporeBase[i * 4 + 2] = R.z + Math.sin(a) * r;
      this.sporeBase[i * 4 + 3] = this.rng.range(0, 10);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.spores = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0x9aff6a, size: 0.14, map: M.tex.glow, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.spores.frustumCulled = false;
    this.root.add(this.spores);
  }

  private buildLZ(): void {
    const M = this.M;
    const L = this.poi.lzPad;
    this.shapes.push({ x0: 14, z0: 38, x1: 64, z1: 54, kind: 'lot' });
    this.quad(14, 38, 64, 54, 0.018, M.asphalt, 7);
    for (let x = 16; x < 62; x += 3) {
      if (x > 30 && x < 52) continue;
      this.quad(x, 38.5, x + 0.12, 43, 0.026, M.laneLine, 1);
      this.quad(x, 49, x + 0.12, 53.5, 0.026, M.laneLine, 1);
    }
    // Helipad
    const padTex = signTexture(['H'], { bg: '#3b3f40', fg: '#e8e4d8', w: 512, h: 512, border: '#c9a227', font: 'Arial Black, Arial, sans-serif' });
    const pad = new THREE.Mesh(new THREE.CircleGeometry(7, 40), new THREE.MeshStandardMaterial({ map: padTex, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(L.x, 0.03, L.z);
    pad.receiveShadow = true;
    this.root.add(pad);
    this.lzMarker = pad;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.12, 8), M.screenAmber);
      l.position.set(L.x + Math.cos(a) * 7.3, 0.06, L.z + Math.sin(a) * 7.3);
      this.root.add(l);
    }
    // Radio / flare crate
    const R = this.poi.radio;
    this.solid(R.x - 0.5, 0, R.z - 0.4, R.x + 0.5, 0.9, R.z + 0.4, M.olive, 1, { surface: 'metal' });
    this.vis(R.x - 0.35, 0.9, R.z - 0.25, R.x + 0.15, 1.2, R.z + 0.25, M.oliveDark, 1);
    this.vis(R.x + 0.3, 0.9, R.z - 0.02, R.x + 0.34, 2.1, R.z + 0.02, M.steel, 1);
    this.vis(R.x - 0.3, 1.0, R.z + 0.26, R.x + 0.1, 1.15, R.z + 0.27, M.screenGreen, 1, false);
    this.sign(['EXFIL LZ', 'CALL SIGN: RAVEN 2-1'], 34, 1.4, 38.2, 0, 2.6, 0.9, { bg: '#1b1f1c', fg: '#c9a227' });
    this.solid(33, 0, 38.0, 35, 0.9, 38.15, M.metalDark, 1);
    this.addLight(0xffb060, 10, 22, L.x, 5, L.z, 'steady');
    this.prop('sedan0', 18, 41, 0); this.prop('sedan3', 21, 51, 2); this.prop('sedanBurnt', 58, 40.5, 0); this.prop('van', 60, 50.5, 2);
    this.prop('floodlight', 16, 47, 1); this.prop('jersey', 64.5, 46, 1); this.prop('sandbags', 25, 43, 1); this.prop('sandbags', 25, 49, 1);
    this.prop('crate', 55, 44, 0); this.prop('crateSmall', 55, 46, 1);
  }

  private buildSkyline(): void {
    // Distant silhouettes beyond the quarantine walls for depth (merged into two draw calls).
    const M = this.M;
    const rng = new Rng(7);
    const mat = new THREE.MeshStandardMaterial({ color: 0x1b2129, roughness: 1 });
    const litMat = new THREE.MeshBasicMaterial({ color: 0xffb060 });
    const blocks: THREE.BufferGeometry[] = [];
    const lits: THREE.BufferGeometry[] = [];
    const add = (x: number, z: number, w: number, d: number, h: number) => {
      blocks.push(new THREE.BoxGeometry(w, h, d).translate(x, h / 2, z));
      for (let i = 0; i < 6; i++) {
        if (!rng.chance(0.5)) continue;
        const g = new THREE.PlaneGeometry(1.2, 1.4);
        const wy = rng.range(4, h - 3);
        const off = rng.range(-0.4, 0.4);
        // Face toward the district centre so the lit windows are visible from inside.
        const toC = Math.atan2(-x, -z);
        const fx = Math.sin(toC), fz = Math.cos(toC);
        const half = Math.min(w, d) / 2 + 0.05;
        g.rotateY(toC);
        g.translate(x + fx * half + fz * off * w, wy, z + fz * half - fx * off * d);
        lits.push(g);
      }
    };
    for (let i = 0; i < 90; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(120, 190);
      const x = Math.cos(a) * r * 0.9, z = Math.sin(a) * r * 1.1 - 5;
      if (Math.abs(x) < 85 && z > -125 && z < 115) continue;
      add(x, z, rng.range(10, 26), rng.range(10, 26), rng.range(14, 55));
    }
    for (const z of [-40, 30]) {
      blocks.push(new THREE.CylinderGeometry(0.4, 1.2, 60, 6).translate(140, 30, z));
      this.beacon(140, 61, z, M.glowRed, 4);
    }
    const bm = mergeGeometries(blocks.map((g) => prep(g)), false);
    if (bm) this.root.add(new THREE.Mesh(bm, mat));
    if (lits.length) {
      const lm = mergeGeometries(lits.map((g) => prep(g)), false);
      if (lm) this.root.add(new THREE.Mesh(lm, litMat));
    }
  }

  private buildStationsColliders(): void {
    for (const s of this.poi.stations) {
      const w = s.kind === 'upgrade' ? 1.1 : 0.8;
      const d = s.kind === 'upgrade' ? 2.2 : 2.0;
      // Stations face along their yaw; footprint is aligned with X/Z.
      const alongZ = Math.abs(Math.sin(s.yaw)) > 0.5;
      const hx = alongZ ? w / 2 : d / 2, hz = alongZ ? d / 2 : w / 2;
      this.world.add(s.x - hx, 0, s.z - hz, s.x + hx, 1.6, s.z + hz, { surface: 'metal' });
      this.shapes.push({ x0: s.x - hx, z0: s.z - hz, x1: s.x + hx, z1: s.z + hz, kind: 'prop' });
    }
  }

  private buildCrateSpots(): void {
    const spots: [number, number, number, RegionId][] = [
      [-25.5, 90.5, 0, 'low'], [27, 90.6, 0, 'low'], [-30, 97.3, 0, 'low'], [-39, 47.5, 0, 'low'], [-66.5, 44, 0, 'low'], [33, 96.5, 0, 'low'],
      [-56, -4.5, 0, 'medium'], [-23.5, 22.5, 0, 'medium'], [-55, 28.3, 1.2, 'medium'], [62, -9.3, 0, 'medium'], [37, 25.5, 0, 'medium'], [-64, -25.1, 0, 'medium'],
      [-54, -49, 0, 'high'], [34.5, -48.5, 0, 'high'], [47, -88.5, 0, 'high'], [-14, -90.5, 0, 'high'], [62, -104, 0, 'high'],
    ];
    for (const [x, z, y, region] of spots) {
      this.poi.crates.push({ x, z, y, yaw: 0, region });
      this.world.add(x - 0.55, y, z - 0.35, x + 0.55, y + 0.62, z + 0.35, { surface: 'metal' });
    }
  }

  private buildSpawnPoints(): void {
    const raw: Record<RegionId, [number, number][]> = {
      low: [[-66, 64], [66, 64], [-30, 97], [33, 98], [-39, 49], [-66, 47], [-20, 74.5], [22, 74.5], [-50, 71.5], [50, 71.5], [0, 56]],
      medium: [[-66, -18], [66, -18], [-40, -6], [-62, 34], [66, 6], [64, 28], [20, -9], [-28, 20], [10, 34], [-50, 5], [44, 32], [-16, -2]],
      high: [[-66, -40], [66, -40], [-50, -104], [50, -104], [0, -106], [-44, -50], [30, -62], [-20, -90], [62, -72], [-62, -80], [20, -32], [-36, -38]],
    };
    const c = { x: 0, z: 0 };
    for (const r of Object.keys(raw) as RegionId[]) {
      for (const [x, z] of raw[r]) {
        const i = this.nav.nearestWalkable(x, z, 5);
        if (i < 0) continue;
        this.nav.cellCenter(i, c);
        this.poi.spawns[r].push({ x: c.x, z: c.z });
      }
    }
  }

  // ------------------------------------------------------------------------------------------
  update(time: number, dt: number): void {
    for (const b of this.beacons) {
      const m = b.material as THREE.SpriteMaterial;
      if (b.userData.fire) {
        m.opacity = 0.55 + Math.sin(time * 17) * 0.15 + Math.sin(time * 7.3) * 0.15;
      } else {
        const p = (time * 1.1 + b.userData.phase) % 1.6;
        m.opacity = p < 0.35 ? 1 : 0.12;
      }
    }
    for (const l of this.lights) {
      if (l.mode === 'flicker') {
        const f = Math.sin(time * 23 + l.phase) * Math.sin(time * 3.1 + l.phase * 2);
        l.light.intensity = f > 0.85 ? l.base * 0.15 : l.base * (0.9 + Math.sin(time * 40 + l.phase) * 0.05);
      } else if (l.mode === 'pulse') {
        l.light.intensity = l.base * (0.75 + Math.sin(time * 2.2 + l.phase) * 0.25);
      }
    }
    if (this.spores) {
      const pos = this.spores.geometry.attributes.position as THREE.BufferAttribute;
      const b = this.sporeBase;
      for (let i = 0; i < pos.count; i++) {
        const ph = b[i * 4 + 3] + time * 0.3;
        pos.setXYZ(i, b[i * 4] + Math.sin(ph * 1.3) * 1.5, b[i * 4 + 1] + ((time * 0.4 + ph) % 6), b[i * 4 + 2] + Math.cos(ph) * 1.5);
      }
      pos.needsUpdate = true;
    }
    void dt;
  }

  regionShapes(): MapShape[] {
    return this.shapes;
  }
}

function rotXZ(x: number, z: number, rot: number): [number, number] {
  const r = ((rot % 4) + 4) % 4;
  if (r === 0) return [x, z];
  if (r === 1) return [z, -x];
  if (r === 2) return [-x, -z];
  return [-z, x];
}

function splitSpan(a0: number, a1: number, openings: Opening[]): [number, number][] {
  const out: [number, number][] = [];
  const sorted = [...openings].sort((p, q) => p.a - q.a);
  let cur = a0;
  for (const o of sorted) {
    if (o.a > cur) out.push([cur, o.a]);
    cur = Math.max(cur, o.b);
  }
  if (cur < a1) out.push([cur, a1]);
  return out;
}

function surfaceFor(mat: THREE.Material, M: Materials): Surface {
  if (mat === M.corrugated || mat === M.corrugatedGreen || mat === M.metal || mat === M.metalDark || mat === M.steel || mat === M.olive || mat === M.hazardYellow) return 'metal';
  if (mat === M.wood) return 'wood';
  if (mat === M.dirt || mat === M.sandbag) return 'dirt';
  return 'concrete';
}
