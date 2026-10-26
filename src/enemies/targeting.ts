// Player targeting for co-op: every zombie chases the nearest living player, with a little hysteresis
// so it doesn't flip-flop between two players standing side by side.

export interface PlayerTarget {
  id: number;
  x: number; y: number; z: number; eyeY: number; alive: boolean;
}

/** How much closer (m) another player must be before a zombie switches away from its current target. */
export const RETARGET_MARGIN = 2.5;

/** Placeholder used when nobody is alive: behaviour code treats it like a dead player. */
export function noTarget(x: number, y: number, z: number): PlayerTarget {
  return { id: -1, x, y, z, eyeY: y + 1.6, alive: false };
}

/** Nearest living player to (x, z); keeps `currentId` unless another is clearly closer. Null if none alive. */
export function pickTarget(x: number, z: number, targets: readonly PlayerTarget[], currentId: number, margin = RETARGET_MARGIN): PlayerTarget | null {
  let best: PlayerTarget | null = null;
  let bestD = Infinity;
  let current: PlayerTarget | null = null;
  let currentD = Infinity;
  for (const t of targets) {
    if (!t.alive) continue;
    const d = Math.hypot(t.x - x, t.z - z);
    if (d < bestD) { bestD = d; best = t; }
    if (t.id === currentId) { current = t; currentD = d; }
  }
  if (current && best && current !== best && currentD - bestD < margin) return current;
  return best;
}
