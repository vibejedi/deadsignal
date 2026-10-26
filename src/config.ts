// Central balancing and tuning values. Gameplay code reads from here rather than hard-coding numbers.

export type RegionId = 'low' | 'medium' | 'high';
export type ZombieType = 'shambler' | 'runner' | 'armored' | 'elite';
export type WeaponId = 'rifle' | 'pistol' | 'shotgun';

export const SIM_DT = 1 / 60;
export const MAX_FRAME_DT = 0.1;

export const WORLD = {
  minX: -70,
  maxX: 70,
  minZ: -110,
  maxZ: 100,
  gravity: 17,
};

export const PLAYER = {
  radius: 0.3,
  standHeight: 1.75,
  crouchHeight: 1.1,
  eyeOffset: 0.12,
  walkSpeed: 4.6,
  sprintSpeed: 7.1,
  crouchSpeed: 2.3,
  adsSpeed: 2.9,
  groundAccel: 55,
  airAccel: 9,
  friction: 10,
  jumpVelocity: 5.4,
  stepHeight: 0.45,
  maxHealth: 100,
  healthRegenDelay: 4.5,
  healthRegenRate: 22,
  maxStamina: 100,
  staminaDrain: 17,
  staminaRegen: 26,
  staminaRegenDelay: 1.0,
  staminaMinToSprint: 22,
  plateArmor: 50,
  maxArmorPlates: 3, // plates slotted into the vest (3 x 50 = 150 armor)
  maxPlateInventory: 5,
  plateApplyTime: 1.25,
  maxGrenades: 4,
  startPlatesInVest: 2,
  startPlateInventory: 2,
  startGrenades: 2,
  startCash: 500,
};

export interface WeaponDef {
  id: WeaponId;
  name: string;
  shortName: string;
  auto: boolean;
  damage: number;
  headMult: number;
  pellets: number;
  rpm: number;
  magSize: number;
  reserveMax: number;
  startReserve: number;
  reloadTime: number;
  /** Shell-by-shell reload timing (shotgun). */
  shellReload?: { start: number; perShell: number; end: number };
  hipSpread: number; // degrees (cone half-angle)
  adsSpread: number;
  moveSpread: number;
  rangeNear: number;
  rangeFar: number;
  minDamageMult: number;
  recoilPitch: number; // degrees per shot
  recoilYaw: number;
  recoilRecover: number; // degrees/s
  adsTime: number;
  adsZoom: number; // FOV multiplier while aiming
  switchTime: number;
  cost: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  rifle: {
    id: 'rifle',
    name: 'KR-7 KESTREL',
    shortName: 'KESTREL',
    auto: true,
    damage: 32,
    headMult: 2.2,
    pellets: 1,
    rpm: 720,
    magSize: 30,
    reserveMax: 210,
    startReserve: 150,
    reloadTime: 2.1,
    hipSpread: 2.4,
    adsSpread: 0.35,
    moveSpread: 1.8,
    rangeNear: 30,
    rangeFar: 75,
    minDamageMult: 0.65,
    recoilPitch: 0.55,
    recoilYaw: 0.28,
    recoilRecover: 9,
    adsTime: 0.22,
    adsZoom: 0.72,
    switchTime: 0.45,
    cost: 0,
  },
  pistol: {
    id: 'pistol',
    name: 'P-19 WARDEN',
    shortName: 'WARDEN',
    auto: false,
    damage: 44,
    headMult: 2.4,
    pellets: 1,
    rpm: 420,
    magSize: 12,
    reserveMax: 96,
    startReserve: 60,
    reloadTime: 1.35,
    hipSpread: 1.5,
    adsSpread: 0.4,
    moveSpread: 1.0,
    rangeNear: 18,
    rangeFar: 45,
    minDamageMult: 0.6,
    recoilPitch: 1.3,
    recoilYaw: 0.35,
    recoilRecover: 12,
    adsTime: 0.15,
    adsZoom: 0.82,
    switchTime: 0.3,
    cost: 0,
  },
  shotgun: {
    id: 'shotgun',
    name: 'HB-12 HULLBREAKER',
    shortName: 'HULLBREAKER',
    auto: false,
    damage: 21,
    headMult: 1.6,
    pellets: 9,
    rpm: 72,
    magSize: 6,
    reserveMax: 42,
    startReserve: 30,
    reloadTime: 0, // unused - shell reload
    shellReload: { start: 0.35, perShell: 0.48, end: 0.4 },
    hipSpread: 5.2,
    adsSpread: 3.6,
    moveSpread: 0.8,
    rangeNear: 7,
    rangeFar: 22,
    minDamageMult: 0.3,
    recoilPitch: 4.2,
    recoilYaw: 0.8,
    recoilRecover: 14,
    adsTime: 0.26,
    adsZoom: 0.85,
    switchTime: 0.5,
    cost: 1500,
  },
};

/** Upgrade tiers: index 0 = base. */
export const UPGRADE_TIERS = [
  { name: 'STOCK', damageMult: 1, magMult: 1, reloadMult: 1, rpmMult: 1, spreadMult: 1, cost: 0 },
  { name: 'TIER I', damageMult: 1.65, magMult: 1.25, reloadMult: 0.85, rpmMult: 1.08, spreadMult: 0.85, cost: 2500 },
  { name: 'TIER II', damageMult: 2.5, magMult: 1.5, reloadMult: 0.7, rpmMult: 1.15, spreadMult: 0.7, cost: 5000 },
];

