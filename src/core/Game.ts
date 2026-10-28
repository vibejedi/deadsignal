// Game lifecycle and orchestration: state machine, fixed-step simulation, render loop and wiring
// between player, weapons, enemies, mission, audio and UI.
import * as THREE from 'three';
import { ENEMIES, GRENADE, MAX_FRAME_DT, MISSION, PLAYER, SIM_DT, WEAPONS, regionAt, type WeaponId } from '../config';
import { AudioEngine } from '../audio/Audio';
import { EnemyManager } from '../enemies/EnemyManager';
import { Spawner } from '../enemies/Spawner';
import type { Zombie } from '../enemies/Zombie';
import { Effects } from '../fx/Effects';
import { addCash, applyPurchase, purchaseCost, upgradeCost, validatePurchase, type Loadout, type PurchaseId } from '../mission/Economy';
import { Helicopter } from '../mission/Helicopter';
import { Interactables, rollLoot, type Crate } from '../mission/Interactables';
import { Mission } from '../mission/Mission';
import { Player } from '../player/Player';
import { applyDamage, beginPlate, cancelPlate, maxArmor, updateVitals } from '../player/Vitals';
import { Materials } from '../render/materials';
import { Renderer } from '../render/Renderer';
import { TextureLib } from '../render/textures';
import { Hud, type ContractView, type StationItemView, type WaypointView } from '../ui/Hud';
import { MapRenderer, type MapMarker, type MapState } from '../ui/MapRenderer';
import { Menus } from '../ui/Menus';
import { Grenades } from '../weapons/Grenades';
import { ViewModel } from '../weapons/ViewModel';
import { WeaponSystem } from '../weapons/WeaponSystem';
import { addReserve, cancelReload, createWeapon, effectiveStats, isReloading } from '../weapons/WeaponState';
import { Level } from '../world/Level';
import { Input } from './Input';
import { loadBest, loadSettings, recordBest, saveSettings, type Settings } from './Settings';

export type GameState = 'title' | 'playing' | 'paused' | 'dying' | 'extracting' | 'results';

type Interaction =
  | { kind: 'crate'; crate: Crate }
  | { kind: 'station'; station: 'buy' | 'upgrade' }
  | { kind: 'transmitter' }
  | { kind: 'radio' }
  | { kind: 'board' };

export class Game {
  state: GameState = 'title';
  readonly renderer: Renderer;
  readonly input: Input;
  readonly audio = new AudioEngine();
  readonly tex = new TextureLib();
  readonly M: Materials;
  readonly level: Level;
  readonly player = new Player();
  readonly vm: ViewModel;
  readonly fx: Effects;
  readonly enemies: EnemyManager;
  readonly spawner: Spawner;
  readonly grenades = new Grenades();
  readonly interact: Interactables;
  readonly heli: Helicopter;
  readonly hud: Hud;
  readonly menus: Menus;
  readonly map: MapRenderer;
  weapons: WeaponSystem;
  mission!: Mission;
  loadout!: Loadout;
  settings: Settings;
  private acc = 0;
  private last = 0;
  private simTime = 0;
  private realTime = 0;
  private station: 'buy' | 'upgrade' | null = null;
  private mapOpen = false;
  private currentInteraction: Interaction | null = null;
  private dyingT = 0;
  private extractT = 0;
  private titleT = 0;
  private landedAnnounced = false;
  private eliteNotified = false;
  private toxicTick = 0;
  private lastBreakToast = -10;
  private fpsFrames = 0;
  private fpsTime = 0;
  private fpsText = '';
  frameTimes: number[] = [];
  private camQuat = new THREE.Quaternion();
  private camEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private lookDX = 0;
  private lookDY = 0;
  private survival = 0;
  private resultShown = false;
  private contamWall: THREE.Mesh;
  timeScale = 1;
  private rafId = 0;

  constructor(container: HTMLElement, onProgress: (p: number, label: string) => void) {
    this.settings = loadSettings();
    this.renderer = new Renderer(container);
    onProgress(0.15, 'GENERATING SURFACES…');
    this.tex.build();
    this.M = new Materials(this.tex);
    onProgress(0.4, 'MAPPING DISTRICT 9…');
    this.level = new Level(this.M);
    this.renderer.scene.add(this.level.root);
    onProgress(0.65, 'ARMING LOADOUT…');
    this.vm = new ViewModel(this.tex);
    this.renderer.setViewModel(this.vm.scene, this.vm.camera);
    this.renderer.showViewModel(false); // enabled on deploy
    this.fx = new Effects(this.tex);
    this.renderer.scene.add(this.fx.group);
    this.enemies = new EnemyManager(this.tex, this.level, this.fx, this.audio, {
      onKill: (z, head) => this.onKill(z, head),
      onPlayerHit: (dmg, x, z, heavy) => this.onPlayerHit(dmg, x, z, heavy),
    });
    this.renderer.scene.add(this.enemies.group);
    this.spawner = new Spawner(this.level, this.enemies);
    this.renderer.scene.add(this.grenades.group);
    this.interact = new Interactables(this.M, this.level.poi.crates, this.level.poi.stations);
    this.renderer.scene.add(this.interact.group);
    this.heli = new Helicopter(this.M, this.level.poi.heliLand.x, this.level.poi.heliLand.z);
    this.renderer.scene.add(this.heli.group);
    this.contamWall = this.buildContaminationWall();
    this.renderer.scene.add(this.contamWall);
    onProgress(0.85, 'SYNCHRONISING…');
    this.map = new MapRenderer(this.level);
    this.hud = new Hud(this.map);
    this.input = new Input(this.renderer.renderer.domElement);
    this.weapons = new WeaponSystem(this.newLoadout(), this.vm, this.audio, this.fx, {
      onHit: (fb) => { this.hud.hit(fb.kind); this.audio.hitmarker(fb.kind); },
      onShot: () => { this.mission.stats.shots++; },
    });
    this.menus = new Menus(this);
    this.applySettings();
    this.resetMission();
    this.input.onLockChange = (locked) => this.onLockChange(locked);
    this.input.onFocusLost = () => { if (this.state === 'playing') this.pause(); };
    this.input.onEscape = () => {
      if (this.mapOpen) { this.mapOpen = false; this.menus.showMap(false); }
      if (this.state === 'playing' && this.input.virtualLock) this.pause();
    };
    window.addEventListener('resize', () => this.onResize());
    this.onResize();
    onProgress(1, 'READY');
    this.last = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------------------------------
  private newLoadout(): Loadout {
    return { cash: PLAYER.startCash, slots: [createWeapon('rifle'), createWeapon('pistol')], active: 0, grenades: PLAYER.startGrenades };
  }

  resetMission(): void {
    const poi = this.level.poi;
    this.enemies.reset();
    this.spawner.reset();
    this.fx.reset();
    this.grenades.reset();
    this.interact.reset();
    this.heli.reset();
    this.audio.stopHeli();
    this.mission = new Mission(poi.compoundCenter, poi.lzPad, poi.radio, poi.boardPoint);
    this.mission.defenseCenter = poi.transmitter;
    this.loadout = this.newLoadout();
    this.weapons.reset(this.loadout);
    this.player.reset(poi.playerSpawn.x, poi.playerSpawn.z, poi.playerSpawn.yaw);
    this.spawner.populate();
    this.level.defenseRing.visible = false;
    this.station = null;
    this.mapOpen = false;
    this.menus.showMap(false);
    this.hud.reset();
    this.input.clear();
    this.acc = 0;
    this.simTime = 0;
    this.survival = 0;
    this.dyingT = 0;
    this.extractT = 0;
    this.landedAnnounced = false;
    this.eliteNotified = false;
    this.resultShown = false;
    this.contamWall.visible = false;
    this.renderer.grade.uniforms.uToxic.value = 0;
    this.renderer.grade.uniforms.uDamage.value = 0;
    this.renderer.grade.uniforms.uLowHealth.value = 0;
    (document.getElementById('fade') as HTMLElement).style.opacity = '0';
  }

  /** Deploy from the title screen or redeploy from results. Must be called from a user gesture. */
  async deploy(): Promise<void> {
    this.audio.init();
    this.audio.setVolume(this.settings.volume);
    this.audio.startAmbience();
    if (this.state !== 'title') this.resetMission();
    this.state = 'playing';
    this.menus.showScreen('none');
    this.hud.show(true);
    this.renderer.showViewModel(true);
    this.last = performance.now();
    const ok = await this.input.requestLock();
    if (!ok && !this.input.virtualLock) this.pause('Click RESUME to lock the mouse and continue.');
  }

  pause(note = ''): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.clear();
    this.input.releaseLock();
    this.audio.suspend();
    this.menus.showScreen('pause', note);
  }

