// Mission timeline: contracts, escalation pressure, contamination hazard and extraction state.
import { MISSION } from '../config';
import { DefenseContract, HuntContract, contractsComplete } from './Contracts';
import { ExtractionFSM, type Vec2 } from './Extraction';

/** A squad member as the mission sees them. */
export interface SquadPos extends Vec2 { alive: boolean }

export type MissionEvent =
  | { type: 'defenseComplete' }
  | { type: 'huntComplete' }
  | { type: 'extractionUnlocked' }
  | { type: 'finalPhase'; forced: boolean }
  | { type: 'heliLanded' }
  | { type: 'deadline' };

export interface MissionStats {
  kills: number;
  headshots: number;
  salvageEarned: number;
  cratesLooted: number;
  platesUsed: number;
  shots: number;
  hits: number;
}

export class Mission {
  time = 0;
  deadline = MISSION.deadline;
  finalPhase = false;
  finalStart = 0;
  defense = new DefenseContract();
  hunt = new HuntContract();
  extraction: ExtractionFSM;
  contaminationRadius = 0;
  private contamStartR = MISSION.contaminationStartRadius;
  private contamEndR = 0;
  stats: MissionStats = { kills: 0, headshots: 0, salvageEarned: 0, cratesLooted: 0, platesUsed: 0, shots: 0, hits: 0 };
  outcome: 'active' | 'victory' | 'dead' | 'timeout' = 'active';
  private unlockedAnnounced = false;

  constructor(public center: Vec2, public lz: Vec2, radio: Vec2, board: Vec2) {
    this.extraction = new ExtractionFSM(radio, board);
    this.contamEndR = Math.hypot(lz.x - center.x, lz.z - center.z) + 8;
  }

  get remaining(): number {
    return Math.max(0, this.deadline - this.time);
  }

  /** 1.0 at start, rising with time, completed contracts and the final phase. */
  get pressure(): number {
    let p = 1 + Math.min(1, this.time / 600) * 0.45;
    if (this.defense.status === 'complete') p += 0.12;
    if (this.hunt.status === 'complete') p += 0.12;
    if (this.finalPhase) p += 0.25;
    return p;
  }

  inContamination(x: number, z: number): boolean {
    return this.finalPhase && Math.hypot(x - this.center.x, z - this.center.z) < this.contaminationRadius;
  }

  private startFinal(forced: boolean, out: MissionEvent[]): void {
    if (this.finalPhase) return;
    this.finalPhase = true;
    this.finalStart = this.time;
    // Clamp the remaining window so the finale stays tense but achievable.
    this.deadline = Math.min(this.deadline, this.time + MISSION.finalPhaseWindow);
    out.push({ type: 'finalPhase', forced });
  }

  update(dt: number, squad: readonly SquadPos[]): MissionEvent[] {
    const out: MissionEvent[] = [];
    if (this.outcome !== 'active') return out;
    this.time += dt;
    // The relay transmits while any living squad member holds the zone.
    const inZone = squad.some((p) => p.alive && Math.hypot(p.x - this.defenseCenter.x, p.z - this.defenseCenter.z) <= MISSION.defenseRadius);
    if (this.defense.update(dt, inZone)) out.push({ type: 'defenseComplete' });
    if (contractsComplete(this.defense, this.hunt) && !this.unlockedAnnounced) {
      this.unlockedAnnounced = true;
      this.extraction.unlock();
      out.push({ type: 'extractionUnlocked' });
      this.startFinal(false, out);
    }
    if (!this.finalPhase && this.time >= MISSION.forcedFinalPhaseAt) this.startFinal(true, out);
    if (this.finalPhase) {
      const span = Math.max(1, this.deadline - this.finalStart);
      const t = Math.min(1, (this.time - this.finalStart) / span);
      this.contaminationRadius = this.contamStartR + (this.contamEndR - this.contamStartR) * Math.pow(t, 1.15);
    }
    if (this.extraction.update(dt) === 'landed') out.push({ type: 'heliLanded' });
    if (this.time >= this.deadline && !this.extraction.finished) {
      this.extraction.fail();
      this.outcome = 'timeout';
      out.push({ type: 'deadline' });
    }
    return out;
  }

  defenseCenter: Vec2 = { x: 0, z: 0 };

  onEliteKilled(): boolean {
    return this.hunt.onTargetKilled();
  }

  get contractsDone(): number {
    return (this.defense.status === 'complete' ? 1 : 0) + (this.hunt.status === 'complete' ? 1 : 0);
  }
}
