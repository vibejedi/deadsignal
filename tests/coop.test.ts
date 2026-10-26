import { describe, expect, it } from 'vitest';
import { COOP, MISSION, squadScale } from '../src/config';
import { Squad } from '../src/core/Squad';
import { spawnVisibility, type SpawnViewer } from '../src/enemies/Spawner';
import { pickTarget, RETARGET_MARGIN, type PlayerTarget } from '../src/enemies/targeting';
import { ExtractionFSM } from '../src/mission/Extraction';
import { Mission } from '../src/mission/Mission';
import { Player } from '../src/player/Player';
import { applyDamage } from '../src/player/Vitals';
import { CollisionWorld } from '../src/world/Collision';
import { NavGrid } from '../src/world/NavGrid';

const target = (id: number, x: number, z: number, alive = true): PlayerTarget => ({ id, x, y: 0, z, eyeY: 1.6, alive });

describe('zombie targeting', () => {
  it('chases the nearest living player', () => {
    const t = pickTarget(0, 0, [target(0, 10, 0), target(1, 3, 0)], -1);
    expect(t?.id).toBe(1);
  });

  it('ignores dead or boarded players and returns null when nobody is alive', () => {
    expect(pickTarget(0, 0, [target(0, 1, 0, false), target(1, 9, 0)], -1)?.id).toBe(1);
    expect(pickTarget(0, 0, [target(0, 1, 0, false)], -1)).toBeNull();
  });

  it('sticks with its current target unless another is clearly closer', () => {
    const players = [target(0, 5, 0), target(1, 4, 0)];
    expect(pickTarget(0, 0, players, 0)?.id).toBe(0); // only 1 m closer: keep chasing player 0
    const far = [target(0, 5 + RETARGET_MARGIN + 1, 0), target(1, 4, 0)];
    expect(pickTarget(0, 0, far, 0)?.id).toBe(1); // much closer now: switch
  });
});

describe('multi-source flow field', () => {
  it('measures path distance to the nearest player and leads toward them', () => {
    const w = new CollisionWorld(-20, -20, 20, 20);
    const nav = new NavGrid(-20, -20, 20, 20);
    nav.build(w);
    nav.computeFlowMulti([{ x: -15, z: 0 }, { x: 15, z: 0 }]);
    // Each side resolves to its own nearest player
    expect(nav.pathDist(-12, 0)).toBeLessThan(5);
    expect(nav.pathDist(12, 0)).toBeLessThan(5);
    const out = { x: 0, z: 0 };
    expect(nav.flowDir(-8, 0, out)).toBe(true);
    expect(out.x).toBeLessThan(0); // toward the left player
    expect(nav.flowDir(8, 0, out)).toBe(true);
    expect(out.x).toBeGreaterThan(0); // toward the right player
  });

  it('matches the single-target field when there is one player', () => {
    const w = new CollisionWorld(-20, -20, 20, 20);
    const a = new NavGrid(-20, -20, 20, 20);
    const b = new NavGrid(-20, -20, 20, 20);
    a.build(w); b.build(w);
    a.computeFlow(3, -7);
    b.computeFlowMulti([{ x: 3, z: -7 }]);
    for (const [x, z] of [[0, 0], [10, 10], [-15, 5]]) expect(b.pathDist(x, z)).toBe(a.pathDist(x, z));
  });
});

describe('spawn visibility for a squad', () => {
  const open = () => false; // nothing blocks sight
  const viewer = (x: number, z: number, fx: number, fz: number): SpawnViewer => ({ x, z, eyeY: 1.6, fx, fz });

  it('is hidden only when every player has the spot behind them', () => {
    // Spot at x = -20; both players face +x, so it is behind both
    expect(spawnVisibility(-20, 0, [viewer(0, 0, 1, 0), viewer(0, 5, 1, 0)], open)).toBe('hidden');
    // Second player turns around and can see it
    expect(spawnVisibility(-20, 0, [viewer(0, 0, 1, 0), viewer(0, 5, -1, 0)], open)).toBe('seen');
  });

  it('counts occluded spots as hidden and distant spots as far', () => {
    expect(spawnVisibility(20, 0, [viewer(0, 0, 1, 0)], () => true)).toBe('hidden');
    expect(spawnVisibility(50, 0, [viewer(0, 0, 1, 0)], open)).toBe('far');
    expect(spawnVisibility(50, 0, [viewer(0, 0, 1, 0), viewer(30, 0, 1, 0)], open)).toBe('seen'); // too close to player 2
  });
});

