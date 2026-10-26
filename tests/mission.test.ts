import { describe, expect, it } from 'vitest';
import { MISSION } from '../src/config';
import { DefenseContract, HuntContract } from '../src/mission/Contracts';
import { ExtractionFSM } from '../src/mission/Extraction';
import { Mission } from '../src/mission/Mission';

describe('defense contract', () => {
  it('only progresses while the player is in the zone and completes exactly once', () => {
    const d = new DefenseContract();
    expect(d.update(10, true)).toBe(false); // not activated yet
    expect(d.progress).toBe(0);
    expect(d.activate()).toBe(true);
    expect(d.activate()).toBe(false);
    d.update(MISSION.defenseHoldTime / 2, true);
    expect(d.progress).toBeCloseTo(0.5);
    d.update(10, false);
    expect(d.progress).toBeLessThan(0.5); // decays outside the zone
    let completions = 0;
    for (let i = 0; i < 200; i++) if (d.update(1, true)) completions++;
    expect(completions).toBe(1);
    expect(d.status).toBe('complete');
  });
});

describe('hunt contract', () => {
  it('rewards only once', () => {
    const h = new HuntContract();
    expect(h.onTargetKilled()).toBe(true);
    expect(h.onTargetKilled()).toBe(false);
    expect(h.status).toBe('complete');
  });
});

describe('extraction state machine', () => {
  const radio = { x: 0, z: 0 }, board = { x: 10, z: 0 };

  it('requires unlocking, calling at the radio, the countdown, then boarding in person', () => {
    const e = new ExtractionFSM(radio, board);
    expect(e.call(radio)).toBe(false); // locked
    e.unlock();
    expect(e.call({ x: 50, z: 50 })).toBe(false); // too far from the radio
    expect(e.call(radio)).toBe(true);
    expect(e.state).toBe('called');
    expect(e.board(board, true)).toBe(false); // helicopter not landed yet
    expect(e.update(MISSION.extractionCountdown - 1)).toBe('none');
    expect(e.update(2)).toBe('landed');
    expect(e.state).toBe('landed');
    expect(e.board({ x: 40, z: 40 }, true)).toBe(false); // standing elsewhere does not win
    expect(e.board(board, false)).toBe(false); // dead players cannot board
    expect(e.state).toBe('landed');
    expect(e.board(board, true)).toBe(true);
    expect(e.state).toBe('boarded');
  });

  it('timer expiry alone never produces victory', () => {
    const e = new ExtractionFSM(radio, board);
    e.unlock();
    e.call(radio);
    for (let i = 0; i < 1000; i++) e.update(1);
    expect(e.state).toBe('landed');
    e.fail();
    expect(e.state).toBe('failed');
    expect(e.board(board, true)).toBe(false);
  });
});

describe('mission timeline', () => {
  const mk = () => {
    const m = new Mission({ x: 0, z: -70 }, { x: 40, z: 46 }, { x: 30, z: 46 }, { x: 41, z: 43 });
    m.defenseCenter = { x: 40, z: 6 };
    return m;
  };

  it('unlocks extraction and starts the final phase once both contracts are done', () => {
    const m = mk();
    m.defense.activate();
    let events = m.update(MISSION.defenseHoldTime + 1, [{ x: 40, z: 6, alive: true }]);
    expect(events.some((e) => e.type === 'defenseComplete')).toBe(true);
    expect(m.extraction.state).toBe('locked');
    m.onEliteKilled();
    events = m.update(0.1, [{ x: 0, z: 0, alive: true }]);
    expect(events.some((e) => e.type === 'extractionUnlocked')).toBe(true);
    expect(events.some((e) => e.type === 'finalPhase')).toBe(true);
    expect(m.extraction.state).toBe('available');
    expect(m.remaining).toBeLessThanOrEqual(MISSION.finalPhaseWindow);
  });

  it('forces the contamination phase at the scheduled time and fails at the deadline', () => {
    const m = mk();
    const ev = m.update(MISSION.forcedFinalPhaseAt + 1, [{ x: 0, z: 0, alive: true }]);
    expect(ev.some((e) => e.type === 'finalPhase' && e.forced)).toBe(true);
    expect(m.inContamination(0, -70)).toBe(true);
    const end = m.update(MISSION.deadline, [{ x: 0, z: 0, alive: true }]);
    expect(end.some((e) => e.type === 'deadline')).toBe(true);
    expect(m.outcome).toBe('timeout');
  });

  it('contamination reaches the landing zone by the deadline', () => {
    const m = mk();
    m.update(MISSION.forcedFinalPhaseAt + 0.1, [{ x: 0, z: 0, alive: true }]);
    expect(m.inContamination(40, 46)).toBe(false);
    m.update(m.deadline - m.time - 0.5, [{ x: 0, z: 0, alive: true }]);
    expect(m.inContamination(40, 46)).toBe(true);
  });
});
