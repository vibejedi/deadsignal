// Owns all zombies: pooling, behaviour updates, navigation, separation, hit tests and damage.
import * as THREE from 'three';
import { ENEMIES, type RegionId, type ZombieType } from '../config';
import type { AudioEngine } from '../audio/Audio';
import type { Effects } from '../fx/Effects';
import type { Level } from '../world/Level';
import { Zombie } from './Zombie';
import { ZombieModels } from './ZombieModel';
import type { TextureLib } from '../render/textures';
import { noTarget, pickTarget, type PlayerTarget } from './targeting';

export type { PlayerTarget } from './targeting';

export interface ZombieHit { z: Zombie; dist: number; head: boolean; x: number; y: number; z_: number }

export interface DamageOutcome { killed: boolean; head: boolean; armor: boolean; dealt: number }

export interface EnemyEvents {
  onKill(z: Zombie, head: boolean): void;
  onPlayerHit(playerId: number, dmg: number, fromX: number, fromZ: number, heavy: boolean): void;
}

export class EnemyManager {
  readonly group = new THREE.Group();
  readonly models: ZombieModels;
  readonly zombies: Zombie[] = [];
  private pool = new Map<string, Zombie[]>();
  private flowT = 0;
  private lastFlowKey = '';
  private hash = new Map<number, Zombie[]>();
  private seedCounter = 1;
  private time = 0;
  private dir = { x: 0, z: 0 };
  elite: Zombie | null = null;
  eliteAggro = false;
  alertLevel = 0;

  /** `rnd` is the shared, seeded simulation RNG so every machine in a session can reproduce the same run. */
  constructor(tex: TextureLib, private level: Level, private fx: Effects, private audio: AudioEngine, private events: EnemyEvents, private rnd: () => number = Math.random) {
    this.models = new ZombieModels(tex);
  }

  get aliveCount(): number {
    let n = 0;
    for (const z of this.zombies) if (z.alive && !z.elite) n++;
    return n;
  }

  countInRegion(r: RegionId): number {
    let n = 0;
    for (const z of this.zombies) if (z.alive && !z.elite && z.region === r) n++;
    return n;
  }

  reset(): void {
    for (const z of this.zombies) this.release(z);
    this.zombies.length = 0;
    this.elite = null;
    this.eliteAggro = false;
    this.lastFlowKey = '';
    this.flowT = 0;
  }

  private acquire(type: ZombieType): Zombie {
    const variants = this.models.variants[type];
    const v = variants[Math.floor(this.rnd() * variants.length)];
    const list = this.pool.get(v.key);
    let z = list?.pop();
    if (!z) {
      z = new Zombie();
      const inst = this.models.instantiate(v);
      z.variant = v;
      z.mesh = inst.mesh;
      z.bones = inst.bones;
      z.helmet = inst.helmet;
    }
    this.group.add(z.mesh);
    return z;
  }

  private release(z: Zombie): void {
    z.active = false;
    z.alive = false;
    z.mesh.visible = false;
    this.group.remove(z.mesh);
    let list = this.pool.get(z.variant.key);
    if (!list) this.pool.set(z.variant.key, (list = []));
    list.push(z);
  }

  spawn(type: ZombieType, region: RegionId, x: number, z: number, state: 'idle' | 'chase' = 'chase'): Zombie {
    const zb = this.acquire(type);
    const y = this.level.world.groundHeight(x, z, 0.3, 3);
    zb.spawn(type, region, x, z, y, this.seedCounter++ * 0.6180339 + this.rnd());
    if (state === 'chase') zb.setState('chase');
    this.zombies.push(zb);
    if (type === 'elite') this.elite = zb;
    return zb;
  }

  /** Alerts zombies within `radius` of a noise (gunfire, explosions). */
  noise(x: number, z: number, radius: number): void {
    const r2 = radius * radius;
    for (const zb of this.zombies) {
      if (!zb.alive || zb.state !== 'idle') continue;
      const dx = zb.pos.x - x, dz = zb.pos.z - z;
      if (dx * dx + dz * dz < r2) zb.setState(zb.type === 'runner' || zb.elite ? 'alert' : 'chase');
    }
  }

