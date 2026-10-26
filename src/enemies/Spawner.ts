// Decides when/where/what to spawn. Threat region, mission pressure, contracts, the final horde and
// squad size all change composition and rate. Spawns happen at reachable points out of every player's sight.
import { COOP, ENEMIES, REGIONS, regionAt, squadScale, type RegionId, type ZombieType } from '../config';
import type { Level, P2 } from '../world/Level';
import type { EnemyManager } from './EnemyManager';

/** A living squad member as the spawner sees them: position, eye height and facing (unit xz). */
export interface SpawnViewer {
  x: number; z: number; eyeY: number;
  fx: number; fz: number;
}

export interface SpawnContext {
  players: SpawnViewer[];
  pressure: number;
  defenseActive: boolean;
  finalHorde: boolean;
}

type SegmentBlocked = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => boolean;

/**
 * How a candidate spawn point looks to the squad: 'hidden' if every player has it behind them or
 * occluded, 'far' if someone could see it but everyone is at least `farDist` away, otherwise 'seen'.
 */
export function spawnVisibility(x: number, z: number, viewers: readonly SpawnViewer[], blocked: SegmentBlocked, farDist = 38): 'hidden' | 'far' | 'seen' {
  let hidden = true;
  let far = true;
  for (const v of viewers) {
    const straight = Math.hypot(x - v.x, z - v.z) || 1e-6;
    const dx = (x - v.x) / straight, dz = (z - v.z) / straight;
    const behind = dx * v.fx + dz * v.fz < -0.2;
    if (!behind && !blocked(v.x, v.eyeY, v.z, x, 1.4, z)) hidden = false;
    if (straight <= farDist) far = false;
  }
  return hidden ? 'hidden' : far ? 'far' : 'seen';
}

export class Spawner {
  private timer = 3;
  private defenseTimer = 0;
  private hordeTimer = 0;
  private anchor = 0;

  constructor(private level: Level, private enemies: EnemyManager, private rnd: () => number = Math.random) {}

  reset(): void {
    this.timer = 4;
    this.defenseTimer = 0;
    this.hordeTimer = 0;
  }

  /** Initial idle population scattered through each region, away from the insertion point. */
  populate(squadSize = 1): void {
    const nav = this.level.nav;
    const spawn = this.level.poi.playerSpawn;
    const c = { x: 0, z: 0 };
    for (const r of Object.keys(REGIONS) as RegionId[]) {
      const def = REGIONS[r];
      let placed = 0, tries = 0;
      while (placed < def.initialPopulation && tries++ < 800) {
        const i = Math.floor(this.rnd() * nav.walk.length);
        if (!nav.walk[i]) continue;
        nav.cellCenter(i, c);
        if (regionAt(c.z) !== r) continue;
        if (Math.hypot(c.x - spawn.x, c.z - spawn.z) < 38) continue;
        if (nav.height[i] > 0.2) continue;
        this.enemies.spawn(pickType(def.weights, this.rnd), r, c.x, c.z, 'idle');
        placed++;
      }
    }
    // The hunt target patrols the research compound.
    const e = this.level.poi.eliteSpawn;
    const elite = this.enemies.spawn('elite', 'high', e.x, e.z, 'idle');
    const tough = squadScale(squadSize, COOP.eliteHpPerExtraPlayer);
    elite.maxHp *= tough;
    elite.hp = elite.maxHp;
    elite.helmetHp *= tough;
    // Escort
    for (let k = 0; k < 3; k++) this.enemies.spawn(k === 0 ? 'armored' : 'runner', 'high', e.x + (k - 1) * 2.5, e.z + 3, 'idle');
  }

