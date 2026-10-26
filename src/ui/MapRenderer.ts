// Minimap and tactical map, both drawn from the real level shapes and live world positions.
import { REGION_BOUNDS, WORLD } from '../config';
import type { Level, MapShape } from '../world/Level';

const PX = 3; // pixels per metre in the cached base map

export interface MapMarker {
  x: number; z: number;
  kind: 'crate' | 'buy' | 'upgrade' | 'contract' | 'contractDone' | 'lz' | 'lzLocked' | 'elite' | 'eliteArea' | 'zombie' | 'drop';
}

export interface MapState {
  px: number; pz: number; yaw: number;
  markers: MapMarker[];
  contamination: { x: number; z: number; r: number } | null;
  defenseRing: { x: number; z: number; r: number } | null;
}

const COLORS: Record<ShapeKindKey, string> = {
  road: '#2b3036', sidewalk: '#3a3f44', lot: '#2f3439', yard: '#35332c', compound: '#2c3330',
  building: '#6b7178', interior: '#8c949b', container: '#6f5a48', prop: '#575d63', wall: '#9aa0a6', fence: '#7d8a94',
};
type ShapeKindKey = MapShape['kind'];

export class MapRenderer {
  private base: HTMLCanvasElement;
  private w: number;
  private h: number;

  constructor(level: Level) {
    this.w = (WORLD.maxX - WORLD.minX) * PX;
    this.h = (WORLD.maxZ - WORLD.minZ) * PX;
    this.base = document.createElement('canvas');
    this.base.width = this.w;
    this.base.height = this.h;
    const ctx = this.base.getContext('2d')!;
    ctx.fillStyle = '#1a1014';
    ctx.fillRect(0, 0, this.w, this.h);
    // Region tint bands
    const band = (z0: number, z1: number, col: string) => {
      ctx.fillStyle = col;
      ctx.fillRect(0, this.toY(z0), this.w, this.toY(z1) - this.toY(z0));
    };
    band(WORLD.minZ, REGION_BOUNDS.mediumMinZ, 'rgba(224,40,60,0.22)');
    band(REGION_BOUNDS.mediumMinZ, REGION_BOUNDS.lowMinZ, 'rgba(163,50,74,0.18)');
    band(REGION_BOUNDS.lowMinZ, WORLD.maxZ, 'rgba(110,70,135,0.16)');
    const order: ShapeKindKey[] = ['compound', 'yard', 'lot', 'road', 'sidewalk', 'prop', 'container', 'fence', 'building', 'interior', 'wall'];
    const shapes = level.regionShapes();
    for (const k of order) {
      ctx.fillStyle = COLORS[k];
      for (const s of shapes) {
        if (s.kind !== k) continue;
        const x = this.toX(Math.min(s.x0, s.x1)), y = this.toY(Math.min(s.z0, s.z1));
        const w = Math.abs(s.x1 - s.x0) * PX, h = Math.abs(s.z1 - s.z0) * PX;
        ctx.fillRect(x, y, Math.max(1, w), Math.max(1, h));
        if (k === 'interior') {
          ctx.strokeStyle = '#c3cad0';
          ctx.lineWidth = 2;
          ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
        }
      }
    }
    // Region tint overlay on top of the shapes so threat zones read clearly.
    band(WORLD.minZ, REGION_BOUNDS.mediumMinZ, 'rgba(200,60,45,0.14)');
    band(REGION_BOUNDS.mediumMinZ, REGION_BOUNDS.lowMinZ, 'rgba(220,170,60,0.09)');
    band(REGION_BOUNDS.lowMinZ, WORLD.maxZ, 'rgba(120,190,100,0.08)');
    // Reactor landmark
    const r = level.poi.reactor;
    ctx.fillStyle = '#4a7a3a';
    ctx.beginPath();
    ctx.arc(this.toX(r.x), this.toY(r.z), 9 * PX, 0, Math.PI * 2);
    ctx.fill();
    // Region labels
    ctx.font = 'bold 22px "DIN Alternate","Arial Narrow",sans-serif';
    ctx.fillStyle = 'rgba(230,230,220,0.35)';
    ctx.textAlign = 'center';
    ctx.fillText('HALCYON COMPOUND', this.toX(0), this.toY(-100));
    ctx.fillText('KESSLER DEPOT', this.toX(-40), this.toY(-18.5) + 8);
    ctx.fillText('CHECKPOINT 7', this.toX(0), this.toY(96));
  }

  private toX(x: number): number { return (x - WORLD.minX) * PX; }
  private toY(z: number): number { return (z - WORLD.minZ) * PX; }

