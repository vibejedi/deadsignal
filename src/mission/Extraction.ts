// Pure extraction state machine. Victory requires every living squad member to physically board after landing.
import { MISSION } from '../config';

export type ExtractionState = 'locked' | 'available' | 'called' | 'landed' | 'boarded' | 'failed';

export interface Vec2 { x: number; z: number }

export class ExtractionFSM {
  state: ExtractionState = 'locked';
  countdown = 0;
  /** Squad members already aboard the landed helicopter. */
  readonly aboard = new Set<number>();

  constructor(public radioPos: Vec2, public boardPos: Vec2) {}

  unlock(): void {
    if (this.state === 'locked') this.state = 'available';
  }

  canCall(p: Vec2): boolean {
    return this.state === 'available' && dist(p, this.radioPos) <= MISSION.radioRadius;
  }

  call(p: Vec2): boolean {
    if (!this.canCall(p)) return false;
    this.state = 'called';
    this.countdown = MISSION.extractionCountdown;
    return true;
  }

  /** Seconds since the helicopter became visible, normalised 0..1 (1 = touching down). */
  approach(): number {
    if (this.state === 'landed' || this.state === 'boarded') return 1;
    if (this.state !== 'called') return 0;
    return Math.max(0, Math.min(1, 1 - this.countdown / MISSION.heliVisibleAt));
  }

  heliVisible(): boolean {
    return (this.state === 'called' && this.countdown <= MISSION.heliVisibleAt) || this.state === 'landed' || this.state === 'boarded';
  }

  canBoard(p: Vec2, alive: boolean): boolean {
    return this.state === 'landed' && alive && dist(p, this.boardPos) <= MISSION.boardRadius;
  }

  /** Solo boarding: the single player boards and the extraction completes. */
  board(p: Vec2, alive: boolean): boolean {
    return this.boardPlayer(0, p, alive) && this.tryComplete([0]);
  }

  /** Puts one squad member aboard. True if they were allowed on (landed, alive, at the door). */
  boardPlayer(id: number, p: Vec2, alive: boolean): boolean {
    if (!this.canBoard(p, alive)) return false;
    this.aboard.add(id);
    return true;
  }

  /** Completes the extraction once every living squad member is aboard. */
  tryComplete(livingIds: readonly number[]): boolean {
    if (this.state !== 'landed' || livingIds.length === 0) return false;
    if (!livingIds.every((id) => this.aboard.has(id))) return false;
    this.state = 'boarded';
    return true;
  }

  /** Returns 'landed' on the step the helicopter touches down. */
  update(dt: number): 'none' | 'landed' {
    if (this.state !== 'called') return 'none';
    this.countdown = Math.max(0, this.countdown - dt);
    if (this.countdown <= 0) {
      this.state = 'landed';
      return 'landed';
    }
    return 'none';
  }

  fail(): void {
    if (this.state !== 'boarded') this.state = 'failed';
  }

  get finished(): boolean {
    return this.state === 'boarded' || this.state === 'failed';
  }
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
