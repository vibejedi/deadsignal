// Height-aware navigation grid with a shared flow field toward the player.
// One Dijkstra pass serves the entire horde, so per-zombie pathfinding cost is O(1).
import type { CollisionWorld } from './Collision';

const CLIMB = 0.5; // max height difference between neighbouring cells
const AGENT_R = 0.32;

export class NavGrid {
  readonly w: number;
  readonly h: number;
  readonly size = 1;
  readonly height: Float32Array;
  readonly walk: Uint8Array;
  readonly dist: Float32Array;
  private heap: Int32Array;
  private heapKey: Float32Array;
  private heapLen = 0;
  targetCell = -1;

  constructor(public ox: number, public oz: number, maxX: number, maxZ: number) {
    this.w = Math.ceil(maxX - ox);
    this.h = Math.ceil(maxZ - oz);
    const n = this.w * this.h;
    this.height = new Float32Array(n);
    this.walk = new Uint8Array(n);
    this.dist = new Float32Array(n).fill(Infinity);
    this.heap = new Int32Array(n * 8);
    this.heapKey = new Float32Array(n * 8);
  }

  build(world: CollisionWorld): void {
    for (let r = 0; r < this.h; r++) {
      for (let c = 0; c < this.w; c++) {
        const i = r * this.w + c;
        const cx = this.ox + c + 0.5, cz = this.oz + r + 0.5;
        // Floor = highest walkable top containing the cell centre.
        let floor = 0;
        const list = world.query(cx - AGENT_R, cz - AGENT_R, cx + AGENT_R, cz + AGENT_R);
        for (const b of list) {
          if (b.floor && b.maxY <= 3 && cx >= b.minX && cx <= b.maxX && cz >= b.minZ && cz <= b.maxZ) floor = Math.max(floor, b.maxY);
        }
        let blocked = false;
        for (const b of list) {
          if (b.floor && b.maxY <= floor + 0.01) continue;
          // Obstacle intersecting body volume above the floor (small steps are allowed).
          if (b.maxY > floor + 0.46 && b.minY < floor + 1.7) { blocked = true; break; }
        }
        this.height[i] = floor;
        this.walk[i] = blocked ? 0 : 1;
      }
    }
    // Out-of-bounds edge ring is never walkable.
    for (let c = 0; c < this.w; c++) { this.walk[c] = 0; this.walk[(this.h - 1) * this.w + c] = 0; }
    for (let r = 0; r < this.h; r++) { this.walk[r * this.w] = 0; this.walk[r * this.w + this.w - 1] = 0; }
  }

  cellOf(x: number, z: number): number {
    const c = Math.floor(x - this.ox), r = Math.floor(z - this.oz);
    if (c < 0 || r < 0 || c >= this.w || r >= this.h) return -1;
    return r * this.w + c;
  }

  cellCenter(i: number, out: { x: number; z: number }): void {
    out.x = this.ox + (i % this.w) + 0.5;
    out.z = this.oz + Math.floor(i / this.w) + 0.5;
  }

  isWalkable(x: number, z: number): boolean {
    const i = this.cellOf(x, z);
    return i >= 0 && this.walk[i] === 1;
  }