  // --------------------------------------------------------------------------------------------
  update(dt: number, players: readonly PlayerTarget[]): void {
    this.time += dt;
    const nav = this.level.nav;
    const world = this.level.world;
    // Shared flow field toward the nearest living player, refreshed on a timer or when anyone changes cell.
    this.flowT -= dt;
    const living = players.filter((t) => t.alive);
    const flowKey = living.map((t) => nav.cellOf(t.x, t.z)).join(',');
    if (living.length && (this.flowT <= 0 || (flowKey !== this.lastFlowKey && this.flowT < ENEMIES.flowFieldInterval * 0.5))) {
      nav.computeFlowMulti(living);
      this.lastFlowKey = flowKey;
      this.flowT = ENEMIES.flowFieldInterval;
    }
    // Spatial hash for separation
    this.hash.clear();
    for (const z of this.zombies) {
      if (!z.alive) continue;
      const k = hashKey(z.pos.x, z.pos.z);
      let arr = this.hash.get(k);
      if (!arr) this.hash.set(k, (arr = []));
      arr.push(z);
    }
    let alertCount = 0;
    let corpses = 0;
    for (let i = this.zombies.length - 1; i >= 0; i--) {
      const z = this.zombies[i];
      if (!z.alive) {
        corpses++;
        if (z.deathT > ENEMIES.corpseLifetime + 1.8 || (corpses > ENEMIES.maxCorpses && z.deathT > 1)) {
          this.release(z);
          this.zombies.splice(i, 1);
        }
        continue;
      }
      const target = pickTarget(z.pos.x, z.pos.z, players, z.targetId) ?? noTarget(z.pos.x, z.pos.y, z.pos.z);
      z.targetId = target.id;
      this.think(z, dt, target);
      if (z.state === 'chase' || z.state === 'attack') alertCount++;
      this.moveZombie(z, dt, world);
    }
    this.alertLevel = alertCount;
  }