export interface ZombieDef {
  hp: number;
  speed: [number, number];
  damage: number;
  attackRange: number;
  windup: number;
  attackCooldown: number;
  reward: number;
  scale: number;
  helmetHp: number;
  bodyArmorMult: number; // multiplier applied to body damage
  staggerThreshold: number; // damage in one hit that causes stagger
}

export const ZOMBIES: Record<ZombieType, ZombieDef> = {
  shambler: { hp: 110, speed: [1.35, 2.0], damage: 20, attackRange: 1.45, windup: 0.5, attackCooldown: 1.2, reward: 40, scale: 1, helmetHp: 0, bodyArmorMult: 1, staggerThreshold: 60 },
  runner: { hp: 85, speed: [4.3, 5.1], damage: 14, attackRange: 1.4, windup: 0.34, attackCooldown: 0.95, reward: 55, scale: 0.97, helmetHp: 0, bodyArmorMult: 1, staggerThreshold: 50 },
  armored: { hp: 300, speed: [1.8, 2.2], damage: 30, attackRange: 1.55, windup: 0.6, attackCooldown: 1.4, reward: 130, scale: 1.08, helmetHp: 140, bodyArmorMult: 0.55, staggerThreshold: 140 },
  elite: { hp: 3400, speed: [2.7, 2.9], damage: 42, attackRange: 2.3, windup: 0.8, attackCooldown: 1.7, reward: 0, scale: 1.4, helmetHp: 400, bodyArmorMult: 0.7, staggerThreshold: 99999 },
};

export interface RegionDef {
  id: RegionId;
  label: string;
  threat: string;
  hpMult: number;
  damageMult: number;
  rewardMult: number;
  maxAlive: number;
  spawnInterval: number;
  weights: Record<Exclude<ZombieType, 'elite'>, number>;
  initialPopulation: number;
  color: string;
}

export const REGIONS: Record<RegionId, RegionDef> = {
  low: {
    id: 'low', label: 'CHECKPOINT DISTRICT', threat: 'LOW THREAT', hpMult: 1, damageMult: 1, rewardMult: 1,
    maxAlive: 10, spawnInterval: 3.2, weights: { shambler: 0.82, runner: 0.18, armored: 0 },
    initialPopulation: 7, color: '#8fb573',
  },
  medium: {
    id: 'medium', label: 'KESSLER FREIGHT DEPOT', threat: 'MEDIUM THREAT', hpMult: 1.35, damageMult: 1.25, rewardMult: 1.6,
    maxAlive: 18, spawnInterval: 1.9, weights: { shambler: 0.52, runner: 0.36, armored: 0.12 },
    initialPopulation: 11, color: '#d8a64a',
  },
  high: {
    id: 'high', label: 'HALCYON RESEARCH COMPOUND', threat: 'HIGH THREAT', hpMult: 1.8, damageMult: 1.5, rewardMult: 2.4,
    maxAlive: 26, spawnInterval: 1.15, weights: { shambler: 0.3, runner: 0.42, armored: 0.28 },
    initialPopulation: 13, color: '#d0473c',
  },
};

/** z boundaries between threat regions (north is -Z). */
export const REGION_BOUNDS = { lowMinZ: 50, mediumMinZ: -26 };

export function regionAt(z: number): RegionId {
  if (z > REGION_BOUNDS.lowMinZ) return 'low';
  if (z > REGION_BOUNDS.mediumMinZ) return 'medium';
  return 'high';
}

export const ENEMIES = {
  globalCap: 38,
  hordeCap: 28,
  spawnMinDist: 22,
  spawnMaxDist: 58,
  corpseLifetime: 7,
  maxCorpses: 14,
  separationRadius: 0.75,
  sightRange: 26,
  hearingRange: 48,
  flowFieldInterval: 0.2,
  losCheckInterval: 0.3,
  ammoDropChance: 0.07,
  headshotBonus: 20,
};

export const ECONOMY = {
  ammoCost: 400,
  plateCost: 250,
  grenadeCost: 250,
  shotgunCost: WEAPONS.shotgun.cost,
  plateOverflowCash: 100,
};

/** Co-op squad scaling. Each extra player adds these fractions on top of the solo values. */
export const COOP = {
  maxSquad: 4,
  capPerExtraPlayer: 0.35,
  ratePerExtraPlayer: 0.3,
  eliteHpPerExtraPlayer: 0.5,
};

/** Multiplier for a squad of `n` players: 1 for solo, +`perExtra` for each additional player. */
export function squadScale(n: number, perExtra: number): number {
  return 1 + perExtra * Math.max(0, Math.min(COOP.maxSquad, n) - 1);
}

export const MISSION = {
  deadline: 900, // 15:00 total mission clock
  finalPhaseWindow: 330, // once both contracts complete, the remaining window is clamped to this
  forcedFinalPhaseAt: 600, // contamination starts at 10:00 regardless
  defenseHoldTime: 60,
  defenseRadius: 9,
  defenseDecay: 0.004, // progress fraction lost per second when outside the zone
  defenseReward: 1500,
  huntReward: 2000,
  extractionCountdown: 75,
  heliVisibleAt: 28, // seconds before landing that the helicopter becomes visible
  boardRadius: 3.2,
  radioRadius: 2.6,
  contaminationDps: 9,
  contaminationStartRadius: 22,
};

export const GRENADE = {
  fuse: 2.4,
  throwSpeed: 14,
  radius: 7.5,
  maxDamage: 380,
  playerDamageMult: 0.35,
  bounce: 0.38,
};

export const PERF = {
  maxDecals: 90,
  maxParticles: 900,
  maxTracers: 24,
  maxAudioVoices: 36,
};