  /** Rotating minimap centred on the player (forward = up). */
  drawMini(ctx: CanvasRenderingContext2D, size: number, st: MapState, rangeM = 45): void {
    const scale = size / (rangeM * 2); // px per metre on screen
    ctx.save();
    ctx.clearRect(0, 0, size, size);
    ctx.beginPath();
    ctx.rect(0, 0, size, size);
    ctx.clip();
    ctx.fillStyle = '#12161a';
    ctx.fillRect(0, 0, size, size);
    ctx.translate(size / 2, size / 2);
    ctx.rotate(st.yaw);
    ctx.scale(scale / PX, scale / PX);
    ctx.translate(-this.toX(st.px), -this.toY(st.pz));
    ctx.globalAlpha = 0.95;
    ctx.drawImage(this.base, 0, 0);
    ctx.globalAlpha = 1;
    this.overlays(ctx, st, PX, 1 / (scale / PX));
    ctx.restore();
    // Player arrow (always up)
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.fillStyle = '#f4f1e6';
    ctx.beginPath();
    ctx.moveTo(0, -8); ctx.lineTo(6, 7); ctx.lineTo(0, 3); ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // North indicator on the rim
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(st.yaw);
    ctx.fillStyle = '#e0283c';
    ctx.font = 'bold 12px "DIN Alternate",sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', 0, -size / 2 + 13);
    ctx.restore();
  }

  /** Full tactical map, north up. */
  drawFull(ctx: CanvasRenderingContext2D, cw: number, ch: number, st: MapState): void {
    const s = Math.min(cw / this.w, ch / this.h) * 0.95;
    const ox = (cw - this.w * s) / 2, oy = (ch - this.h * s) / 2;
    ctx.clearRect(0, 0, cw, ch);
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(s, s);
    ctx.drawImage(this.base, 0, 0);
    this.overlays(ctx, st, PX, 1 / s, true);
    // Player
    ctx.translate(this.toX(st.px), this.toY(st.pz));
    ctx.rotate(-st.yaw);
    ctx.scale(1 / s, 1 / s);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -12); ctx.lineTo(9, 10); ctx.lineTo(0, 5); ctx.lineTo(-9, 10);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.restore();
  }

  private overlays(ctx: CanvasRenderingContext2D, st: MapState, px: number, inv: number, full = false): void {
    if (st.contamination) {
      const c = st.contamination;
      ctx.fillStyle = 'rgba(160,76,255,0.18)';
      ctx.strokeStyle = 'rgba(190,120,255,0.85)';
      ctx.lineWidth = 3 * inv;
      ctx.beginPath();
      ctx.arc(this.toX(c.x), this.toY(c.z), c.r * px, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (st.defenseRing) {
      const d = st.defenseRing;
      ctx.strokeStyle = 'rgba(255,170,60,0.9)';
      ctx.setLineDash([6 * inv, 5 * inv]);
      ctx.lineWidth = 2 * inv;
      ctx.beginPath();
      ctx.arc(this.toX(d.x), this.toY(d.z), d.r * px, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const k = inv; // keep icon sizes constant on screen
    for (const m of st.markers) {
      const x = this.toX(m.x), y = this.toY(m.z);
      ctx.save();
      ctx.translate(x, y);
      if (!full) ctx.rotate(-st.yaw);
      ctx.scale(k, k);
      drawIcon(ctx, m.kind, full);
      ctx.restore();
    }
  }
}

function drawIcon(ctx: CanvasRenderingContext2D, kind: MapMarker['kind'], full: boolean): void {
  const s = full ? 1.35 : 1;
  ctx.scale(s, s);
  ctx.lineWidth = 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  switch (kind) {
    case 'zombie':
      ctx.fillStyle = '#e0473a';
      ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
      break;
    case 'crate':
      ctx.fillStyle = '#e8b940'; ctx.fillRect(-4, -3, 8, 6);
      ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1; ctx.strokeRect(-4, -3, 8, 6);
      break;
    case 'drop':
      ctx.fillStyle = '#60c0ff'; ctx.fillRect(-3, -2, 6, 4);
      break;
    case 'buy':
    case 'upgrade':
      ctx.fillStyle = kind === 'buy' ? '#3ecf7a' : '#48a8ff';
      ctx.fillRect(-8, -8, 16, 16);
      ctx.fillStyle = '#0b0f10';
      ctx.font = 'bold 12px "DIN Alternate",sans-serif';
      ctx.fillText(kind === 'buy' ? '$' : 'U', 0, 1);
      break;
    case 'contract':
    case 'contractDone':
      ctx.fillStyle = kind === 'contract' ? '#ffb040' : '#7a7a70';
      ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(10, 0); ctx.lineTo(0, 10); ctx.lineTo(-10, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#111';
      ctx.font = 'bold 11px "DIN Alternate",sans-serif';
      ctx.fillText('D', 0, 1);
      break;
    case 'lz':
    case 'lzLocked':
      ctx.fillStyle = kind === 'lz' ? '#f5e9e0' : '#6a6a60';
      ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#111';
      ctx.font = 'bold 13px "DIN Alternate",sans-serif';
      ctx.fillText('H', 0, 1);
      break;
    case 'elite':
      ctx.fillStyle = '#ff3a2a';
      ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(9, 7); ctx.lineTo(-9, 7); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#111';
      ctx.font = 'bold 11px "DIN Alternate",sans-serif';
      ctx.fillText('!', 0, 2);
      break;
    case 'eliteArea':
      ctx.strokeStyle = 'rgba(255,70,50,0.9)';
      ctx.fillStyle = 'rgba(255,70,50,0.15)';
      ctx.beginPath(); ctx.arc(0, 0, full ? 40 : 30, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      break;
  }
}