  private think(z: Zombie, dt: number, p: PlayerTarget): void {
    z.stateT += dt;
    z.attackCD = Math.max(0, z.attackCD - dt);
    const dx = p.x - z.pos.x, dz = p.z - z.pos.z;
    const dist = Math.hypot(dx, dz);
    const world = this.level.world;
    const nav = this.level.nav;
    let desiredSpeed = 0;
    let dirX = 0, dirZ = 0;
    // Staggered line-of-sight evaluation
    z.losT -= dt;
    if (z.losT <= 0) {
      z.losT = ENEMIES.losCheckInterval + this.rnd() * 0.1;
      const eyeY = z.pos.y + 1.55 * z.scale;
      z.hasLOS = dist < 60 && !world.segmentBlocked(z.pos.x, eyeY, z.pos.z, p.x, p.eyeY, p.z);
    }
    z.voiceT -= dt;
    if (z.voiceT <= 0) {
      z.voiceT = 3 + this.rnd() * 6;
      if (dist < 35) this.audio.zombieVoice(z.pos, z.elite ? 'elite' : 'groan', z.type === 'runner' ? 1.3 : z.type === 'armored' ? 0.8 : 1);
    }

    switch (z.state) {
      case 'idle': {
        // Wander a little around the spawn position.
        z.wanderT -= dt;
        if (z.wanderT <= 0) {
          z.wanderT = 3 + this.rnd() * 5;
          const a = this.rnd() * Math.PI * 2;
          z.wanderX = z.pos.x + Math.cos(a) * 4;
          z.wanderZ = z.pos.z + Math.sin(a) * 4;
          if (!nav.isWalkable(z.wanderX, z.wanderZ) || this.rnd() < 0.4) { z.wanderX = z.pos.x; z.wanderZ = z.pos.z; }
        }
        const wx = z.wanderX - z.pos.x, wz = z.wanderZ - z.pos.z;
        const wl = Math.hypot(wx, wz);
        if (wl > 0.5) { dirX = wx / wl; dirZ = wz / wl; desiredSpeed = 0.5; }
        const sight = z.elite ? 30 : ENEMIES.sightRange;
        if (p.alive && (dist < 6 || (dist < sight && z.hasLOS))) {
          z.setState(z.type === 'runner' || z.elite ? 'alert' : 'chase');
          if (z.elite) { this.eliteAggro = true; this.audio.zombieVoice(z.pos, 'elite'); }
        }
        break;
      }
      case 'alert': {
        dirX = dx / (dist || 1); dirZ = dz / (dist || 1);
        if (z.stateT === dt || z.stateT < dt * 1.5) this.audio.zombieVoice(z.pos, z.elite ? 'elite' : 'scream', z.type === 'runner' ? 1.2 : 1);
        if (z.stateT > (z.elite ? 1.1 : 0.55)) z.setState('chase');
        break;
      }
      case 'chase': {
        if (!p.alive) { z.setState('idle'); break; }
        const range = z.def.attackRange;
        const dy = Math.abs(p.y - z.pos.y);
        if (dist < range && dy < 1.9 && z.attackCD <= 0 && z.hasLOS) {
          z.setState('attack');
          this.audio.zombieVoice(z.pos, z.elite ? 'elite' : 'attack', z.type === 'runner' ? 1.2 : 1);
          break;
        }
        // Direct pursuit when there's a clear walkable line, otherwise follow the flow field.
        if (dist < 28 && z.hasLOS && (dist < 3 || nav.walkLine(z.pos.x, z.pos.z, p.x, p.z))) {
          dirX = dx / (dist || 1); dirZ = dz / (dist || 1);
        } else if (nav.flowDir(z.pos.x, z.pos.z, this.dir)) {
          dirX = this.dir.x; dirZ = this.dir.z;
        } else {
          dirX = dx / (dist || 1); dirZ = dz / (dist || 1);
        }
        // Stuck detection -> brief sidestep
        z.stuckT += dt;
        if (z.stuckT > 1.2) {
          const moved = Math.hypot(z.pos.x - z.lastX, z.pos.z - z.lastZ);
          if (moved < 0.35 && dist > range + 0.5) { z.sideStepT = 0.6; z.sideSign = this.rnd() < 0.5 ? -1 : 1; }
          z.lastX = z.pos.x; z.lastZ = z.pos.z; z.stuckT = 0;
        }
        if (z.sideStepT > 0) {
          z.sideStepT -= dt;
          const sx = -dirZ * z.sideSign, sz = dirX * z.sideSign;
          dirX = dirX * 0.3 + sx; dirZ = dirZ * 0.3 + sz;
          const l = Math.hypot(dirX, dirZ) || 1; dirX /= l; dirZ /= l;
        }
        desiredSpeed = z.speed * (dist < range + 0.3 ? 0.2 : 1);
        // Elite charges when it has a clear line at mid range
        if (z.elite && z.hasLOS && dist > 6 && dist < 16) desiredSpeed = 5.2;
        break;
      }
      case 'attack': {
        const wind = z.def.windup;
        if (z.stateT < wind) {
          dirX = dx / (dist || 1); dirZ = dz / (dist || 1);
          desiredSpeed = z.type === 'runner' ? 1.5 : 0.4; // slight lunge
        }
        if (!z.attackResolved && z.stateT >= wind) {
          z.attackResolved = true;
          this.resolveAttack(z, p);
        }
        if (z.stateT >= wind + 0.4) {
          z.attackCD = z.def.attackCooldown * (0.85 + this.rnd() * 0.3);
          z.setState('chase');
        }
        break;
      }
      case 'stagger': {
        desiredSpeed = 0;
        if (z.stateT > 0.45) z.setState('chase');
        break;
      }
    }
    // Smooth turning toward movement direction
    if (dirX !== 0 || dirZ !== 0) {
      const targetYaw = Math.atan2(dirX, dirZ);
      let d = targetYaw - z.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      z.yaw += d * Math.min(1, dt * (z.state === 'attack' ? 5 : 8));
    }
    // Acceleration toward desired velocity
    const tvx = dirX * desiredSpeed, tvz = dirZ * desiredSpeed;
    const acc = Math.min(1, dt * (z.type === 'runner' ? 8 : 5));
    z.vel.x += (tvx - z.vel.x) * acc;
    z.vel.z += (tvz - z.vel.z) * acc;
  }

  private resolveAttack(z: Zombie, p: PlayerTarget): void {
    if (!p.alive) return;
    const world = this.level.world;
    const dx = p.x - z.pos.x, dz = p.z - z.pos.z;
    const dist = Math.hypot(dx, dz);
    const reach = z.def.attackRange + (z.elite ? 1.0 : 0.45);
    const dy = Math.abs(p.y - z.pos.y);
    this.audio.zombieSwipe(z.pos);
    if (z.elite) {
      this.audio.eliteSlam(z.pos);
      this.fx.explosion(z.pos.x + Math.sin(z.yaw) * 1.2, 0, z.pos.z + Math.cos(z.yaw) * 1.2, true);
    }
    if (dist > reach || dy > 1.9) return;
    // Facing check (within ~70 degrees) except for the elite's area slam.
    if (!z.elite) {
      const fx = Math.sin(z.yaw), fz = Math.cos(z.yaw);
      if ((dx * fx + dz * fz) / (dist || 1) < 0.35) return;
    }
    // No hits through walls: chest-to-chest segment must be clear.
    const zy = z.pos.y + 1.2 * z.scale;
    if (world.segmentBlocked(z.pos.x, zy, z.pos.z, p.x, p.y + 1.2, p.z)) return;
    this.events.onPlayerHit(p.id, z.def.damage * z.damageMult, z.pos.x, z.pos.z, z.elite || z.type === 'armored');
  }

