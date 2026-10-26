// A single infected: behaviour state, physical body and procedural animation.
import * as THREE from 'three';
import { REGIONS, ZOMBIES, type RegionId, type ZombieDef, type ZombieType } from '../config';
import { BONE, type ZombieVariant } from './ZombieModel';

export type ZState = 'idle' | 'alert' | 'chase' | 'attack' | 'stagger' | 'dead';

export class Zombie {
  type: ZombieType = 'shambler';
  def: ZombieDef = ZOMBIES.shambler;
  region: RegionId = 'low';
  variant!: ZombieVariant;
  mesh!: THREE.SkinnedMesh;
  bones!: THREE.Bone[];
  helmet: THREE.Mesh | null = null;
  pos = { x: 0, y: 0, z: 0 };
  vel = { x: 0, z: 0 };
  vy = 0;
  yaw = 0;
  hp = 100;
  maxHp = 100;
  helmetHp = 0;
  state: ZState = 'idle';
  stateT = 0;
  speed = 1.5;
  scale = 1;
  attackCD = 0;
  attackResolved = false;
  /** Squad member this zombie is currently hunting (-1 = none). */
  targetId = -1;
  losT = 0;
  hasLOS = false;
  navT = 0;
  dirX = 0;
  dirZ = 0;
  wanderX = 0;
  wanderZ = 0;
  wanderT = 0;
  phase = 0;
  seed = 0;
  gait = 0; // 0 normal, 1 limp, 2 one arm dangling
  staggerDir = 0;
  flinch = 0;
  flinchV = 0;
  deathT = 0;
  fallDir = 1;
  voiceT = 0;
  stuckT = 0;
  lastX = 0;
  lastZ = 0;
  sideStepT = 0;
  sideSign = 1;
  alive = false;
  active = false;
  elite = false;
  headPos = new THREE.Vector3();
  damageMult = 1;
  reward = 0;
  grounded = true;
  lastDamageFromPlayer = false;

  spawn(type: ZombieType, region: RegionId, x: number, z: number, y: number, rngSeed: number): void {
    this.type = type;
    this.targetId = -1;
    this.def = ZOMBIES[type];
    this.region = region;
    const reg = REGIONS[region];
    this.elite = type === 'elite';
    this.maxHp = this.def.hp * (this.elite ? 1 : reg.hpMult);
    this.hp = this.maxHp;
    this.helmetHp = this.def.helmetHp * (this.elite ? 1 : reg.hpMult);
    this.damageMult = this.elite ? 1 : reg.damageMult;
    this.reward = this.def.reward * reg.rewardMult;
    this.pos = { x, y, z };
    this.vel = { x: 0, z: 0 };
    this.vy = 0;
    this.seed = rngSeed;
    const r = frac(rngSeed * 12.9898);
    this.speed = this.def.speed[0] + (this.def.speed[1] - this.def.speed[0]) * r;
    this.scale = this.def.scale * (0.95 + frac(rngSeed * 7.13) * 0.1);
    this.gait = type === 'shambler' ? Math.floor(frac(rngSeed * 3.7) * 3) : 0;
    this.phase = frac(rngSeed * 5.1) * Math.PI * 2;
    this.state = 'idle';
    this.stateT = 0;
    this.attackCD = 0;
    this.losT = frac(rngSeed * 2.3) * 0.3;
    this.navT = 0;
    this.hasLOS = false;
    this.deathT = 0;
    this.flinch = this.flinchV = 0;
    this.voiceT = 2 + frac(rngSeed * 9.1) * 6;
    this.stuckT = 0;
    this.sideStepT = 0;
    this.wanderT = 0;
    this.yaw = frac(rngSeed * 1.7) * Math.PI * 2;
    this.alive = true;
    this.active = true;
    this.lastX = x; this.lastZ = z;
    if (this.helmet) this.helmet.visible = true;
    this.mesh.visible = true;
    this.mesh.rotation.set(0, this.yaw, 0);
    this.mesh.scale.setScalar(this.scale);
    this.mesh.position.set(x, y, z);
  }

  setState(s: ZState): void {
    if (this.state === 'dead') return;
    this.state = s;
    this.stateT = 0;
    if (s === 'attack') this.attackResolved = false;
  }

  get height(): number {
    return 1.75 * this.scale;
  }

  get radius(): number {
    return (this.elite ? 0.45 : 0.28) * Math.min(1.2, this.scale);
  }

