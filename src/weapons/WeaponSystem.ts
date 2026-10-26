// Runtime weapon handling: trigger logic, spread, ray/pellet resolution, recoil, switching and ADS.
import * as THREE from 'three';
import { PLAYER, WEAPONS, type WeaponId } from '../config';
import type { AudioEngine } from '../audio/Audio';
import type { Input } from '../core/Input';
import type { EnemyManager, DamageOutcome } from '../enemies/EnemyManager';
import type { Zombie } from '../enemies/Zombie';
import type { Effects } from '../fx/Effects';
import type { Loadout } from '../mission/Economy';
import type { Player } from '../player/Player';
import type { CollisionWorld } from '../world/Collision';
import type { ViewModel } from './ViewModel';
import {
  canFire, cancelReload, damageAtRange, effectiveStats, fire, isReloading, reloadProgress, startReload, updateWeapon, type WeaponState,
} from './WeaponState';

export interface HitFeedback { kind: 'body' | 'head' | 'kill' | 'armor'; }

export interface WeaponCallbacks {
  onHit(fb: HitFeedback): void;
  onShot(): void;
}

const TRACER_COLORS = [new THREE.Color(1.0, 0.75, 0.4), new THREE.Color(0.4, 0.8, 1.6), new THREE.Color(1.6, 0.5, 0.2)];

export class WeaponSystem {
  loadout: Loadout;
  adsT = 0;
  switchT = 0; // 0 up, 1 down
  private switchDir: 0 | 1 | -1 = 0;
  private switchTarget: 0 | 1 = 0;
  sinceShot = 10;
  private semiBuffer = 0;
  private bloom = 0;
  private lastReloadP = 0;
  private emptyClicked = false;
  throwT = 0;
  stats = { shots: 0, hits: 0, headshots: 0 };
  private tmp = new THREE.Vector3();
  private camQ = new THREE.Quaternion();

  constructor(loadout: Loadout, private vm: ViewModel, private audio: AudioEngine, private fx: Effects, private cb: WeaponCallbacks, private rnd: () => number = Math.random) {
    this.loadout = loadout;
  }

  get active(): WeaponState | null {
    return this.loadout.slots[this.loadout.active];
  }

  get switching(): boolean {
    return this.switchDir !== 0;
  }

  reset(loadout: Loadout): void {
    this.loadout = loadout;
    this.adsT = 0;
    this.switchT = 0;
    this.switchDir = 0;
    this.sinceShot = 10;
    this.semiBuffer = 0;
    this.bloom = 0;
    this.throwT = 0;
    this.emptyClicked = false;
    this.stats = { shots: 0, hits: 0, headshots: 0 };
    this.syncModel();
  }

  syncModel(): void {
    const w = this.active;
    this.vm.setWeapon(w ? w.id : null);
    for (const s of this.loadout.slots) if (s) this.vm.setTier(s.id, s.tier);
  }

  /** Begin switching to a slot (lower current, then raise the other). */
  requestSwitch(slot: 0 | 1): void {
    if (slot === this.loadout.active && this.switchDir === 0) return;
    if (!this.loadout.slots[slot]) return;
    const cur = this.active;
    if (cur) cancelReload(cur);
    this.switchTarget = slot;
    this.switchDir = 1;
    this.audio.weaponSwitch();
  }