  private moveZombie(z: Zombie, dt: number, world: Level['world']): void {
    // Separation from neighbours
    let sx = 0, sz = 0;
    const cx = Math.floor(z.pos.x / 2), cz = Math.floor(z.pos.z / 2);
    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        const arr = this.hash.get(((cx + ox) & 0xffff) | (((cz + oz) & 0xffff) << 16));
        if (!arr) continue;
        for (const o of arr) {
          if (o === z) continue;
          const dx = z.pos.x - o.pos.x, dz = z.pos.z - o.pos.z;
          const min = z.radius + o.radius + 0.15;
          const d2 = dx * dx + dz * dz;
          if (d2 < min * min && d2 > 1e-6) {
            const d = Math.sqrt(d2);
            const push = (min - d) / min;
            sx += (dx / d) * push;
            sz += (dz / d) * push;
          }
        }
      }
    }
    const sep = 3.2;
    const vx = z.vel.x + sx * sep, vz = z.vel.z + sz * sep;
    z.vy -= 20 * dt;
    const res = world.move(z.pos, z.radius, z.height * 0.95, vx * dt, z.vy * dt, vz * dt, 0.5, z.grounded);
    if (res.grounded) z.vy = 0;
    z.grounded = res.grounded;
    if (res.blockedX) z.vel.x *= 0.5;
    if (res.blockedZ) z.vel.z *= 0.5;
  }

  /** Render-rate animation for all visible zombies (skinning happens on the GPU). */
  animate(dt: number, camX: number, camZ: number): void {
    for (const z of this.zombies) {
      const far = Math.hypot(z.pos.x - camX, z.pos.z - camZ) > 70;
      if (far && z.alive) { z.mesh.position.set(z.pos.x, z.pos.y, z.pos.z); z.mesh.rotation.set(0, z.yaw, 0); continue; }
      z.animate(dt, this.time);
    }
    this.group.updateMatrixWorld(true);
    for (const z of this.zombies) if (z.alive) z.updateHeadPos();
  }

  // --------------------------------------------------------------------------------------------
  /** Nearest zombie hit along a ray, up to maxDist. Head sphere is tested before the body box. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): ZombieHit | null {
    let best: ZombieHit | null = null;
    let bestD = maxDist;
    for (const z of this.zombies) {
      if (!z.alive) continue;
      // Broad reject: distance from ray to zombie centre
      const cx = z.pos.x - ox, cz = z.pos.z - oz;
      const along = cx * dx + cz * dz;
      if (along < -1 || along > bestD + 1.5) continue;
      const hr = 0.14 * z.scale;
      const hp = z.headPos;
      const t = raySphere(ox, oy, oz, dx, dy, dz, hp.x, hp.y, hp.z, hr);
      if (t !== null && t < bestD) {
        bestD = t;
        best = { z, dist: t, head: true, x: ox + dx * t, y: oy + dy * t, z_: oz + dz * t };
      }
      const r = z.elite ? 0.42 : 0.27 * z.scale;
      const top = z.pos.y + (hp.y - z.pos.y) - hr * 0.9;
      const tb = rayAABB(ox, oy, oz, dx, dy, dz, z.pos.x - r, z.pos.y, z.pos.z - r, z.pos.x + r, top, z.pos.z + r);
      if (tb !== null && tb < bestD - 1e-4) {
        bestD = tb;
        best = { z, dist: tb, head: false, x: ox + dx * tb, y: oy + dy * tb, z_: oz + dz * tb };
      }
    }
    return best;
  }

  /** Applies damage. Returns what happened (for hitmarkers / stats). */
  damage(z: Zombie, amount: number, head: boolean, hx: number, hy: number, hz: number, dirX: number, dirZ: number): DamageOutcome {
    const out: DamageOutcome = { killed: false, head, armor: false, dealt: 0 };
    if (!z.alive) return out;
    let dmg = amount;
    if (head) {
      if (z.helmetHp > 0) {
        // Helmet absorbs most of the damage until it breaks
        z.helmetHp -= amount;
        dmg = amount * 0.3;
        out.armor = true;
        if (z.helmetHp <= 0 && z.helmet) {
          z.helmet.visible = false;
          this.fx.sparkBurst(hx, hy, hz, 16, [1, 0.8, 0.4]);
          this.audio.impact('metal', { x: hx, z: hz });
        } else this.fx.sparkBurst(hx, hy, hz, 5, [1, 0.85, 0.5]);
      } else {
        dmg = amount * this.headMultFor();
      }
    } else {
      dmg = amount * z.def.bodyArmorMult;
      if (z.def.bodyArmorMult < 1 && this.rnd() < 0.4) this.fx.sparkBurst(hx, hy, hz, 3, [1, 0.8, 0.5]);
    }
    z.hp -= dmg;
    out.dealt = dmg;
    this.fx.bloodHit(hx, hy, hz, dirX, dirZ, head && !out.armor);
    // Being shot always wakes a zombie up
    if (z.state === 'idle') {
      z.setState(z.type === 'runner' || z.elite ? 'alert' : 'chase');
      if (z.elite) this.eliteAggro = true;
    }
    z.flinchV += Math.min(6, dmg / 25) * (z.elite ? 0.3 : 1);
    z.staggerDir = this.rnd() < 0.5 ? -1 : 1;
    if (z.hp <= 0) {
      this.kill(z, dirX, dirZ, head && !out.armor);
      out.killed = true;
    } else if (dmg >= z.def.staggerThreshold && z.state !== 'attack') {
      z.setState('stagger');
    } else if (dmg >= z.def.staggerThreshold && z.state === 'attack' && z.type !== 'armored' && !z.elite) {
      z.setState('stagger'); // heavy hits interrupt attack windups
    }
    return out;
  }

  /** Headshot multiplier is weapon-specific; the weapon system scales damage before calling. */
  private headMultFor(): number {
    return 1;
  }

  private kill(z: Zombie, dirX: number, dirZ: number, head: boolean): void {
    z.alive = false;
    z.state = 'dead';
    z.deathT = 0;
    // Fall away from the shot direction
    const fx = Math.sin(z.yaw), fz = Math.cos(z.yaw);
    z.fallDir = dirX * fx + dirZ * fz > 0 ? 1 : -1;
    z.vel.x = z.vel.z = 0;
    this.audio.zombieVoice(z.pos, 'death', z.elite ? 0.5 : 1);
    this.fx.deathPuff(z.pos.x, z.pos.y + 0.8, z.pos.z);
    this.fx.bloodPool(z.pos.x + dirX * 0.8, z.pos.z + dirZ * 0.8, z.elite ? 2 : 1);
    this.events.onKill(z, head);
  }

  /** Explosion damage with falloff; solid geometry between blast and target blocks it. */
  radiusDamage(x: number, y: number, zc: number, radius: number, maxDmg: number): { kills: number; hits: number } {
    const world = this.level.world;
    let kills = 0, hits = 0;
    for (const z of this.zombies) {
      if (!z.alive) continue;
      const dx = z.pos.x - x, dz = z.pos.z - zc;
      const d = Math.hypot(dx, dz, z.pos.y + 0.9 - y);
      if (d > radius) continue;
      const blockedChest = world.segmentBlocked(x, y + 0.3, zc, z.pos.x, z.pos.y + 1.0, z.pos.z);
      const blockedHead = world.segmentBlocked(x, y + 0.3, zc, z.headPos.x, z.headPos.y, z.headPos.z);
      if (blockedChest && blockedHead) continue;
      const falloff = 1 - Math.pow(d / radius, 1.4);
      const dmg = maxDmg * falloff * (z.elite ? 0.6 : 1);
      const len = Math.hypot(dx, dz) || 1;
      const r = this.damage(z, dmg, false, z.pos.x, z.pos.y + 1, z.pos.z, dx / len, dz / len);
      hits++;
      if (r.killed) kills++;
      else if (!z.elite && dmg > 40) z.setState('stagger');
    }
    return { kills, hits };
  }

  nearestAlive(x: number, z: number): number {
    let best = Infinity;
    for (const zb of this.zombies) if (zb.alive) best = Math.min(best, Math.hypot(zb.pos.x - x, zb.pos.z - z));
    return best;
  }
}

function hashKey(x: number, z: number): number {
  return (Math.floor(x / 2) & 0xffff) | ((Math.floor(z / 2) & 0xffff) << 16);
}

function raySphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cy: number, cz: number, r: number): number | null {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return null;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  if (d2 > r * r) return null;
  return tca - Math.sqrt(r * r - d2);
}

function rayAABB(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number | null {
  let tmin = 0, tmax = Infinity;
  const ax = [[ox, dx, x0, x1], [oy, dy, y0, y1], [oz, dz, z0, z1]];
  for (const [o, d, a, b] of ax) {
    if (Math.abs(d) < 1e-9) { if (o < a || o > b) return null; continue; }
    let t1 = (a - o) / d, t2 = (b - o) / d;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}