  /** Procedural animation. Runs at render rate with the frame delta. */
  animate(dt: number, time: number): void {
    const b = this.bones;
    const s = this.seed;
    const moveSpeed = Math.hypot(this.vel.x, this.vel.z);
    const runner = this.type === 'runner';
    const heavy = this.type === 'armored' || this.elite;
    // Gait frequency tied to actual ground speed so feet don't skate.
    const stride = runner ? 2.0 : heavy ? 1.35 : 1.1;
    this.phase += (moveSpeed / stride) * Math.PI * dt + dt * 0.3;
    const ph = this.phase;
    const amp = Math.min(1, moveSpeed / (runner ? 4 : 1.6));
    this.flinchV += (-120 * this.flinch - 14 * this.flinchV) * dt;
    this.flinch += this.flinchV * dt;

    // Reset
    for (const bone of b) bone.rotation.set(0, 0, 0);
    b[BONE.hips].position.y = 0.95;

    if (this.state === 'dead') {
      this.animateDeath(dt);
      return;
    }
    const limp = this.gait === 1 ? 0.45 : 1;
    const legA = (runner ? 0.85 : heavy ? 0.5 : 0.42) * amp;
    b[BONE.thighL].rotation.x = -Math.sin(ph) * legA * limp;
    b[BONE.thighR].rotation.x = Math.sin(ph) * legA;
    b[BONE.shinL].rotation.x = Math.max(0, Math.sin(ph + 1.3)) * legA * 1.5 * limp + 0.05;
    b[BONE.shinR].rotation.x = Math.max(0, Math.sin(ph + 1.3 + Math.PI)) * legA * 1.5 + 0.05;
    b[BONE.hips].position.y = 0.95 - Math.abs(Math.sin(ph)) * 0.035 * amp - (runner ? 0.04 * amp : 0);
    b[BONE.hips].rotation.y = Math.sin(ph) * 0.12 * amp;
    b[BONE.hips].rotation.z = this.gait === 1 ? Math.sin(ph) * 0.12 * amp + 0.05 : Math.sin(ph) * 0.04 * amp;

    const lean = runner ? 0.42 : heavy ? 0.12 : 0.22 + frac(s * 3.3) * 0.12;
    b[BONE.spine].rotation.x = lean * (0.5 + amp * 0.5) + this.flinch * -0.6;
    b[BONE.spine].rotation.y = this.flinch * 0.4 * this.staggerDir;
    b[BONE.chest].rotation.y = -Math.sin(ph) * (runner ? 0.2 : 0.1) * amp;
    b[BONE.chest].rotation.z = Math.sin(time * 0.7 + s) * 0.04;
    b[BONE.head].rotation.x = -lean * 0.6 + Math.sin(time * 1.3 + s * 4) * 0.08 + frac(s * 7.7) * 0.2 - 0.1;
    b[BONE.head].rotation.z = (frac(s * 5.5) - 0.5) * 0.5 + Math.sin(time * 0.9 + s) * 0.06;
    b[BONE.jaw].rotation.x = 0.1 + Math.max(0, Math.sin(time * 2.1 + s * 3)) * 0.15;

    // Arms by archetype
    if (runner) {
      b[BONE.armL].rotation.x = Math.sin(ph) * 1.0 * amp - 0.4;
      b[BONE.armR].rotation.x = -Math.sin(ph) * 1.0 * amp - 0.4;
      b[BONE.foreL].rotation.x = -1.3;
      b[BONE.foreR].rotation.x = -1.3;
      b[BONE.armL].rotation.z = 0.25;
      b[BONE.armR].rotation.z = -0.25;
    } else if (heavy) {
      b[BONE.armL].rotation.x = -0.35 + Math.sin(ph) * 0.35 * amp;
      b[BONE.armR].rotation.x = -0.35 - Math.sin(ph) * 0.35 * amp;
      b[BONE.foreL].rotation.x = -0.6;
      b[BONE.foreR].rotation.x = -0.6;
      b[BONE.armL].rotation.z = 0.3;
      b[BONE.armR].rotation.z = -0.3;
    } else {
      const reach = -1.25 - frac(s * 2.1) * 0.25;
      const wob = Math.sin(time * 1.7 + s) * 0.1;
      b[BONE.armL].rotation.x = reach + wob + Math.sin(ph) * 0.1;
      b[BONE.armR].rotation.x = this.gait === 2 ? 0.1 + Math.sin(ph) * 0.15 : reach - wob - Math.sin(ph) * 0.1;
      b[BONE.foreL].rotation.x = -0.25;
      b[BONE.foreR].rotation.x = this.gait === 2 ? 0 : -0.3;
      b[BONE.armL].rotation.z = 0.12;
      b[BONE.armR].rotation.z = -0.12;
    }
    if (this.state === 'idle') {
      // Swaying, head lolling, arms low
      const sway = Math.sin(time * 0.8 + s * 2);
      b[BONE.spine].rotation.x = 0.3;
      b[BONE.spine].rotation.z = sway * 0.08;
      b[BONE.head].rotation.x = 0.35;
      if (!runner && !heavy && amp < 0.3) {
        b[BONE.armL].rotation.x = -0.3 + sway * 0.1;
        b[BONE.armR].rotation.x = -0.2 - sway * 0.1;
      }
    } else if (this.state === 'alert') {
      const w = Math.min(1, this.stateT / 0.25);
      b[BONE.spine].rotation.x = -0.2 * w;
      b[BONE.head].rotation.x = -0.4 * w;
      b[BONE.jaw].rotation.x = 0.55 * w;
      b[BONE.armL].rotation.x = -0.6; b[BONE.armL].rotation.z = 0.8 * w;
      b[BONE.armR].rotation.x = -0.6; b[BONE.armR].rotation.z = -0.8 * w;
    } else if (this.state === 'attack') {
      const wind = this.def.windup;
      const t = this.stateT;
      const up = Math.min(1, t / wind);
      const strike = t > wind ? Math.min(1, (t - wind) / 0.14) : 0;
      const armUp = -2.7 * easeOut(up) + (2.7 - 0.5) * easeOut(strike);
      b[BONE.armL].rotation.x = armUp;
      b[BONE.armR].rotation.x = this.gait === 2 && !this.elite ? 0 : armUp + (this.elite ? 0 : 0.25);
      b[BONE.foreL].rotation.x = -0.4 * (1 - strike);
      b[BONE.foreR].rotation.x = -0.4 * (1 - strike);
      b[BONE.armL].rotation.z = 0.25; b[BONE.armR].rotation.z = -0.25;
      b[BONE.spine].rotation.x = -0.25 * up + 0.75 * strike;
      b[BONE.head].rotation.x = -0.3 * up + 0.2 * strike;
      b[BONE.jaw].rotation.x = 0.6;
    } else if (this.state === 'stagger') {
      b[BONE.spine].rotation.x = -0.5 * Math.max(0, 1 - this.stateT / 0.45);
      b[BONE.armL].rotation.x = -0.4; b[BONE.armR].rotation.x = 0.1;
    }
    this.mesh.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.mesh.rotation.set(0, this.yaw, 0);
  }