  update(dt: number, input: Input, player: Player, blocked: { plating: boolean; menu: boolean }, world: CollisionWorld, enemies: EnemyManager,
    camPos: THREE.Vector3, camQuat: THREE.Quaternion): void {
    const w = this.active;
    this.sinceShot += dt;
    this.semiBuffer = Math.max(0, this.semiBuffer - dt);
    this.bloom = Math.max(0, this.bloom - dt * 6);
    if (this.throwT > 0) this.throwT = Math.max(0, this.throwT - dt);
    // Timers & reload progress for both weapons (only the active one can be reloading).
    for (const s of this.loadout.slots) {
      if (!s) continue;
      const ev = updateWeapon(s, dt);
      if (s === w) {
        if (ev === 'shellInserted') this.audio.reloadPart('shell');
        if (ev === 'shellDone') this.audio.reloadPart('pump');
      }
    }
    if (w && w.reloadPhase === 'mag') {
      const p = reloadProgress(w);
      const cross = (t: number) => this.lastReloadP < t && p >= t;
      if (cross(0.18)) this.audio.reloadPart('magOut');
      if (cross(0.64)) this.audio.reloadPart('magIn');
      if (cross(0.76)) this.audio.reloadPart(w.id === 'pistol' ? 'slide' : 'bolt');
      this.lastReloadP = p;
    } else this.lastReloadP = 0;

    // Weapon switching state machine
    if (this.switchDir !== 0) {
      const def = w ? WEAPONS[w.id] : WEAPONS.pistol;
      const rate = 1 / (def.switchTime * 0.5);
      this.switchT += this.switchDir * rate * dt;
      if (this.switchDir === 1 && this.switchT >= 1) {
        this.switchT = 1;
        this.loadout.active = this.switchTarget;
        this.syncModel();
        this.switchDir = -1;
      } else if (this.switchDir === -1 && this.switchT <= 0) {
        this.switchT = 0;
        this.switchDir = 0;
      }
    }
    if (!blocked.plating && !blocked.menu) {
      if (input.consume('weapon1')) this.requestSwitch(0);
      if (input.consume('weapon2')) this.requestSwitch(1);
      if (input.wheel !== 0) this.requestSwitch(this.loadout.active === 0 ? 1 : 0);
    } else {
      input.consume('weapon1'); input.consume('weapon2');
    }
    if (!w) return;
    const def = WEAPONS[w.id];
    const stats = effectiveStats(w.id, w.tier);

    // Aim down sights
    const canAim = input.aimHeld && !player.sprinting && !blocked.plating && this.switchDir === 0 && this.throwT <= 0 && w.reloadPhase !== 'mag';
    const target = canAim ? 1 : 0;
    const rate = dt / def.adsTime;
    this.adsT = target > this.adsT ? Math.min(1, this.adsT + rate) : Math.max(0, this.adsT - rate * 1.3);
    player.aiming = this.adsT > 0.5;
    player.adsT = this.adsT;

    // Reload
    if (input.consume('reload') && !blocked.plating && this.switchDir === 0) {
      if (startReload(w)) this.onReloadStart(w);
    }

    // Trigger
    const busy = blocked.plating || blocked.menu || this.switchDir !== 0 || this.throwT > 0;
    let wantFire = false;
    if (def.auto) wantFire = input.canFire;
    else {
      if (input.consumeFire()) this.semiBuffer = 0.15;
      wantFire = this.semiBuffer > 0;
    }
    if (!input.fireHeld) this.emptyClicked = false;
    if (wantFire && !busy) {
      if (w.mag <= 0) {
        if (!this.emptyClicked) { this.audio.empty(); this.emptyClicked = true; }
        if (!isReloading(w) && startReload(w)) this.onReloadStart(w);
        this.semiBuffer = 0;
      } else if (canFire(w) && !player.sprinting) {
        fire(w);
        this.semiBuffer = 0;
        this.shoot(w, player, world, enemies, camPos, camQuat, stats.damage, stats.spreadMult);
      }
    }
    if (input.fireHeld && player.sprinting) player.sprinting = false;
    player.recoverRecoil(dt, def.recoilRecover);
  }

  private onReloadStart(w: WeaponState): void {
    this.lastReloadP = 0;
    if (w.id === 'shotgun') this.audio.reloadPart('shell');
  }