  update(dt: number, ctx: SpawnContext): void {
    const n = ctx.players.length;
    if (n === 0) return;
    // Ambient spawns rotate around the squad so a player who wanders off still gets pressure.
    const anchor = ctx.players[this.anchor % n];
    const region = regionAt(anchor.z);
    const def = REGIONS[region];
    const alive = this.enemies.aliveCount;
    const capScale = squadScale(n, COOP.capPerExtraPlayer);
    const rateScale = squadScale(n, COOP.ratePerExtraPlayer);
    const globalCap = Math.round(ENEMIES.globalCap * capScale);
    const cap = Math.min(globalCap, Math.round(def.maxAlive * ctx.pressure * capScale) + (ctx.defenseActive ? 8 : 0));

    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = def.spawnInterval / ctx.pressure / rateScale * (0.7 + this.rnd() * 0.6);
      this.anchor++;
      if (alive < cap) {
        const group = region === 'low' ? 1 : this.rnd() < 0.35 ? 2 : 1;
        for (let g = 0; g < group && this.enemies.aliveCount < cap; g++) this.spawnNear(ctx, anchor, region, pickType(def.weights, this.rnd));
      }
    }
    // Defense contract waves converge on the transmitter
    if (ctx.defenseActive) {
      this.defenseTimer -= dt;
      if (this.defenseTimer <= 0) {
        this.defenseTimer = 2.4 / ctx.pressure / rateScale;
        if (this.enemies.aliveCount < globalCap) this.spawnNear(ctx, anchor, 'medium', pickType(REGIONS.medium.weights, this.rnd), 18, 42);
      }
    }
    // Extraction final horde: fast, high-threat composition, capped.
    if (ctx.finalHorde) {
      this.hordeTimer -= dt;
      if (this.hordeTimer <= 0) {
        this.hordeTimer = 1.25 / rateScale;
        if (this.enemies.aliveCount < Math.round(ENEMIES.hordeCap * capScale)) this.spawnNear(ctx, anchor, 'medium', pickType(REGIONS.medium.weights, this.rnd), 20, 45, true);
      }
    }
  }

  private spawnNear(ctx: SpawnContext, anchor: SpawnViewer, region: RegionId, type: ZombieType, minD = ENEMIES.spawnMinDist, maxD = ENEMIES.spawnMaxDist, anyRegion = false): boolean {
    const nav = this.level.nav;
    const world = this.level.world;
    const cands: P2[] = [];
    const regions: RegionId[] = anyRegion ? ['low', 'medium', 'high'] : neighbours(region);
    for (const r of regions) cands.push(...this.level.poi.spawns[r]);
    const good: P2[] = [];
    const ok: P2[] = [];
    const blocked: SegmentBlocked = (ax, ay, az, bx, by, bz) => world.segmentBlocked(ax, ay, az, bx, by, bz);
    for (const p of cands) {
      // Near the anchor player, but never on top of anyone in the squad.
      if (Math.hypot(p.x - anchor.x, p.z - anchor.z) > maxD) continue;
      if (ctx.players.some((v) => Math.hypot(p.x - v.x, p.z - v.z) < minD)) continue;
      // pathDist is the walking distance to the nearest player (multi-source flow field).
      const path = nav.pathDist(p.x, p.z);
      if (!isFinite(path) || path > maxD * 1.6) continue;
      // Prefer spawns nobody can see: behind everyone or occluded for everyone.
      const vis = spawnVisibility(p.x, p.z, ctx.players, blocked);
      if (vis === 'hidden') good.push(p);
      else if (vis === 'far') ok.push(p);
    }
    const list = good.length ? good : ok;
    if (!list.length) return false;
    const p = list[Math.floor(this.rnd() * list.length)];
    // Jitter within a couple of metres to avoid stacking
    for (let k = 0; k < 6; k++) {
      const x = p.x + (this.rnd() - 0.5) * 3, z = p.z + (this.rnd() - 0.5) * 3;
      if (nav.isWalkable(x, z) && isFinite(nav.pathDist(x, z))) {
        this.enemies.spawn(type, region, x, z, 'chase');
        return true;
      }
    }
    this.enemies.spawn(type, region, p.x, p.z, 'chase');
    return true;
  }
}

function neighbours(r: RegionId): RegionId[] {
  return r === 'low' ? ['low'] : r === 'medium' ? ['medium', 'low'] : ['high', 'medium'];
}

function pickType(w: Record<'shambler' | 'runner' | 'armored', number>, rnd: () => number): ZombieType {
  const t = w.shambler + w.runner + w.armored;
  let r = rnd() * t;
  if ((r -= w.shambler) < 0) return 'shambler';
  if ((r -= w.runner) < 0) return 'runner';
  return 'armored';
}