  private animateDeath(dt: number): void {
    this.deathT += dt;
    const b = this.bones;
    const t = Math.min(1, this.deathT / 0.75);
    const e = t * t;
    b[BONE.shinL].rotation.x = 0.8 * (1 - e) + 0.1;
    b[BONE.shinR].rotation.x = 0.4 * (1 - e) + 0.15;
    b[BONE.thighL].rotation.x = -0.4 * Math.sin(t * Math.PI);
    b[BONE.armL].rotation.x = -1.2 * (1 - t) - 2.6 * e * (this.fallDir < 0 ? 1 : 0.3);
    b[BONE.armR].rotation.x = -0.6 * (1 - t) - 2.4 * e * (this.fallDir < 0 ? 0.6 : 0.2);
    b[BONE.armL].rotation.z = 0.8 * e; b[BONE.armR].rotation.z = -0.9 * e;
    b[BONE.head].rotation.x = 0.5 * this.fallDir * e;
    b[BONE.head].rotation.z = 0.6 * e * (frac(this.seed) > 0.5 ? 1 : -1);
    b[BONE.jaw].rotation.x = 0.5;
    b[BONE.spine].rotation.x = 0.3 * this.fallDir * e;
    const ang = (Math.PI / 2) * this.fallDir * e;
    const sink = this.deathT > 7 ? (this.deathT - 7) * 0.35 : 0;
    this.mesh.position.set(this.pos.x, this.pos.y + Math.abs(Math.sin(ang)) * 0.14 * this.scale - sink, this.pos.z);
    this.mesh.rotation.set(0, this.yaw, 0);
    this.mesh.rotateX(ang);
  }

  updateHeadPos(): void {
    this.bones[BONE.head].getWorldPosition(this.headPos);
    this.headPos.y += 0.07 * this.scale;
  }
}

function frac(x: number): number {
  return x - Math.floor(x) ? Math.abs(Math.sin(x * 43758.5453)) % 1 : 0.5;
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}