  async resume(): Promise<void> {
    if (this.state !== 'paused') return;
    this.audio.init();
    this.audio.resume();
    const ok = await this.input.requestLock();
    if (!ok && !this.input.virtualLock) {
      this.menus.setResumeNote('The browser blocked the mouse lock — wait a moment and click RESUME again.');
      return;
    }
    if (this.input.virtualLock) this.onLockChange(true);
  }

  private onLockChange(locked: boolean): void {
    if (locked && this.state === 'paused') {
      this.state = 'playing';
      this.menus.showScreen('none');
      this.audio.resume();
      this.last = performance.now(); // no accumulated delta after resume
      this.acc = 0;
    } else if (!locked && this.state === 'playing' && !this.input.virtualLock) {
      this.pause();
    }
  }

  quitToTitle(): void {
    this.input.releaseLock();
    this.resetMission();
    this.state = 'title';
    this.hud.show(false);
    this.renderer.showViewModel(false);
    this.audio.resume();
    this.menus.showScreen('title');
  }

  restart(): void {
    this.resetMission();
    this.state = 'title';
    void this.deploy();
  }

  applySettings(): void {
    const s = this.settings;
    this.renderer.setQuality(s.quality, s.renderScale);
    this.audio.setVolume(s.volume);
    saveSettings(s);
    this.onResize();
  }

  private onResize(): void {
    this.renderer.resize();
    this.vm.resize(window.innerWidth / window.innerHeight);
    this.fx.setScale(this.renderer.pixelHeight, this.renderer.camera.fov);
  }

  // ------------------------------------------------------------------------------------------
  // Main loop
  // ------------------------------------------------------------------------------------------
  private loop = (now: number) => {
    this.rafId = requestAnimationFrame(this.loop);
    let frameDt = (now - this.last) / 1000;
    this.last = now;
    if (!isFinite(frameDt) || frameDt < 0) frameDt = 0;
    const rawDt = frameDt;
    frameDt = Math.min(frameDt, MAX_FRAME_DT);
    this.realTime += frameDt;
    this.trackFps(rawDt);

    if (this.state === 'playing') {
      // Mouse look is applied per frame for responsiveness.
      this.lookDX = this.input.mouseDX;
      this.lookDY = this.input.mouseDY;
      this.player.look(this.lookDX, this.lookDY, this.settings.sensitivity);
      this.acc += frameDt * this.timeScale;
      let steps = 0;
      while (this.acc >= SIM_DT && steps < 8) {
        this.step(SIM_DT);
        this.input.endStep();
        this.acc -= SIM_DT;
        steps++;
        if (this.state !== 'playing') break;
      }
      if (steps >= 8) this.acc = 0;
      this.input.endFrame();
    } else if (this.state === 'dying') {
      this.dyingT += frameDt;
      this.enemies.update(frameDt, this.playerTarget());
      if (this.dyingT > 2.6 && !this.resultShown) this.showResults(this.mission.outcome === 'timeout' ? 'timeout' : 'dead');
    } else if (this.state === 'extracting') {
      this.extractT += frameDt;
      this.heli.updateDepart(frameDt, this.realTime);
      if (this.extractT > 3.8) (document.getElementById('fade') as HTMLElement).style.opacity = '1';
      if (this.extractT > 5 && !this.resultShown) this.showResults('victory');
    } else {
      this.lookDX = this.lookDY = 0;
      this.input.endFrame();
      this.input.endStep();
    }
    this.renderFrame(frameDt);
  };