  private shoot(w: WeaponState, player: Player, world: CollisionWorld, enemies: EnemyManager, camPos: THREE.Vector3, camQuat: THREE.Quaternion,
    baseDamage: number, spreadMult: number): void {
    const def = WEAPONS[w.id];
    this.sinceShot = 0;
    this.stats.shots++;
    const ads = this.adsT;
    const moveFrac = Math.min(1, player.speed2d / PLAYER.walkSpeed);
    let spreadDeg = (def.hipSpread + (def.adsSpread - def.hipSpread) * ads) * spreadMult;
    spreadDeg += def.moveSpread * moveFrac * (1 - ads * 0.7);
    if (!player.grounded) spreadDeg += 2.5;
    if (player.crouched) spreadDeg *= 0.8;
    spreadDeg += this.bloom * (1 - ads * 0.6);
    if (def.auto) this.bloom = Math.min(2.2, this.bloom + 0.35);
    const spread = (spreadDeg * Math.PI) / 180;

    this.camQ.copy(camQuat);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camQ);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camQ);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camQ);
    // World-space muzzle position for tracers
    const mc = this.vm.muzzleCameraSpace(this.tmp);
    const muzzle = new THREE.Vector3(mc.x, mc.y, mc.z).applyQuaternion(this.camQ).add(camPos);
    this.fx.muzzle(muzzle.x, muzzle.y, muzzle.z, w.id === 'shotgun' ? 1.5 : 1);
    const tracerCol = TRACER_COLORS[Math.min(2, w.tier)];

    // Accumulate damage per zombie so shotguns produce a single combined hit/kill result.
    const acc = new Map<Zombie, { dmg: number; head: boolean; x: number; y: number; z: number; dx: number; dz: number }>();
    for (let i = 0; i < def.pellets; i++) {
      // Uniform random direction within the spread cone
      const r = spread * Math.sqrt(this.rnd());
      const a = this.rnd() * Math.PI * 2;
      const dir = fwd.clone()
        .addScaledVector(right, Math.tan(r) * Math.cos(a))
        .addScaledVector(up, Math.tan(r) * Math.sin(a))
        .normalize();
      const maxRange = 220;
      const wh = world.raycast(camPos.x, camPos.y, camPos.z, dir.x, dir.y, dir.z, maxRange);
      const worldDist = wh ? wh.dist : maxRange;
      const zh = enemies.raycast(camPos.x, camPos.y, camPos.z, dir.x, dir.y, dir.z, worldDist);
      let endDist = worldDist;
      if (zh) {
        endDist = zh.dist;
        let dmg = damageAtRange(w.id, baseDamage, zh.dist);
        if (zh.head) dmg *= def.headMult;
        const e = acc.get(zh.z);
        if (e) { e.dmg += dmg; e.head = e.head || zh.head; }
        else acc.set(zh.z, { dmg, head: zh.head, x: zh.x, y: zh.y, z: zh.z_, dx: dir.x, dz: dir.z });
        this.audio.impact('flesh', { x: zh.x, z: zh.z_ });
      } else if (wh) {
        const hx = camPos.x + dir.x * wh.dist, hy = camPos.y + dir.y * wh.dist, hz = camPos.z + dir.z * wh.dist;
        this.fx.impact(hx, hy, hz, wh.nx, wh.ny, wh.nz, wh.box ? wh.box.surface : 'concrete');
        if (i % 3 === 0) this.audio.impact(wh.box ? wh.box.surface : 'concrete', { x: hx, z: hz });
      }
      if (w.id !== 'shotgun' || i % 3 === 0) {
        const ex = camPos.x + dir.x * endDist, ey = camPos.y + dir.y * endDist, ez = camPos.z + dir.z * endDist;
        // Tracer starts a little ahead of the muzzle so it reads as a streak
        const sx = muzzle.x + (ex - muzzle.x) * 0.05, sy = muzzle.y + (ey - muzzle.y) * 0.05, sz = muzzle.z + (ez - muzzle.z) * 0.05;
        this.fx.tracer(sx, sy, sz, ex, ey, ez, tracerCol);
      }
    }
    let best: HitFeedback['kind'] | null = null;
    const rank = { body: 0, armor: 1, head: 2, kill: 3 };
    for (const [z, e] of acc) {
      const out: DamageOutcome = enemies.damage(z, e.dmg, e.head, e.x, e.y, e.z, e.dx, e.dz);
      this.stats.hits++;
      if (e.head && !out.armor) this.stats.headshots++;
      const kind: HitFeedback['kind'] = out.killed ? 'kill' : out.armor ? 'armor' : e.head ? 'head' : 'body';
      if (best === null || rank[kind] > rank[best]) best = kind;
    }
    if (best) this.cb.onHit({ kind: best });
    // Recoil: kick the view, track the recoverable portion
    const adsK = 1 - ads * 0.45;
    const crouchK = player.crouched ? 0.8 : 1;
    const pitch = def.recoilPitch * adsK * crouchK;
    const yaw = (Math.random() - 0.5) * 2 * def.recoilYaw * adsK;
    player.kickView((pitch * Math.PI) / 180, (yaw * Math.PI) / 180);
    player.applyRecoil(pitch, yaw);
    this.vm.fire(w.id === 'shotgun' ? 1.6 : w.id === 'pistol' ? 0.9 : 0.7);
    this.audio.shot(w.id, w.tier);
    enemies.noise(camPos.x, camPos.z, 45);
    this.cb.onShot();
  }

  /** Crosshair spread in degrees for the HUD. */
  currentSpread(player: Player): number {
    const w = this.active;
    if (!w) return 0;
    const def = WEAPONS[w.id];
    const s = effectiveStats(w.id, w.tier);
    const moveFrac = Math.min(1, player.speed2d / PLAYER.walkSpeed);
    let d = (def.hipSpread + (def.adsSpread - def.hipSpread) * this.adsT) * s.spreadMult + def.moveSpread * moveFrac * (1 - this.adsT);
    if (!player.grounded) d += 2.5;
    return d + this.bloom;
  }

  weaponName(id: WeaponId): string {
    return WEAPONS[id].name;
  }
}