describe('squad scaling', () => {
  it('is neutral solo and grows per extra player up to the squad cap', () => {
    expect(squadScale(1, 0.35)).toBe(1);
    expect(squadScale(2, 0.35)).toBeCloseTo(1.35);
    expect(squadScale(4, 0.35)).toBeCloseTo(2.05);
    expect(squadScale(COOP.maxSquad + 3, 0.35)).toBeCloseTo(squadScale(COOP.maxSquad, 0.35));
  });
});

describe('mission with a squad', () => {
  const newMission = () => {
    const m = new Mission({ x: 0, z: -70 }, { x: 40, z: 46 }, { x: 30, z: 46 }, { x: 41, z: 43 });
    m.defenseCenter = { x: 40, z: 6 };
    m.defense.activate();
    return m;
  };

  it('holds the relay zone while any living member stands in it', () => {
    const m = newMission();
    m.update(MISSION.defenseHoldTime / 2, [{ x: 0, z: 0, alive: true }, { x: 40, z: 6, alive: true }]);
    expect(m.defense.progress).toBeCloseTo(0.5, 1);
  });

  it('does not count a dead member standing in the zone', () => {
    const m = newMission();
    m.update(10, [{ x: 0, z: 0, alive: true }, { x: 40, z: 6, alive: false }]);
    expect(m.defense.progress).toBe(0);
  });
});

describe('squad extraction', () => {
  const landed = () => {
    const e = new ExtractionFSM({ x: 0, z: 0 }, { x: 5, z: 5 });
    e.unlock();
    e.call({ x: 0, z: 0 });
    e.update(MISSION.extractionCountdown + 1);
    return e;
  };
  const door = { x: 5, z: 5 };

  it('completes only when every living member is aboard', () => {
    const e = landed();
    expect(e.boardPlayer(0, door, true)).toBe(true);
    expect(e.tryComplete([0, 1])).toBe(false);
    expect(e.state).toBe('landed');
    expect(e.boardPlayer(1, door, true)).toBe(true);
    expect(e.tryComplete([0, 1])).toBe(true);
    expect(e.state).toBe('boarded');
  });

  it('does not wait for dead members, and the dead cannot board', () => {
    const e = landed();
    expect(e.boardPlayer(1, door, false)).toBe(false);
    e.boardPlayer(0, door, true);
    expect(e.tryComplete([0])).toBe(true);
  });

  it('still supports solo boarding in one call', () => {
    const e = landed();
    expect(e.board(door, true)).toBe(true);
    expect(e.state).toBe('boarded');
  });
});

describe('squad roster', () => {
  it('caps the squad, and exposes members to zombies, spawner and mission', () => {
    const s = new Squad(new Player());
    for (let i = 0; i < COOP.maxSquad + 2; i++) s.addDummy(i, 0, 0, 0);
    expect(s.size).toBe(COOP.maxSquad);

    const dummy = s.members[1];
    applyDamage(dummy.player.vitals, 9999, true);
    s.members[2].boarded = true;
    const targets = s.targets(true);
    expect(targets.find((t) => t.id === dummy.id)?.alive).toBe(false); // dead
    expect(targets.find((t) => t.id === s.members[2].id)?.alive).toBe(false); // aboard
    expect(s.targets(false).every((t) => !t.alive)).toBe(true); // nobody is a target outside play
    expect(s.viewers().length).toBe(COOP.maxSquad - 2);
    expect(s.livingIds()).not.toContain(dummy.id);
  });

  it('keeps dummies standing where they were when a mission restarts', () => {
    const s = new Squad(new Player());
    const d = s.addDummy(3, 1.25, 4, 0.5)!;
    applyDamage(d.player.vitals, 9999, true);
    d.boarded = true;
    s.resetForMission();
    expect(d.player.vitals.alive).toBe(true);
    expect(d.boarded).toBe(false);
    expect(d.player.pos).toEqual({ x: 3, y: 1.25, z: 4 });
  });
});