  private trackFps(dt: number): void {
    this.fpsFrames++;
    this.fpsTime += dt;
    this.frameTimes.push(dt * 1000);
    if (this.frameTimes.length > 600) this.frameTimes.shift();
    if (this.fpsTime >= 0.5) {
      const fps = this.fpsFrames / this.fpsTime;
      this.fpsText = `${fps.toFixed(0)} FPS · ${(1000 / fps).toFixed(1)} ms · ${this.enemies.aliveCount} infected`;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
  }

  private playerTarget() {
    const p = this.player;
    return { x: p.pos.x, y: p.pos.y, z: p.pos.z, eyeY: p.eyeY, alive: p.vitals.alive && this.state === 'playing' };
  }

  private updateCamera(): void {
    const p = this.player;
    const cam = this.renderer.camera;
    cam.position.set(p.pos.x, p.eyeY, p.pos.z);
    this.camEuler.set(p.pitch, p.yaw, 0, 'YXZ');
    cam.quaternion.setFromEuler(this.camEuler);
    this.camQuat.copy(cam.quaternion);
    cam.updateMatrixWorld();
  }

  // ------------------------------------------------------------------------------------------
  // Fixed-step simulation
  // ------------------------------------------------------------------------------------------
  private step(dt: number): void {
    this.simTime += dt;
    this.survival += dt;
    const p = this.player;
    const v = p.vitals;
    const input = this.input;
    const world = this.level.world;

    // Map toggle
    if (input.consume('map')) { this.mapOpen = !this.mapOpen; this.menus.showMap(this.mapOpen); }

    // Armor plate
    if (input.consume('plate')) {
      if (beginPlate(v)) {
        const w = this.weapons.active;
        if (w) cancelReload(w);
        this.audio.plate('start');
      } else if (v.plateT <= 0) {
        this.hud.toast(v.plates <= 0 ? 'NO ARMOR PLATES' : v.armor >= maxArmor() ? 'ARMOR FULL' : 'CANNOT PLATE NOW', 'bad', '', 1.4);
        this.audio.ui('deny');
      }
    }
    const plating = v.plateT > 0;

    // Movement
    const ev = p.update(dt, input, world, { canSprintExtra: !input.fireHeld && !plating, speedMult: plating ? 0.65 : 1 });
    if (ev.footstep) this.audio.footstep(this.surfaceUnder(), p.sprinting, p.crouched);
    if (ev.landed > 6) this.audio.land();
    for (const z of this.enemies.zombies) {
      if (!z.alive) continue;
      if (Math.abs(z.pos.x - p.pos.x) < 1.5 && Math.abs(z.pos.z - p.pos.z) < 1.5 && Math.abs(z.pos.y - p.pos.y) < 1.5) p.pushOut(z.pos.x, z.pos.z, z.radius, world);
    }

    // Vitals
    if (updateVitals(v, dt, p.sprinting)) {
      this.audio.plate('done');
      this.mission.stats.platesUsed++;
    }

    // Weapons (camera pose needed for rays)
    this.updateCamera();
    this.weapons.update(dt, input, p, { plating, menu: false }, world, this.enemies, this.renderer.camera.position, this.camQuat);

    // Grenade throw
    if (input.consume('grenade')) {
      if (this.loadout.grenades > 0 && !plating && !this.weapons.switching && this.weapons.throwT <= 0) {
        this.loadout.grenades--;
        const f = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camQuat);
        const o = this.renderer.camera.position.clone().addScaledVector(f, 0.4);
        o.y -= 0.1;
        this.grenades.throw(o.x, o.y, o.z, f.x, f.y, f.z, p.vel.x, p.vel.z);
        this.weapons.throwT = 0.5;
        this.audio.grenadePin();
      } else if (this.loadout.grenades <= 0) {
        this.hud.toast('NO GRENADES', 'bad', '', 1.2);
      }
    }
    const blasts = this.grenades.update(dt, world, (x, z) => this.audio.grenadeBounce({ x, z }));
    for (const b of blasts) this.explode(b.x, b.y, b.z);

    // Enemies and spawning
    this.enemies.update(dt, this.playerTarget());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camQuat);
    const fl = Math.hypot(fwd.x, fwd.z) || 1;
    this.spawner.update(dt, {
      px: p.pos.x, pz: p.pos.z, eyeY: p.eyeY, fx: fwd.x / fl, fz: fwd.z / fl,
      pressure: this.mission.pressure,
      defenseActive: this.mission.defense.status === 'active',
      finalHorde: this.mission.extraction.state === 'called' || this.mission.extraction.state === 'landed',
    });

    // Mission
    const events = this.mission.update(dt, { x: p.pos.x, z: p.pos.z }, v.alive);
    for (const e of events) this.onMissionEvent(e);
    if (this.mission.inContamination(p.pos.x, p.pos.z) && v.alive) {
      applyDamage(v, MISSION.contaminationDps * dt, true);
      this.toxicTick -= dt;
      if (this.toxicTick <= 0) { this.toxicTick = 1.2; this.audio.hurt(false); }
    }
    // Elite proximity notice
    const el = this.enemies.elite;
    if (el && el.alive && !this.eliteNotified && (this.enemies.eliteAggro || Math.hypot(el.pos.x - p.pos.x, el.pos.z - p.pos.z) < 30)) {
      this.eliteNotified = true;
      this.hud.toast('WARDEN-9 SIGHTED', 'bad', 'It wears a helmet · break it, then go for the head', 3.5);
      this.audio.ui('alert');
    }

    // Interaction & stations
    this.updateInteraction();
    this.updateStation();

    // Ammo drops
    const drops = this.interact.collectDrops(p.pos.x, p.pos.z);
    if (drops > 0) {
      for (const s of this.loadout.slots) if (s) addReserve(s, effectiveStats(s.id, s.tier).magSize);
      this.audio.ui('pickup');
      this.hud.toast('AMMO RECOVERED', '', '', 1.2);
    }

