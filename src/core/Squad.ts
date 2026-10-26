// Co-op squad roster. Slot 0 is always the local player. Extra members are offline stand-ins
// ("dummies") until networking replaces them with remote players; the simulation treats both alike.
import * as THREE from 'three';
import { COOP } from '../config';
import type { SpawnViewer } from '../enemies/Spawner';
import type { PlayerTarget } from '../enemies/targeting';
import type { SquadPos } from '../mission/Mission';
import { Player } from '../player/Player';

export type MemberKind = 'local' | 'dummy';

export interface SquadMember {
  id: number;
  kind: MemberKind;
  name: string;
  player: Player;
  /** Placeholder body for non-local members (the survivor model arrives with co-op proper). */
  body: THREE.Object3D | null;
  boarded: boolean;
}

const DUMMY_COLORS = [0x9b6bb3, 0xe0283c, 0xd8cdbd];

export class Squad {
  readonly members: SquadMember[] = [];
  readonly group = new THREE.Group();
  private nextId = 1;

  constructor(local: Player) {
    this.members.push({ id: 0, kind: 'local', name: 'YOU', player: local, body: null, boarded: false });
  }

  get local(): SquadMember {
    return this.members[0];
  }

  get size(): number {
    return this.members.length;
  }

  get(id: number): SquadMember | undefined {
    return this.members.find((m) => m.id === id);
  }

  /** Adds an offline stand-in player at (x, y, z). Returns null when the squad is full. */
  addDummy(x: number, y: number, z: number, yaw = 0): SquadMember | null {
    if (this.members.length >= COOP.maxSquad) return null;
    const id = this.nextId++;
    const player = new Player();
    player.reset(x, z, yaw);
    player.pos.y = y;
    const body = buildDummyBody(DUMMY_COLORS[(id - 1) % DUMMY_COLORS.length]);
    this.group.add(body);
    const m: SquadMember = { id, kind: 'dummy', name: `DUMMY ${id}`, player, body, boarded: false };
    this.members.push(m);
    this.syncBodies();
    return m;
  }

  removeDummies(): void {
    for (const m of this.members) if (m.body) this.group.remove(m.body);
    this.members.length = 1;
    this.local.boarded = false;
    this.nextId = 1;
  }

  /** Clears per-mission state; dummies are kept but revived at their current spot. */
  resetForMission(): void {
    for (const m of this.members) {
      m.boarded = false;
      if (m.kind === 'dummy') {
        const p = m.player, y = p.pos.y;
        p.reset(p.pos.x, p.pos.z, p.yaw);
        p.pos.y = y;
      }
    }
    this.syncBodies();
  }

  /** Members still in play: alive and not yet aboard the helicopter. */
  living(): SquadMember[] {
    return this.members.filter((m) => m.player.vitals.alive && !m.boarded);
  }

  /** Zombie targets. `active` is false while the game isn't simulating play (menus, death cam). */
  targets(active: boolean): PlayerTarget[] {
    return this.members.map((m) => {
      const p = m.player;
      return { id: m.id, x: p.pos.x, y: p.pos.y, z: p.pos.z, eyeY: p.eyeY, alive: active && p.vitals.alive && !m.boarded };
    });
  }

  /** Spawner viewers: living members with their facing on the ground plane. */
  viewers(): SpawnViewer[] {
    return this.living().map((m) => {
      const p = m.player;
      return { x: p.pos.x, z: p.pos.z, eyeY: p.eyeY, fx: -Math.sin(p.yaw), fz: -Math.cos(p.yaw) };
    });
  }

  positions(): SquadPos[] {
    return this.members.map((m) => ({ x: m.player.pos.x, z: m.player.pos.z, alive: m.player.vitals.alive && !m.boarded }));
  }

  livingIds(): number[] {
    return this.members.filter((m) => m.player.vitals.alive).map((m) => m.id);
  }

  /** Moves placeholder bodies to their players; the dead lie down, the boarded disappear. */
  syncBodies(): void {
    for (const m of this.members) {
      if (!m.body) continue;
      const p = m.player;
      m.body.visible = !m.boarded;
      m.body.position.set(p.pos.x, p.pos.y, p.pos.z);
      m.body.rotation.set(p.vitals.alive ? 0 : Math.PI / 2, p.yaw, 0, 'YXZ');
    }
  }
}

function buildDummyBody(color: number): THREE.Object3D {
  const g = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: 0x2a2228, roughness: 0.8 });
  const band = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.9, 4, 10), suit);
  torso.position.y = 0.9;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), suit);
  head.position.y = 1.62;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.05), band);
  visor.position.set(0, 1.64, -0.13); // players face -Z at yaw 0
  const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.025, 6, 20), band);
  stripe.rotation.x = Math.PI / 2;
  stripe.position.y = 1.15;
  for (const o of [torso, head, visor, stripe]) { o.castShadow = true; g.add(o); }
  return g;
}