  /** Finds the closest walkable cell to a position (e.g. player standing on a crate). */
  nearestWalkable(x: number, z: number, maxR = 6): number {
    const c0 = Math.floor(x - this.ox), r0 = Math.floor(z - this.oz);
    for (let rad = 0; rad <= maxR; rad++) {
      let best = -1, bestD = Infinity;
      for (let dr = -rad; dr <= rad; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
          const c = c0 + dc, r = r0 + dr;
          if (c < 0 || r < 0 || c >= this.w || r >= this.h) continue;
          const i = r * this.w + c;
          if (!this.walk[i]) continue;
          const d = dc * dc + dr * dr;
          if (d < bestD) { bestD = d; best = i; }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /** Dijkstra from the target outward over walkable cells (8-connected, no corner cutting). */
  computeFlow(tx: number, tz: number): void {
    this.computeFlowMulti([{ x: tx, z: tz }]);
  }

  /**
   * Multi-source Dijkstra: every target cell starts at distance 0, so `dist` becomes the path distance
   * to the nearest target and the flow field leads each agent toward whichever target is closest.
   */
  computeFlowMulti(targets: readonly { x: number; z: number }[]): void {
    this.dist.fill(Infinity);
    this.heapLen = 0;
    this.targetCell = -1;
    for (const t of targets) {
      let target = this.cellOf(t.x, t.z);
      if (target < 0 || !this.walk[target]) target = this.nearestWalkable(t.x, t.z);
      if (target < 0 || this.dist[target] === 0) continue;
      if (this.targetCell < 0) this.targetCell = target;
      this.dist[target] = 0;
      this.push(target, 0);
    }
    if (this.heapLen === 0) return;
    const w = this.w;
    while (this.heapLen > 0) {
      const key = this.heapKey[0];
      const i = this.pop();
      if (key > this.dist[i]) continue;
      const c = i % w, r = (i - c) / w;
      const hi = this.height[i];
      for (let k = 0; k < 8; k++) {
        const dc = DC[k], dr = DR[k];
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= w || nr >= this.h) continue;
        const j = nr * w + nc;
        if (!this.walk[j] || Math.abs(this.height[j] - hi) > CLIMB) continue;
        if (dc !== 0 && dr !== 0) {
          // No diagonal squeezing past corners.
          if (!this.walk[r * w + nc] || !this.walk[nr * w + c]) continue;
        }
        const nd = key + COST[k];
        if (nd < this.dist[j]) {
          this.dist[j] = nd;
          this.push(j, nd);
        }
      }
    }
  }

  /** Direction (unit XZ) along the flow field from a world position. Returns false if unreachable. */
  flowDir(x: number, z: number, out: { x: number; z: number }): boolean {
    let i = this.cellOf(x, z);
    if (i < 0) return false;
    if (!isFinite(this.dist[i])) {
      // Agent slightly overlapping a blocked cell - use the best adjacent cell.
      const n = this.nearestWalkable(x, z, 2);
      if (n < 0 || !isFinite(this.dist[n])) return false;
      i = n;
      const cc = { x: 0, z: 0 };
      this.cellCenter(i, cc);
      const dx = cc.x - x, dz = cc.z - z;
      const l = Math.hypot(dx, dz) || 1;
      out.x = dx / l; out.z = dz / l;
      return true;
    }
    const w = this.w;
    const c = i % w, r = (i - c) / w;
    let best = this.dist[i], bi = -1;
    for (let k = 0; k < 8; k++) {
      const nc = c + DC[k], nr = r + DR[k];
      if (nc < 0 || nr < 0 || nc >= w || nr >= this.h) continue;
      const j = nr * w + nc;
      if (DC[k] !== 0 && DR[k] !== 0 && (!this.walk[r * w + nc] || !this.walk[nr * w + c])) continue;
      if (this.dist[j] < best) { best = this.dist[j]; bi = j; }
    }
    if (bi < 0) return false;
    const tx = this.ox + (bi % w) + 0.5, tz = this.oz + Math.floor(bi / w) + 0.5;
    const dx = tx - x, dz = tz - z;
    const l = Math.hypot(dx, dz) || 1;
    out.x = dx / l;
    out.z = dz / l;
    return true;
  }

  pathDist(x: number, z: number): number {
    const i = this.cellOf(x, z);
    return i < 0 ? Infinity : this.dist[i];
  }

  /** Grid line-of-walk: can an agent walk straight between two points? */
  walkLine(ax: number, az: number, bx: number, bz: number): boolean {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    const n = Math.ceil(len / 0.5);
    let prevH = -1;
    for (let s = 0; s <= n; s++) {
      const t = n === 0 ? 0 : s / n;
      const i = this.cellOf(ax + dx * t, az + dz * t);
      if (i < 0 || !this.walk[i]) return false;
      const h = this.height[i];
      if (prevH >= 0 && Math.abs(h - prevH) > CLIMB) return false;
      prevH = h;
    }
    return true;
  }

  private push(i: number, key: number): void {
    let n = this.heapLen++;
    const heap = this.heap, keys = this.heapKey;
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (keys[p] <= key) break;
      heap[n] = heap[p]; keys[n] = keys[p];
      n = p;
    }
    heap[n] = i; keys[n] = key;
  }

  private pop(): number {
    const heap = this.heap, keys = this.heapKey;
    const top = heap[0];
    const last = --this.heapLen;
    if (last > 0) {
      const li = heap[last], lk = keys[last];
      let n = 0;
      for (;;) {
        let ch = n * 2 + 1;
        if (ch >= last) break;
        if (ch + 1 < last && keys[ch + 1] < keys[ch]) ch++;
        if (keys[ch] >= lk) break;
        heap[n] = heap[ch]; keys[n] = keys[ch];
        n = ch;
      }
      heap[n] = li; keys[n] = lk;
    }
    return top;
  }
}

const DC = [1, -1, 0, 0, 1, 1, -1, -1];
const DR = [0, 0, 1, -1, 1, -1, 1, -1];
const COST = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