    // Defeat checks
    if (!v.alive) this.onDeath();
    else if (this.mission.outcome === 'timeout') this.onTimeout();
  }

  private surfaceUnder(): 'concrete' | 'metal' | 'wood' | 'dirt' | 'glass' {
    const p = this.player.pos;
    const h = this.level.world.raycast(p.x, p.y + 0.3, p.z, 0, -1, 0, 0.6, false);
    if (h && h.box) return h.box.surface;
    if (p.x > 12 && p.z > -12 && p.z < 29) return 'dirt';
    return 'concrete';
  }

  private explode(x: number, y: number, z: number): void {
    this.fx.explosion(x, y, z, this.settings.reducedMotion);
    this.audio.explosion({ x, z });
    const r = this.enemies.radiusDamage(x, y, z, GRENADE.radius, GRENADE.maxDamage);
    if (r.hits > 0) { this.hud.hit(r.kills > 0 ? 'kill' : 'body'); this.audio.hitmarker(r.kills > 0 ? 'kill' : 'body'); }
    this.enemies.noise(x, z, 40);
    // Self damage, blocked by cover
    const p = this.player;
    const d = Math.hypot(p.pos.x - x, p.pos.z - z, p.pos.y + 1 - y);
    if (d < GRENADE.radius && p.vitals.alive) {
      const blocked = this.level.world.segmentBlocked(x, y + 0.3, z, p.pos.x, p.eyeY, p.pos.z) &&
        this.level.world.segmentBlocked(x, y + 0.3, z, p.pos.x, p.pos.y + 0.8, p.pos.z);
      if (!blocked) {
        const dmg = GRENADE.maxDamage * GRENADE.playerDamageMult * (1 - d / GRENADE.radius);
        applyDamage(p.vitals, dmg);
        this.hud.damageFrom(x, z, true);
        this.audio.hurt(true);
      }
    }
  }

  // ------------------------------------------------------------------------------------------
  // Interaction
  // ------------------------------------------------------------------------------------------
  private findInteraction(): Interaction | null {
    const p = this.player.pos;
    const poi = this.level.poi;
    const near = (x: number, z: number, r: number, y = 0) => Math.hypot(x - p.x, z - p.z) < r && Math.abs(p.y - y) < 1.6;
    const ex = this.mission.extraction;
    if (ex.state === 'landed' && ex.canBoard({ x: p.x, z: p.z }, this.player.vitals.alive)) return { kind: 'board' };
    if (near(poi.radio.x, poi.radio.z, MISSION.radioRadius)) return { kind: 'radio' };
    if (near(poi.transmitter.x, poi.transmitter.z, 3.6, 0.3) && this.mission.defense.status === 'inactive') return { kind: 'transmitter' };
    for (const s of poi.stations) if (near(s.x, s.z, 2.4)) return { kind: 'station', station: s.kind };
    let best: Crate | null = null, bd = 2.0;
    for (const c of this.interact.crates) {
      if (c.opened) continue;
      const d = Math.hypot(c.spot.x - p.x, c.spot.z - p.z);
      if (d < bd && Math.abs(p.y - c.spot.y) < 1.4) { bd = d; best = c; }
    }
    return best ? { kind: 'crate', crate: best } : null;
  }

  private updateInteraction(): void {
    const it = this.findInteraction();
    this.currentInteraction = it;
    const pressed = this.input.consume('interact');
    if (!it) {
      if (pressed && this.station) this.station = null;
      return;
    }
    if (!pressed) return;
    switch (it.kind) {
      case 'crate': this.lootCrate(it.crate); break;
      case 'station':
        this.station = this.station === it.station ? null : it.station;
        this.audio.ui('click');
        break;
      case 'transmitter':
        if (this.mission.defense.activate()) {
          this.level.defenseRing.visible = true;
          this.audio.ui('contract');
          this.hud.toast('UPLINK RELAY ONLINE', 'big', 'Hold the zone while it transmits · everything heard that', 3.5);
          this.enemies.noise(this.player.pos.x, this.player.pos.z, 70);
        }
        break;
      case 'radio': {
        const ex = this.mission.extraction;
        if (ex.state === 'locked') {
          this.hud.toast('EXTRACTION UNAVAILABLE', 'bad', 'Complete both contracts first', 2.2);
          this.audio.ui('deny');
        } else if (ex.call({ x: this.player.pos.x, z: this.player.pos.z })) {
          this.audio.ui('radio');
          this.audio.startHeli();
          this.hud.toast('RAVEN 2-1 INBOUND', 'big', `Hold the LZ · ETA ${MISSION.extractionCountdown}s`, 4);
          this.enemies.noise(this.player.pos.x, this.player.pos.z, 120);
        }
        break;
      }
      case 'board':
        if (this.mission.extraction.board({ x: this.player.pos.x, z: this.player.pos.z }, this.player.vitals.alive)) this.onVictory();
        break;
    }
  }

  private lootCrate(c: Crate): void {
    if (!this.interact.open(c)) return;
    const loot = rollLoot(c.spot.region);
    const v = this.player.vitals;
    let cash = loot.cash;
    let plates = 0;
    for (let i = 0; i < loot.plates; i++) {
      if (v.plates < PLAYER.maxPlateInventory) { v.plates++; plates++; } else cash += 100;
    }
    let gren = 0;
    for (let i = 0; i < loot.grenades; i++) {
      if (this.loadout.grenades < PLAYER.maxGrenades) { this.loadout.grenades++; gren++; } else cash += 100;
    }
    for (const s of this.loadout.slots) if (s) addReserve(s, effectiveStats(s.id, s.tier).magSize * loot.ammoMags);
    addCash(this.loadout, cash);
    this.mission.stats.salvageEarned += cash;
    this.mission.stats.cratesLooted++;
    const parts = [`+$${cash}`, `AMMO`];
    if (plates) parts.push(`+${plates} PLATE${plates > 1 ? 'S' : ''}`);
    if (gren) parts.push(`+${gren} FRAG`);
    this.hud.toast('SUPPLY CACHE', 'good', parts.join('  ·  '), 2.6);
    this.audio.ui('loot');
  }

  private stationItems(): { id: PurchaseId; view: StationItemView }[] {
    const l = this.loadout;
    const v = this.player.vitals;
    const mk = (id: PurchaseId, key: string, name: string, desc: string) => {
      const cost = purchaseCost(l, id);
      const val = validatePurchase(l, v, id);
      return { id, view: { key, name, desc, price: cost === null ? 'MAX' : val.ok ? `$${cost}` : val.reason === 'INSUFFICIENT SALVAGE' ? `$${cost}` : val.reason!, enabled: val.ok } };
    };
    if (this.station === 'buy') {
      const hasShotgun = l.slots.some((s) => s?.id === 'shotgun');
      return [
        mk('ammo', '3', 'AMMO RESUPPLY', 'Refill reserves for both weapons'),
        mk('plate', '4', 'ARMOR PLATE', `Carry up to ${PLAYER.maxPlateInventory} · apply with Q`),
        mk('grenade', '5', 'FRAG GRENADE', `Carry up to ${PLAYER.maxGrenades}`),
        mk('shotgun', '6', WEAPONS.shotgun.name, hasShotgun ? 'Already equipped' : l.slots[1] ? 'Pump shotgun · replaces held weapon' : 'Pump shotgun · 9 pellets'),
      ];
    }
    const name = (i: 0 | 1) => {
      const s = l.slots[i];
      if (!s) return 'EMPTY SLOT';
      return WEAPONS[s.id].name;
    };
    const desc = (i: 0 | 1) => {
      const s = l.slots[i];
      if (!s) return '';
      const c = upgradeCost(s);
      return c === null ? 'Fully upgraded' : `→ ${s.tier === 0 ? 'TIER I' : 'TIER II'}: more damage, bigger mags, faster reloads`;
    };
    return [mk('upgrade0', '3', name(0), desc(0)), mk('upgrade1', '4', name(1), desc(1))];
  }

  private updateStation(): void {
    if (this.station) {
      const it = this.currentInteraction;
      if (!it || it.kind !== 'station' || it.station !== this.station) this.station = null;
    }
    if (!this.station) { this.hud.setStation(null, ''); return; }
    const items = this.stationItems();
    const keys = ['buy3', 'buy4', 'buy5', 'buy6', 'buy7'] as const;
    items.forEach((it, i) => {
      if (!this.input.consume(keys[i])) return;
      const before = this.loadout.slots.map((s) => s?.id);
      const r = applyPurchase(this.loadout, this.player.vitals, it.id);
      if (r.ok) {
        this.hud.flashStation(i, true);
        if (it.id === 'upgrade0' || it.id === 'upgrade1') {
          const slot = it.id === 'upgrade0' ? 0 : 1;
          const w = this.loadout.slots[slot]!;
          this.vm.setTier(w.id, w.tier);
          this.audio.ui('upgrade');
          this.fx.sparkBurst(this.player.pos.x, 1.2, this.player.pos.z, 20, w.tier === 1 ? [0.4, 0.8, 1.6] : [1.6, 0.5, 0.2]);
          this.hud.toast(`${WEAPONS[w.id].name} UPGRADED`, 'big', w.tier === 1 ? 'TIER I · damage x1.65 · +25% magazine' : 'TIER II · damage x2.5 · +50% magazine', 3);
        } else {
          this.audio.ui('buy');
          if (it.id === 'shotgun') {
            const replaced = before.find((id) => id && !this.loadout.slots.some((s) => s?.id === id));
            this.weapons.syncModel();
            this.hud.toast(`${WEAPONS.shotgun.name} ACQUIRED`, 'good', replaced ? `Replaced ${WEAPONS[replaced as WeaponId].shortName}` : '', 2.5);
          }
        }
      } else {
        this.hud.flashStation(i, false);
        this.audio.ui('deny');
        this.hud.toast(r.reason ?? 'UNAVAILABLE', 'bad', '', 1.2);
      }
    });
    this.hud.setStation(items.map((i) => i.view), this.station === 'buy' ? 'QUARTERMASTER STATION' : 'ARMORY UPGRADE BENCH');
  }

  // ------------------------------------------------------------------------------------------
  // Events
  // ------------------------------------------------------------------------------------------
  private onKill(z: Zombie, head: boolean): void {
    if (this.state !== 'playing' && this.state !== 'dying') return;
    this.mission.stats.kills++;
    if (head) this.mission.stats.headshots++;
    if (z.elite) {
      if (this.mission.onEliteKilled()) {
        addCash(this.loadout, MISSION.huntReward);
        this.mission.stats.salvageEarned += MISSION.huntReward;
        this.player.vitals.plates = Math.min(PLAYER.maxPlateInventory, this.player.vitals.plates + 2);
        this.hud.toast('CONTRACT COMPLETE · WARDEN-9 ELIMINATED', 'big', `+$${MISSION.huntReward}  ·  +2 PLATES`, 4);
        this.audio.ui('complete');
      }
      return;
    }
    const reward = Math.round(z.reward + (head ? ENEMIES.headshotBonus : 0));
    addCash(this.loadout, reward);
    this.mission.stats.salvageEarned += reward;
    if (Math.random() < ENEMIES.ammoDropChance) this.interact.spawnDrop(z.pos.x, z.pos.z);
  }

  private onPlayerHit(dmg: number, fromX: number, fromZ: number, heavy: boolean): void {
    if (this.state !== 'playing') return;
    const v = this.player.vitals;
    const r = applyDamage(v, dmg);
    this.hud.damageFrom(fromX, fromZ, heavy);
    if (r.armorBroke) {
      this.audio.armorBreak();
      if (this.realTime - this.lastBreakToast > 2) { this.lastBreakToast = this.realTime; this.hud.toast('ARMOR PLATE BROKEN', 'bad', '', 1.2); }
    }
    this.audio.hurt(heavy);
    if (!this.settings.reducedMotion) this.fx.shake = Math.max(this.fx.shake, heavy ? 0.25 : 0.12);
  }

  private onMissionEvent(e: ReturnType<Mission['update']>[number]): void {
    switch (e.type) {
      case 'defenseComplete':
        addCash(this.loadout, MISSION.defenseReward);
        this.mission.stats.salvageEarned += MISSION.defenseReward;
        for (const s of this.loadout.slots) if (s) addReserve(s, Infinity);
        this.level.defenseRing.visible = false;
        this.hud.toast('CONTRACT COMPLETE · UPLINK RESTORED', 'big', `+$${MISSION.defenseReward}  ·  AMMO REFILLED`, 4);
        this.audio.ui('complete');
        break;
      case 'huntComplete':
        break;
      case 'extractionUnlocked':
        this.hud.toast('EXTRACTION AVAILABLE', 'big', 'Reach the LZ and signal RAVEN 2-1', 4.5);
        this.audio.ui('radio');
        break;
      case 'finalPhase':
        this.contamWall.visible = true;
        this.hud.toast('CONTAMINATION BREACH', 'bad', e.forced ? 'The compound is venting · finish the contracts fast' : 'The front is spreading from the compound · get to the LZ', 4.5);
        this.audio.ui('alert');
        break;
      case 'heliLanded':
        if (!this.landedAnnounced) {
          this.landedAnnounced = true;
          this.hud.toast('RAVEN 2-1 ON THE GROUND', 'big', 'Get to the door and press E · don\'t look back', 4);
          this.audio.ui('radio');
        }
        break;
      case 'deadline':
        break;
    }
  }

  private onDeath(): void {
    if (this.state !== 'playing') return;
    this.mission.outcome = this.mission.outcome === 'active' ? 'dead' : this.mission.outcome;
    this.mission.extraction.fail();
    this.state = 'dying';
    this.dyingT = 0;
    this.station = null;
    this.hud.setStation(null, '');
    this.input.releaseLock();
    this.renderer.showViewModel(false);
    this.hud.centerMessage('SIGNAL LOST');
    this.audio.hurt(true);
  }

  private onTimeout(): void {
    if (this.state !== 'playing') return;
    this.state = 'dying';
    this.dyingT = 0;
    this.input.releaseLock();
    this.renderer.showViewModel(false);
    this.hud.centerMessage('ZONE LOST');
  }

  private onVictory(): void {
    this.mission.outcome = 'victory';
    this.state = 'extracting';
    this.extractT = 0;
    this.input.releaseLock();
    this.hud.show(false);
    this.renderer.showViewModel(false);
    this.audio.ui('complete');
  }

  private showResults(outcome: 'victory' | 'dead' | 'timeout'): void {
    this.resultShown = true;
    this.state = 'results';
    this.hud.show(false);
    this.audio.stopHeli();
    const st = this.mission.stats;
    let record = false;
    if (outcome === 'victory') record = recordBest({ time: this.survival, kills: st.kills, headshots: st.headshots, salvage: st.salvageEarned });
    this.menus.showResults(outcome, {
      kills: st.kills, headshots: st.headshots, contracts: this.mission.contractsDone, salvage: st.salvageEarned,
      caches: st.cratesLooted, time: this.survival, accuracy: this.weapons.stats.shots ? this.weapons.stats.hits / this.weapons.stats.shots : 0,
    }, record, loadBest());
    (document.getElementById('fade') as HTMLElement).style.opacity = '0';
  }

  // ------------------------------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------------------------------
  private renderFrame(dt: number): void {
    const p = this.player;
    const cam = this.renderer.camera;
    const reduced = this.settings.reducedMotion;
    if (this.state === 'title' || (this.state === 'results' && this.mission.outcome !== 'victory')) {
      // Slow establishing dolly up the main street toward the compound.
      this.titleT += dt;
      const t = this.titleT * 0.04;
      // Elevated above the checkpoint so wandering infected never clip the camera.
      cam.position.set(Math.sin(t) * 3, 8.5 + Math.sin(t * 0.7) * 0.4, 95.5);
      cam.lookAt(Math.sin(t * 0.8) * 5, 3, 10);
      cam.fov = 62;
      cam.updateProjectionMatrix();
    } else if (this.state === 'extracting' || (this.state === 'results' && this.mission.outcome === 'victory')) {
      const h = this.heli.position;
      cam.position.lerp(new THREE.Vector3(24, 4, 60), Math.min(1, dt * 1.5));
      cam.lookAt(h.x, h.y + 2, h.z);
      cam.fov = 60;
      cam.updateProjectionMatrix();
    } else {
      this.updateCamera();
      if (this.state === 'dying') {
        const k = Math.min(1, this.dyingT / 1.2);
        cam.position.y = p.pos.y + 0.3 + (p.eyeY - p.pos.y - 0.3) * (1 - k * k);
        cam.rotateZ(k * 0.6);
        cam.rotateX(-k * 0.3);
      }
      // Camera shake (restrained, reduced-motion aware)
      const sh = this.fx.shake * (reduced ? 0.25 : 1);
      if (sh > 0) {
        cam.rotateX((Math.random() - 0.5) * sh * 0.03);
        cam.rotateY((Math.random() - 0.5) * sh * 0.03);
      }
      const w = this.weapons.active;
      const zoom = w ? 1 + (WEAPONS[w.id].adsZoom - 1) * this.weapons.adsT : 1;
      const sprintFov = p.sprinting && !reduced ? 4 : 0;
      const targetFov = (this.settings.fov + sprintFov) * zoom;
      cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 14);
      cam.updateProjectionMatrix();
      this.vm.camera.fov = 52 * (1 + (zoom - 1) * 0.5);
      this.vm.camera.updateProjectionMatrix();
    }
    this.fx.setScale(this.renderer.pixelHeight, cam.fov);

    // Viewmodel
    const w = this.weapons.active;
    if (w && (this.state === 'playing' || this.state === 'paused')) {
      const shell = effectiveStats(w.id, w.tier).shell;
      this.vm.update(this.state === 'paused' ? 0 : dt, {
        id: w.id, tier: w.tier, adsT: this.weapons.adsT, speed: p.speed2d, sprinting: p.sprinting, grounded: p.grounded, crouched: p.crouched,
        bobPhase: p.stepPhase * Math.PI, lookDX: this.lookDX, lookDY: this.lookDY,
        reloadPhase: w.reloadPhase, reloadP: w.reloadPhase === 'mag' ? w.reloadT / effectiveStats(w.id, w.tier).reloadTime : 0,
        shellT: w.reloadT, shellPer: shell ? (w.reloadPhase === 'shellStart' ? shell.start : w.reloadPhase === 'shellEnd' ? shell.end : shell.perShell) : 1,
        switchT: Math.max(this.weapons.switchT, this.weapons.throwT > 0 ? Math.sin((this.weapons.throwT / 0.5) * Math.PI) * 0.6 : 0),
        plateT: p.vitals.plateT > 0 ? 1 - p.vitals.plateT / PLAYER.plateApplyTime : 0,
        sinceShot: this.weapons.sinceShot, reducedMotion: reduced, jumpOffset: p.grounded ? 0 : Math.max(-1, Math.min(1, p.vel.y / 5)),
      });
    }

    // World animation
    const animDt = this.state === 'paused' ? 0 : dt;
    if (this.state !== 'paused') {
      this.enemies.animate(animDt, cam.position.x, cam.position.z);
      this.level.update(this.realTime, animDt);
      this.interact.update(animDt, this.realTime);
      this.fx.update(animDt);
      // Transmitter beacon / defense ring pulse
      if (this.level.defenseRing.visible) {
        const m = this.level.defenseRing.material as THREE.MeshBasicMaterial;
        m.opacity = 0.35 + Math.sin(this.realTime * 4) * 0.15;
        m.color.setHex(this.mission.defense.inZone ? 0x60ff80 : 0xffa040);
      }
      // Contamination wall
      if (this.contamWall.visible) {
        const r = this.mission.contaminationRadius;
        this.contamWall.scale.set(r, 1, r);
        (this.contamWall.material as THREE.ShaderMaterial).uniforms.uTime.value = this.realTime;
      }
      // Helicopter
      const ex = this.mission.extraction;
      if (this.state === 'playing' || this.state === 'dying') {
        const visible = ex.heliVisible() && this.state === 'playing';
        this.heli.updateApproach(ex.approach(), visible, this.realTime, animDt);
        if (visible) {
          const hp = this.heli.position;
          if (hp.y < 14) this.fx.downwash(hp.x, hp.z, 1 - hp.y / 14);
          this.audio.updateHeli({ x: hp.x, y: hp.y, z: hp.z }, 1);
        } else this.audio.updateHeli(null, 0);
        // Flare at the radio once called
        if (ex.state === 'called' || ex.state === 'landed') this.fx.flare(this.level.poi.radio.x + 0.6, 0.3, this.level.poi.radio.z);
      } else if (this.state === 'extracting') {
        const hp = this.heli.position;
        this.audio.updateHeli({ x: hp.x, y: hp.y, z: hp.z }, 1);
      }
    }

    // Audio listener + ambience
    this.audio.setListener(cam.position.x, cam.position.y, cam.position.z, p.yaw);
    if (this.state === 'playing') {
      this.audio.updateAmbience(dt);
      const low = p.vitals.health < 35 ? 1 - p.vitals.health / 35 : 0;
      this.audio.heartbeat(dt, low);
    }

    // Post-processing grade uniforms
    const g = this.renderer.grade.uniforms;
    g.uDamage.value = this.state === 'playing' || this.state === 'dying' ? Math.max(this.hud.damageVignette, this.state === 'dying' ? 0.8 : 0) : 0;
    g.uLowHealth.value = this.state === 'playing' ? Math.max(0, 1 - p.vitals.health / 40) : this.state === 'dying' ? 1 : 0;
    const toxic = this.state === 'playing' && this.mission.inContamination(p.pos.x, p.pos.z);
    g.uToxic.value += ((toxic ? 1 : 0) - g.uToxic.value) * Math.min(1, dt * 3);

    // HUD
    if (this.state === 'playing' || this.state === 'paused') this.updateHud(dt, toxic);

    this.renderer.followShadow(cam.position.x, cam.position.z);
    this.renderer.render(this.realTime);
  }

  private updateHud(dt: number, toxic: boolean): void {
    const p = this.player;
    const v = p.vitals;
    const m = this.mission;
    const w = this.weapons.active;
    const ex = m.extraction;
    const poi = this.level.poi;
    const contracts: ContractView[] = [];
    const d = m.defense;
    contracts.push({
      title: 'DEFEND UPLINK RELAY', tag: d.status === 'complete' ? 'COMPLETE' : 'CONTRACT',
      sub: d.status === 'inactive' ? 'Activate the relay at Kessler Depot [E]' : d.status === 'complete' ? 'Uplink restored' : d.inZone ? `Transmitting… ${Math.round(d.progress * 100)}%` : 'RETURN TO THE RELAY ZONE',
      warn: d.status === 'active' && !d.inZone, progress: d.status === 'active' ? d.progress : undefined,
      state: d.status === 'complete' ? 'done' : 'active',
    });
    contracts.push({
      title: 'HUNT: WARDEN-9', tag: m.hunt.status === 'complete' ? 'COMPLETE' : 'CONTRACT',
      sub: m.hunt.status === 'complete' ? 'Target eliminated' : this.enemies.eliteAggro ? 'Target engaged · shoot off the helmet' : 'Last seen near the Halcyon reactor',
      state: m.hunt.status === 'complete' ? 'done' : 'active',
    });
    let exSub = 'Complete both contracts to unlock';
    let exState: ContractView['state'] = 'locked';
    if (ex.state === 'available') { exSub = 'Signal RAVEN 2-1 from the LZ radio [E]'; exState = 'active'; }
    else if (ex.state === 'called') { exSub = `Helicopter ETA ${Math.ceil(ex.countdown)}s · hold the LZ`; exState = 'active'; }
    else if (ex.state === 'landed') { exSub = 'BOARD THE HELICOPTER [E]'; exState = 'active'; }
    contracts.push({ title: 'EXTRACTION', tag: ex.state === 'locked' ? 'LOCKED' : 'EXFIL', sub: exSub, state: exState,
      progress: ex.state === 'called' ? 1 - ex.countdown / MISSION.extractionCountdown : undefined });

    // Prompt
    let prompt: string | null = null;
    const it = this.currentInteraction;
    if (it) {
      switch (it.kind) {
        case 'crate': prompt = '<kbd>E</kbd> Search supply cache'; break;
        case 'station': prompt = this.station ? null : it.station === 'buy' ? '<kbd>E</kbd> Open Quartermaster station' : '<kbd>E</kbd> Open Armory upgrade bench'; break;
        case 'transmitter': prompt = '<kbd>E</kbd> Activate uplink relay <span class="cost">CONTRACT</span>'; break;
        case 'radio': prompt = ex.state === 'available' ? '<kbd>E</kbd> Signal extraction <span class="cost">STARTS FINAL HORDE</span>'
          : ex.state === 'locked' ? 'Extraction radio <span class="denied">COMPLETE BOTH CONTRACTS</span>' : null; break;
        case 'board': prompt = '<kbd>E</kbd> Board the helicopter'; break;
      }
    }
    const other = this.loadout.slots[this.loadout.active === 0 ? 1 : 0];
    const eliteZ = this.enemies.elite;
    const eliteVisible = !!eliteZ && eliteZ.alive && (this.enemies.eliteAggro || Math.hypot(eliteZ.pos.x - p.pos.x, eliteZ.pos.z - p.pos.z) < 35);
    const fovRad = (this.renderer.camera.fov * Math.PI) / 180;
    const spreadDeg = this.weapons.currentSpread(p);
    const spreadPx = (Math.tan((spreadDeg * Math.PI) / 180) / Math.tan(fovRad / 2)) * (window.innerHeight / 2);
    const stats = w ? effectiveStats(w.id, w.tier) : null;
    this.hud.update(dt, {
      remaining: m.remaining, finalPhase: m.finalPhase,
      timerLabel: m.finalPhase ? 'EXFIL WINDOW' : 'MISSION',
      contracts, region: regionAt(p.pos.z),
      health: v.health, armor: v.armor, plates: v.plates, grenades: this.loadout.grenades, cash: this.loadout.cash,
      weaponName: w ? WEAPONS[w.id].name : '', tier: w?.tier ?? 0, mag: w?.mag ?? 0, magSize: stats?.magSize ?? 1, reserve: w?.reserve ?? 0,
      reloading: w ? isReloading(w) : false,
      secondary: other ? `[${this.loadout.active === 0 ? 2 : 1}] ${WEAPONS[other.id].shortName}  ${other.mag}/${other.reserve}` : '',
      stamina: v.stamina, exhausted: v.exhausted, sprinting: p.sprinting,
      plateProgress: v.plateT > 0 ? 1 - v.plateT / PLAYER.plateApplyTime : 0,
      adsT: this.weapons.adsT, spreadPx: Math.min(60, spreadPx),
      eliteHp: eliteVisible ? eliteZ!.hp / eliteZ!.maxHp : null,
      prompt, toxic, fps: this.settings.showFps ? this.fpsText : null,
      px: p.pos.x, pz: p.pos.z, yaw: p.yaw,
    });

    // Waypoints
    const wps: WaypointView[] = [];
    if (d.status !== 'complete') wps.push({ x: poi.transmitter.x, y: 4, z: poi.transmitter.z, kind: 'contract', icon: 'D', label: d.status === 'active' ? 'DEFEND' : 'UPLINK' });
    if (ex.state !== 'locked' && ex.state !== 'boarded') wps.push({ x: poi.lzPad.x, y: 2.5, z: poi.lzPad.z, kind: 'lz', icon: 'H', label: ex.state === 'landed' ? 'BOARD' : 'EXFIL' });
    if (eliteZ && eliteZ.alive && m.hunt.status !== 'complete') {
      if (eliteVisible) wps.push({ x: eliteZ.pos.x, y: eliteZ.pos.y + 2.8, z: eliteZ.pos.z, kind: 'elite', icon: '!', label: 'WARDEN-9' });
      else wps.push({ x: poi.reactor.x, y: 6, z: poi.reactor.z + 12, kind: 'elite', icon: '!', label: 'HUNT' });
    }
    if (this.station === null) {
      for (const s of poi.stations) {
        const dd = Math.hypot(s.x - p.pos.x, s.z - p.pos.z);
        if (dd < 30 && dd > 3) wps.push({ x: s.x, y: 2.4, z: s.z, kind: s.kind === 'buy' ? 'buy' : 'upgrade', icon: s.kind === 'buy' ? '$' : 'U', label: s.kind === 'buy' ? 'QUARTERMASTER' : 'ARMORY' });
      }
    }
    this.hud.updateWaypoints(wps, this.renderer.camera, p.pos.x, p.pos.z);

    // Maps
    const markers: MapMarker[] = [];
    for (const c of this.interact.crates) if (!c.opened) markers.push({ x: c.spot.x, z: c.spot.z, kind: 'crate' });
    for (const dr of this.interact.drops) markers.push({ x: dr.x, z: dr.z, kind: 'drop' });
    for (const s of poi.stations) markers.push({ x: s.x, z: s.z, kind: s.kind === 'buy' ? 'buy' : 'upgrade' });
    markers.push({ x: poi.transmitter.x, z: poi.transmitter.z, kind: d.status === 'complete' ? 'contractDone' : 'contract' });
    markers.push({ x: poi.lzPad.x, z: poi.lzPad.z, kind: ex.state === 'locked' ? 'lzLocked' : 'lz' });
    if (eliteZ && eliteZ.alive) {
      if (eliteVisible) markers.push({ x: eliteZ.pos.x, z: eliteZ.pos.z, kind: 'elite' });
      else markers.push({ x: poi.reactor.x + 8, z: poi.reactor.z + 10, kind: 'eliteArea' });
    }
    for (const z of this.enemies.zombies) {
      if (!z.alive || z.elite) continue;
      if (Math.hypot(z.pos.x - p.pos.x, z.pos.z - p.pos.z) < 32) markers.push({ x: z.pos.x, z: z.pos.z, kind: 'zombie' });
    }
    const st: MapState = {
      px: p.pos.x, pz: p.pos.z, yaw: p.yaw, markers,
      contamination: m.finalPhase ? { x: m.center.x, z: m.center.z, r: m.contaminationRadius } : null,
      defenseRing: d.status === 'active' ? { x: poi.transmitter.x, z: poi.transmitter.z, r: MISSION.defenseRadius } : null,
    };
    this.hud.drawMaps(st, this.mapOpen);
  }

  private buildContaminationWall(): THREE.Mesh {
    const c = this.level.poi.compoundCenter;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vPos;
        void main() { vUv = uv; vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime; varying vec2 vUv; varying vec3 vPos;
        float n(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
        float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(n(i), n(i + vec2(1, 0)), f.x), mix(n(i + vec2(0, 1)), n(i + vec2(1, 1)), f.x), f.y); }
        void main() {
          float a = atan(vPos.z, vPos.x);
          vec2 p = vec2(a * 18.0, vUv.y * 6.0 - uTime * 0.6);
          float cloud = vn(p) * 0.6 + vn(p * 2.3 + uTime * 0.2) * 0.4;
          float fade = (1.0 - vUv.y) * smoothstep(0.0, 0.08, vUv.y);
          float bands = 0.6 + 0.4 * sin(vUv.y * 40.0 - uTime * 3.0);
          vec3 col = vec3(0.62, 0.22, 0.85) * cloud * fade * bands;
          gl_FragColor = vec4(col * 0.9, cloud * fade * 0.8);
        }
      `,
    });
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 14, 96, 1, true), mat);
    m.position.set(c.x, 7, c.z);
    m.visible = false;
    m.frustumCulled = false;
    m.renderOrder = 5;
    return m;
  }

  // ------------------------------------------------------------------------------------------
  /** Development-only automation hooks (see main.ts). They drive the real systems. */
  devApi() {
    return {
      game: this,
      lock: (on: boolean) => { this.input.virtualLock = on; },
      teleport: (x: number, z: number, yaw?: number) => {
        const y = this.level.world.groundHeight(x, z, 0.3, 1.5);
        this.player.pos = { x, y, z };
        this.player.vel = { x: 0, y: 0, z: 0 };
        if (yaw !== undefined) this.player.yaw = yaw;
      },
      look: (yaw: number, pitch: number) => { this.player.yaw = yaw; this.player.pitch = pitch; },
      key: (code: string, down: boolean) => this.input.simulateKey(code, down),
      mouse: (button: number, down: boolean) => this.input.simulateMouse(button, down),
      cash: (n: number) => addCash(this.loadout, n),
      timeScale: (s: number) => { this.timeScale = s; },
      skipMission: (sec: number) => { this.mission.time += sec; },
      state: () => ({
        state: this.state, pos: { ...this.player.pos }, yaw: this.player.yaw, pitch: this.player.pitch, health: this.player.vitals.health,
        armor: this.player.vitals.armor, plates: this.player.vitals.plates, cash: this.loadout.cash, grenades: this.loadout.grenades,
        weapon: this.weapons.active && { ...this.weapons.active }, slots: this.loadout.slots.map((s) => s && { ...s }), active: this.loadout.active,
        crouched: this.player.crouched, height: this.player.height, grounded: this.player.grounded, stamina: this.player.vitals.stamina,
        defense: { status: this.mission.defense.status, progress: this.mission.defense.progress }, hunt: this.mission.hunt.status,
        extraction: { state: this.mission.extraction.state, countdown: this.mission.extraction.countdown }, mission: { time: this.mission.time, remaining: this.mission.remaining, final: this.mission.finalPhase, outcome: this.mission.outcome },
        zombies: this.enemies.aliveCount, stats: { ...this.mission.stats }, weaponStats: { ...this.weapons.stats }, station: this.station,
        interaction: this.currentInteraction?.kind ?? null,
      }),
      zombies: () => this.enemies.zombies.filter((z) => z.alive).map((z) => ({ type: z.type, x: +z.pos.x.toFixed(2), z: +z.pos.z.toFixed(2), state: z.state, hp: Math.round(z.hp), elite: z.elite })),
      spawnZombie: (type: 'shambler' | 'runner' | 'armored', x: number, z: number, state: 'idle' | 'chase' = 'chase') => this.enemies.spawn(type, regionAt(z), x, z, state),
      clearZombies: () => { for (const z of this.enemies.zombies) if (z.alive && !z.elite) { z.alive = false; z.state = 'dead'; z.deathT = 99; } },
      damagePlayer: (n: number) => this.onPlayerHit(n, this.player.pos.x + 1, this.player.pos.z, false),
      frameStats: () => {
        const a = [...this.frameTimes].sort((x, y) => x - y);
        const avg = a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
        return { avgMs: +avg.toFixed(2), p95Ms: +(a[Math.floor(a.length * 0.95)] ?? 0).toFixed(2), samples: a.length, drawCalls: this.renderer.renderer.info.render.calls, triangles: this.renderer.renderer.info.render.triangles };
      },
      raycastFromEye: () => {
        this.updateCamera();
        const f = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camQuat);
        const c = this.renderer.camera.position;
        return this.level.world.raycast(c.x, c.y, c.z, f.x, f.y, f.z, 200);
      },
      damageElite: (n: number) => { const e = this.enemies.elite; if (e && e.alive) this.enemies.damage(e, n, false, e.pos.x, e.pos.y + 1, e.pos.z, 0, 1); },
      heal: () => { this.player.vitals.health = 100; this.player.vitals.armor = 150; },
      elite: () => this.enemies.elite && { x: this.enemies.elite.pos.x, z: this.enemies.elite.pos.z, hp: this.enemies.elite.hp, helmet: this.enemies.elite.helmetHp, alive: this.enemies.elite.alive, state: this.enemies.elite.state },
    };
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
  }

  get bestRun() {
    return loadBest();
  }

  cancelPlate(): void {
    cancelPlate(this.player.vitals);
  }
}
