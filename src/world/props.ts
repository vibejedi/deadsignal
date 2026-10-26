// Prop templates built from primitives and merged per material. Placed via instancing.
import * as THREE from 'three';
import { PropTemplate } from '../render/geom';
import type { Materials } from '../render/materials';
import type { Surface } from './Collision';

export type ColliderSpec = 'bounds' | 'none' | [number, number, number, number, number, number][];

export interface PropDef {
  tpl: PropTemplate;
  colliders: ColliderSpec;
  surface: Surface;
  solid?: boolean;
  floor?: boolean;
}

export type PropName =
  | 'sedan0' | 'sedan1' | 'sedan2' | 'sedan3' | 'sedanBurnt' | 'truck' | 'humvee' | 'van'
  | 'container0' | 'container1' | 'container2' | 'container3' | 'container4' | 'container5'
  | 'jersey' | 'sandbags' | 'barrel' | 'hazBarrel' | 'crate' | 'crateSmall' | 'pallets' | 'streetlight'
  | 'trash' | 'dumpster' | 'tent' | 'rubble' | 'rubbleBig' | 'floodlight' | 'generator' | 'spool' | 'cone'
  | 'acUnit' | 'pole' | 'rack' | 'forklift' | 'deconTent' | 'bench' | 'labTable' | 'tube' | 'locker' | 'shelf' | 'counter'
  | 'barrier' | 'hedgehog' | 'fencePanel' | 'pipeRack' | 'desk';

export function buildProps(M: Materials): Record<PropName, PropDef> {
  const P = {} as Record<PropName, PropDef>;
  const def = (name: PropName, tpl: PropTemplate, colliders: ColliderSpec, surface: Surface, extra: Partial<PropDef> = {}) => {
    P[name] = { tpl: tpl.finish(), colliders, surface, ...extra };
  };

  // --- Sedans ---------------------------------------------------------------------------------
  const sedan = (paint: THREE.Material, burnt = false) => {
    const t = new PropTemplate();
    const body = burnt ? M.burnt : paint;
    t.box(body, 1.82, 0.62, 4.5, 0, 0.62, 0); // lower body
    t.box(body, 1.7, 0.1, 1.2, 0, 0.98, 1.5); // hood
    t.box(body, 1.72, 0.12, 0.9, 0, 0.96, -1.75); // trunk lid
    t.add(body, new THREE.BoxGeometry(1.62, 0.55, 2.2), 0, 1.2, -0.25);
    if (!burnt) {
      t.box(M.glass, 1.64, 0.42, 0.06, 0, 1.2, 0.87, -0.5); // windscreen
      t.box(M.glass, 1.64, 0.4, 0.06, 0, 1.2, -1.37, 0.5);
      t.box(M.glass, 1.64, 0.36, 1.9, 0, 1.22, -0.25); // side glass slab (slightly inset)
      t.box(M.lampWarm, 0.3, 0.1, 0.04, 0.62, 0.78, 2.25);
      t.box(M.lampWarm, 0.3, 0.1, 0.04, -0.62, 0.78, 2.25);
      t.box(M.red, 0.34, 0.1, 0.04, 0.62, 0.8, -2.25);
      t.box(M.red, 0.34, 0.1, 0.04, -0.62, 0.8, -2.25);
    } else {
      t.box(M.rust, 1.5, 0.05, 1.8, 0, 0.9, -0.25);
    }
    t.box(M.rubber, 1.86, 0.16, 0.18, 0, 0.42, 2.28);
    t.box(M.rubber, 1.86, 0.16, 0.18, 0, 0.42, -2.28);
    for (const [x, z] of [[0.82, 1.4], [-0.82, 1.4], [0.82, -1.45], [-0.82, -1.45]]) {
      t.cyl(M.rubber, 0.34, 0.34, 0.24, 14, x, 0.34, z, 0, 0, Math.PI / 2);
      t.cyl(burnt ? M.rust : M.steel, 0.2, 0.2, 0.26, 10, x, 0.34, z, 0, 0, Math.PI / 2);
    }
    return t;
  };
  const sedanCol: ColliderSpec = [[-0.92, 0, -2.3, 0.92, 0.95, 2.3], [-0.82, 0.95, -1.4, 0.82, 1.48, 0.9]];
  M.carPaints.slice(0, 4).forEach((p, i) => def(`sedan${i}` as PropName, sedan(p), sedanCol, 'metal'));
  def('sedanBurnt', sedan(M.burnt, true), sedanCol, 'metal');

  // --- Van -----------------------------------------------------------------------------------
  {
    const t = new PropTemplate();
    t.box(M.white, 2.0, 1.9, 5.0, 0, 1.35, -0.2);
    t.box(M.white, 1.95, 1.0, 1.0, 0, 0.9, 2.55);
    t.box(M.glass, 1.8, 0.7, 0.06, 0, 1.75, 2.26, -0.35);
    t.box(M.red, 2.02, 0.25, 3.6, 0, 1.6, -0.6);
    t.box(M.rubber, 2.04, 0.2, 0.2, 0, 0.45, 3.05);
    for (const [x, z] of [[0.9, 1.9], [-0.9, 1.9], [0.9, -1.8], [-0.9, -1.8]]) t.cyl(M.rubber, 0.38, 0.38, 0.26, 14, x, 0.38, z, 0, 0, Math.PI / 2);
    def('van', t, [[-1.02, 0, -2.75, 1.02, 2.3, 3.1]], 'metal');
  }

  // --- Military truck --------------------------------------------------------------------------
  {
    const t = new PropTemplate();
    t.box(M.oliveDark, 2.3, 0.35, 7.2, 0, 0.95, 0); // chassis
    t.box(M.olive, 2.35, 1.5, 1.9, 0, 1.85, 2.55); // cab
    t.box(M.olive, 2.2, 0.8, 1.2, 0, 1.4, 3.9); // hood
    t.box(M.glass, 2.0, 0.6, 0.06, 0, 2.25, 3.52);
    t.box(M.olive, 2.4, 0.6, 4.7, 0, 1.45, -1.2); // bed
    t.box(M.tarp, 2.45, 1.6, 4.6, 0, 2.55, -1.2); // canopy
    for (let i = 0; i < 4; i++) t.box(M.oliveDark, 2.5, 0.08, 0.1, 0, 3.36, -3.3 + i * 1.4);
    t.box(M.metalDark, 2.4, 0.3, 0.2, 0, 1.0, 4.52);
    t.box(M.lampCold, 0.25, 0.2, 0.05, 0.85, 1.55, 4.52);
    t.box(M.lampCold, 0.25, 0.2, 0.05, -0.85, 1.55, 4.52);
    for (const z of [3.1, -1.0, -2.5]) for (const x of [1.05, -1.05]) {
      t.cyl(M.rubber, 0.55, 0.55, 0.42, 16, x, 0.55, z, 0, 0, Math.PI / 2);
      t.cyl(M.oliveDark, 0.28, 0.28, 0.44, 10, x, 0.55, z, 0, 0, Math.PI / 2);
    }
    def('truck', t, [[-1.25, 0, -3.6, 1.25, 3.4, 3.5], [-1.15, 0, 3.5, 1.15, 1.9, 4.6]], 'metal');
  }

  // --- Humvee-style light vehicle --------------------------------------------------------------
  {
    const t = new PropTemplate();
    t.box(M.olive, 2.2, 0.9, 4.7, 0, 0.95, 0);
    t.box(M.olive, 2.0, 0.75, 2.3, 0, 1.75, -0.4);
    t.box(M.glass, 1.8, 0.5, 0.06, 0, 1.8, 0.76, -0.2);
    t.box(M.oliveDark, 2.1, 0.12, 1.6, 0, 1.44, 1.5);
    t.cyl(M.oliveDark, 0.35, 0.45, 0.4, 10, 0, 2.3, -0.6); // turret ring
    t.box(M.metalDark, 0.12, 0.12, 1.1, 0, 2.55, -0.1); // gun barrel
    t.box(M.metalDark, 1.0, 0.5, 0.08, 0, 2.6, -0.5); // gun shield
    for (const [x, z] of [[1.0, 1.5], [-1.0, 1.5], [1.0, -1.5], [-1.0, -1.5]]) t.cyl(M.rubber, 0.46, 0.46, 0.38, 14, x, 0.46, z, 0, 0, Math.PI / 2);
    def('humvee', t, [[-1.18, 0, -2.4, 1.18, 2.15, 2.4]], 'metal');
  }

  // --- Shipping containers (6.1 x 2.6 x 2.44), length along Z ------------------------------------
  M.containers.forEach((mat, i) => {
    const t = new PropTemplate();
    t.add(mat, new THREE.BoxGeometry(2.44, 2.59, 6.06), 0, 1.295, 0);
    // Corner posts / rails
    for (const x of [-1.2, 1.2]) for (const z of [-3.0, 3.0]) t.box(M.metalDark, 0.14, 2.6, 0.14, x, 1.3, z);
    for (const y of [0.05, 2.55]) for (const x of [-1.2, 1.2]) t.box(M.metalDark, 0.12, 0.12, 6.1, x, y, 0);
    // Door end detail
    t.box(M.metalDark, 0.05, 2.3, 0.05, 0.4, 1.3, 3.05);
    t.box(M.metalDark, 0.05, 2.3, 0.05, -0.4, 1.3, 3.05);
    t.box(M.steel, 0.9, 0.06, 0.06, 0, 1.3, 3.06);
    def(`container${i}` as PropName, t, [[-1.22, 0, -3.05, 1.22, 2.6, 3.05]], 'metal');
  });

  // --- Jersey barrier (length along X) --------------------------------------------------------
  {
    const t = new PropTemplate();
    t.box(M.concrete, 3.0, 0.3, 0.62, 0, 0.15, 0);
    t.box(M.concrete, 3.0, 0.45, 0.42, 0, 0.52, 0);
    t.box(M.concrete, 3.0, 0.3, 0.24, 0, 0.9, 0);
    t.box(M.hazardYellow, 3.02, 0.08, 0.26, 0, 0.98, 0);
    def('jersey', t, [[-1.5, 0, -0.31, 1.5, 1.05, 0.31]], 'concrete');
  }
  // --- Concrete barrier block ----------------------------------------------------------------
  {
    const t = new PropTemplate();
    t.box(M.concreteDark, 2.0, 1.2, 1.0, 0, 0.6, 0);
    t.box(M.hazardStripe, 2.02, 0.2, 1.02, 0, 0.9, 0);
    def('barrier', t, 'bounds', 'concrete');
  }

  // --- Sandbag wall segment (2m along X, 1m tall) ----------------------------------------------
  {
    const t = new PropTemplate();
    for (let row = 0; row < 4; row++) {
      const off = row % 2 ? 0.25 : 0;
      for (let i = 0; i < 4; i++) {
        const x = -0.75 + i * 0.5 + off;
        if (x > 0.9) continue;
        t.add(M.sandbag, new THREE.CapsuleGeometry(0.13, 0.26, 3, 8), x, 0.14 + row * 0.24, 0, 0, 0, Math.PI / 2, 1, 1, 1.9);
      }
    }
    def('sandbags', t, [[-1.0, 0, -0.3, 1.0, 1.0, 0.3]], 'dirt');
  }

  // --- Barrels ------------------------------------------------------------------------------
  {
    const t = new PropTemplate();
    t.cyl(M.rust, 0.3, 0.3, 0.9, 14, 0, 0.45, 0);
    t.cyl(M.metalDark, 0.31, 0.31, 0.04, 14, 0, 0.3, 0);
    t.cyl(M.metalDark, 0.31, 0.31, 0.04, 14, 0, 0.62, 0);
    def('barrel', t, [[-0.3, 0, -0.3, 0.3, 0.9, 0.3]], 'metal');
    const h = new PropTemplate();
    h.cyl(M.hazardYellow, 0.3, 0.3, 0.9, 14, 0, 0.45, 0);
    h.cyl(M.hazardStripe, 0.305, 0.305, 0.12, 14, 0, 0.55, 0);
    h.cyl(M.toxicGlow, 0.22, 0.22, 0.02, 10, 0, 0.91, 0);
    def('hazBarrel', h, [[-0.3, 0, -0.3, 0.3, 0.92, 0.3]], 'metal');
  }

  // --- Crates / pallets ---------------------------------------------------------------------
  {
    const t = new PropTemplate();
    t.box(M.wood, 1.2, 1.0, 1.2, 0, 0.5, 0);
    for (const s of [-1, 1]) {
      t.box(M.oliveDark, 1.22, 0.1, 0.1, 0, 0.5, s * 0.6);
      t.box(M.oliveDark, 0.1, 0.1, 1.22, s * 0.6, 0.5, 0);
    }
    def('crate', t, 'bounds', 'wood');
    const s2 = new PropTemplate();
    s2.box(M.olive, 0.9, 0.5, 0.6, 0, 0.25, 0);
    s2.box(M.oliveDark, 0.92, 0.06, 0.62, 0, 0.45, 0);
    def('crateSmall', s2, 'bounds', 'metal');
    const p = new PropTemplate();
    p.box(M.wood, 1.2, 0.14, 1.0, 0, 0.07, 0);
    p.box(M.tarp, 1.1, 0.9, 0.9, 0, 0.6, 0);
    p.box(M.wood, 1.2, 0.14, 1.0, 0, 1.12, 0);
    p.box(M.plaster, 1.0, 0.6, 0.8, 0, 1.5, 0);
    def('pallets', p, 'bounds', 'wood');
  }

  // --- Streetlight (pole at origin, arm toward +Z) --------------------------------------------
  {
    const t = new PropTemplate();
    t.cyl(M.metalDark, 0.09, 0.13, 7.2, 8, 0, 3.6, 0);
    t.cyl(M.metalDark, 0.2, 0.25, 0.5, 8, 0, 0.25, 0);
    t.box(M.metalDark, 0.1, 0.1, 1.8, 0, 7.1, 0.85);
    t.box(M.metalDark, 0.35, 0.16, 0.7, 0, 7.05, 1.75);
    t.box(M.lampWarm, 0.28, 0.04, 0.6, 0, 6.96, 1.75);
    def('streetlight', t, [[-0.18, 0, -0.18, 0.18, 7.2, 0.18]], 'metal');
  }
  // --- Utility pole ----------------------------------------------------------------------------
  {
    const t = new PropTemplate();
    t.cyl(M.wood, 0.14, 0.18, 9.5, 8, 0, 4.75, 0);
    t.box(M.wood, 2.2, 0.14, 0.14, 0, 8.8, 0);
    t.cyl(M.metalDark, 0.25, 0.25, 0.7, 8, 0.4, 7.8, 0.2);
    def('pole', t, [[-0.2, 0, -0.2, 0.2, 9.5, 0.2]], 'wood');
  }

  // --- Trash / dumpster ------------------------------------------------------------------------
  {
    const t = new PropTemplate();
    const bag = new THREE.IcosahedronGeometry(0.35, 1);
    t.add(M.rubber, bag, 0, 0.3, 0, 0, 0, 0, 1, 0.8, 1);
    t.add(M.rubber, bag, 0.5, 0.25, 0.2, 0, 1, 0, 0.9, 0.7, 1);
    t.add(M.rubber, bag, 0.15, 0.25, -0.45, 0, 2, 0, 0.8, 0.7, 0.9);
    t.castShadow = true;
    def('trash', t, 'none', 'dirt');
    const d = new PropTemplate();
    d.box(M.corrugatedGreen, 1.9, 1.3, 1.2, 0, 0.75, 0);
    d.box(M.metalDark, 2.0, 0.1, 1.3, 0, 1.45, 0.05, 0.12);
    for (const x of [-0.8, 0.8]) for (const z of [-0.45, 0.45]) d.cyl(M.rubber, 0.08, 0.08, 0.12, 8, x, 0.08, z, 0, 0, Math.PI / 2);
    def('dumpster', d, [[-0.95, 0, -0.6, 0.95, 1.5, 0.6]], 'metal');
  }

  // --- Military tent (length along Z) ---------------------------------------------------------
  {
    const t = new PropTemplate();
    const prism = new THREE.CylinderGeometry(2.6, 2.6, 6, 3, 1);
    t.add(M.tarp, prism, 0, 1.3, 0, Math.PI / 2, 0, 0, 1, 1, 1);
    t.box(M.oliveDark, 0.08, 2.5, 0.08, 0, 1.25, 3.0);
    def('tent', t, [[-2.2, 0, -3, 2.2, 2.4, 3]], 'dirt');
    const d = new PropTemplate();
    d.add(M.white, new THREE.CylinderGeometry(2.3, 2.3, 5, 3, 1), 0, 1.15, 0, Math.PI / 2, 0, 0);
    d.box(M.hazardYellow, 0.1, 0.4, 5.02, 0, 2.1, 0);
    def('deconTent', d, [[-2.0, 0, -2.5, 2.0, 2.3, 2.5]], 'dirt');
  }

  // --- Rubble -------------------------------------------------------------------------------
  {
    const t = new PropTemplate();
    const rg = new THREE.DodecahedronGeometry(1, 0);
    t.add(M.concreteDark, rg, 0, 0.35, 0, 0.3, 0.5, 0.1, 1.4, 0.55, 1.1);
    t.add(M.concrete, rg, 0.9, 0.25, 0.5, 0.8, 1, 0.3, 0.8, 0.45, 0.7);
    t.add(M.brickDark, rg, -0.8, 0.2, -0.4, 0.1, 2, 0.6, 0.7, 0.35, 0.8);
    t.box(M.steel, 0.05, 0.05, 2.2, 0.3, 0.6, 0.2, 0.3, 0.6, 0.2);
    def('rubble', t, [[-1.4, 0, -1.1, 1.5, 0.75, 1.1]], 'concrete');
    const b = new PropTemplate();
    b.add(M.concreteDark, rg, 0, 1.2, 0, 0.3, 0.2, 0.1, 3.6, 1.6, 2.6);
    b.add(M.concrete, rg, 2.4, 0.8, 1.0, 0.8, 1, 0.3, 2.0, 1.2, 1.8);
    b.add(M.brickDark, rg, -2.2, 0.9, -0.8, 0.1, 2, 0.6, 2.2, 1.3, 1.6);
    b.add(M.concrete, new THREE.BoxGeometry(4, 0.4, 2.4), 0.5, 2.2, 0.3, 0.2, 0.4, 0.35);
    b.box(M.steel, 0.06, 0.06, 4.2, 1.0, 2.0, 0.3, 0.3, 0.6, 0.2);
    b.box(M.steel, 0.06, 0.06, 3.6, -0.6, 2.3, -0.2, 0.5, -0.4, 0.1);
    def('rubbleBig', b, [[-3.8, 0, -2.4, 4.2, 2.6, 2.6]], 'concrete');
  }

  // --- Floodlight tower (generator base) --------------------------------------------------------
  {
    const t = new PropTemplate();
    t.box(M.hazardYellow, 1.4, 0.9, 2.2, 0, 0.65, 0);
    for (const x of [-0.6, 0.6]) t.cyl(M.rubber, 0.3, 0.3, 0.2, 10, x, 0.3, 0.6, 0, 0, Math.PI / 2);
    t.cyl(M.metalDark, 0.07, 0.09, 6.2, 8, 0, 4.1, -0.6);
    t.box(M.metalDark, 1.8, 0.1, 0.1, 0, 7.1, -0.6);
    for (const x of [-0.65, 0, 0.65]) {
      t.box(M.metalDark, 0.5, 0.45, 0.25, x, 7.35, -0.5, -0.4);
      t.box(M.lampCold, 0.42, 0.36, 0.02, x, 7.3, -0.36, -0.4);
    }
    def('floodlight', t, [[-0.7, 0, -1.1, 0.7, 1.1, 1.1], [-0.12, 0, -0.72, 0.12, 7.2, -0.48]], 'metal');
  }
  {
    const t = new PropTemplate();
    t.box(M.olive, 1.8, 1.2, 1.1, 0, 0.7, 0);
    t.box(M.metalDark, 1.84, 0.12, 1.14, 0, 1.32, 0);
    t.box(M.metalDark, 0.5, 0.5, 0.02, 0.4, 0.8, 0.56);
    t.cyl(M.metalDark, 0.05, 0.05, 0.5, 6, -0.6, 1.6, 0.2);
    t.box(M.screenAmber, 0.2, 0.1, 0.02, -0.3, 0.95, 0.56);
    def('generator', t, 'bounds', 'metal');
  }
  {
    const t = new PropTemplate();
    t.cyl(M.wood, 0.7, 0.7, 0.1, 16, 0, 0.7, 0.45, Math.PI / 2);
    t.cyl(M.wood, 0.7, 0.7, 0.1, 16, 0, 0.7, -0.45, Math.PI / 2);
    t.cyl(M.rubber, 0.45, 0.45, 0.8, 16, 0, 0.7, 0, Math.PI / 2);
    def('spool', t, [[-0.7, 0, -0.5, 0.7, 1.4, 0.5]], 'wood');
  }
  {
    const t = new PropTemplate();
    t.cyl(new THREE.MeshStandardMaterial({ color: 0xd2561c, roughness: 0.7 }), 0.03, 0.17, 0.7, 10, 0, 0.35, 0);
    t.box(M.rubber, 0.4, 0.04, 0.4, 0, 0.02, 0);
    t.castShadow = false;
    def('cone', t, 'none', 'dirt');
  }
  {
    const t = new PropTemplate();
    t.box(M.metal, 1.1, 0.8, 0.7, 0, 0.4, 0);
    t.cyl(M.metalDark, 0.3, 0.3, 0.05, 14, 0, 0.4, 0.36, Math.PI / 2);
    def('acUnit', t, 'bounds', 'metal');
  }

  // --- Warehouse pallet rack (length along X, 1.2 deep) -----------------------------------------
  {
    const t = new PropTemplate();
    const L = 8;
    for (let i = 0; i <= 4; i++) for (const z of [-0.55, 0.55]) t.box(M.hazardYellow, 0.1, 4.6, 0.1, -L / 2 + i * 2, 2.3, z);
    for (const y of [0.15, 1.6, 3.1, 4.5]) for (const z of [-0.55, 0.55]) t.box(M.red, L, 0.12, 0.08, 0, y, z);
    for (const y of [0.25, 1.7, 3.2]) {
      for (let i = 0; i < 4; i++) {
        const x = -L / 2 + 1 + i * 2;
        t.box(M.wood, 1.6, 0.12, 1.0, x, y, 0);
        if ((i + y * 3) % 3 < 2) t.box(i % 2 ? M.plaster : M.tarp, 1.4, 1.0, 0.9, x, y + 0.56, 0);
      }
    }
    def('rack', t, [[-L / 2 - 0.05, 0, -0.6, L / 2 + 0.05, 4.6, 0.6]], 'metal');
  }
  {
    const t = new PropTemplate();
    t.box(M.hazardYellow, 1.2, 1.1, 2.2, 0, 0.75, 0);
    t.box(M.metalDark, 1.1, 0.1, 1.1, 0, 2.3, -0.2);
    for (const x of [-0.5, 0.5]) t.box(M.metalDark, 0.08, 1.9, 0.08, x, 1.3, 0.4);
    for (const x of [-0.3, 0.3]) t.box(M.metalDark, 0.12, 2.6, 0.12, x, 1.3, 1.15);
    for (const x of [-0.3, 0.3]) t.box(M.steel, 0.12, 0.05, 1.1, x, 0.1, 1.8);
    for (const [x, z] of [[0.55, 0.6], [-0.55, 0.6], [0.55, -0.7], [-0.55, -0.7]]) t.cyl(M.rubber, 0.28, 0.28, 0.2, 10, x, 0.28, z, 0, 0, Math.PI / 2);
    def('forklift', t, [[-0.62, 0, -1.1, 0.62, 2.35, 1.25]], 'metal');
  }

  // --- Interior furniture ---------------------------------------------------------------------
  {
    const t = new PropTemplate();
    t.box(M.metalDark, 1.8, 0.08, 0.9, 0, 0.9, 0);
    for (const x of [-0.8, 0.8]) for (const z of [-0.38, 0.38]) t.box(M.steel, 0.06, 0.9, 0.06, x, 0.45, z);
    t.box(M.metal, 0.4, 0.3, 0.3, -0.4, 1.09, 0);
    t.box(M.screenGreen, 0.35, 0.22, 0.02, 0.4, 1.12, -0.1, -0.3);
    def('labTable', t, [[-0.9, 0, -0.45, 0.9, 1.0, 0.45]], 'metal');
    const tube = new PropTemplate();
    tube.cyl(M.metalDark, 0.6, 0.6, 0.3, 16, 0, 0.15, 0);
    tube.add(new THREE.MeshStandardMaterial({ color: 0xb45cff, emissive: 0x6a2a8a, emissiveIntensity: 1.2, transparent: true, opacity: 0.55, roughness: 0.1 }),
      new THREE.CylinderGeometry(0.5, 0.5, 2.0, 16, 1, true), 0, 1.3, 0);
    tube.cyl(M.metalDark, 0.6, 0.6, 0.3, 16, 0, 2.45, 0);
    def('tube', tube, [[-0.6, 0, -0.6, 0.6, 2.6, 0.6]], 'glass');
    const l = new PropTemplate();
    l.box(M.metal, 0.9, 1.9, 0.5, 0, 0.95, 0);
    for (const x of [-0.22, 0.22]) l.box(M.metalDark, 0.02, 0.2, 0.01, x, 1.6, 0.26);
    def('locker', l, 'bounds', 'metal');
    const s = new PropTemplate();
    s.box(M.metal, 2.4, 0.06, 0.6, 0, 0.3, 0);
    s.box(M.metal, 2.4, 0.06, 0.6, 0, 1.0, 0);
    s.box(M.metal, 2.4, 0.06, 0.6, 0, 1.7, 0);
    for (const x of [-1.18, 1.18]) s.box(M.metalDark, 0.05, 1.9, 0.6, x, 0.95, 0);
    s.box(M.white, 2.2, 0.3, 0.45, 0, 1.2, 0);
    s.box(M.plaster, 2.0, 0.3, 0.45, 0, 0.5, 0);
    def('shelf', s, 'bounds', 'metal');
    const c = new PropTemplate();
    c.box(M.wood, 3.0, 1.0, 0.8, 0, 0.5, 0);
    c.box(M.plaster, 3.1, 0.06, 0.9, 0, 1.03, 0);
    def('counter', c, 'bounds', 'wood');
    const d = new PropTemplate();
    d.box(M.wood, 1.6, 0.06, 0.8, 0, 0.75, 0);
    for (const x of [-0.75, 0.75]) d.box(M.metalDark, 0.05, 0.75, 0.75, x, 0.37, 0);
    d.box(M.metalDark, 0.5, 0.35, 0.05, 0, 0.95, -0.2);
    def('desk', d, [[-0.8, 0, -0.4, 0.8, 0.8, 0.4]], 'wood');
    const b = new PropTemplate();
    b.box(M.steel, 2.2, 0.08, 0.9, 0, 0.95, 0);
    b.box(M.metalDark, 2.0, 0.9, 0.8, 0, 0.45, 0);
    def('bench', b, 'bounds', 'metal');
  }

  // --- Czech hedgehog anti-vehicle obstacle -----------------------------------------------------
  {
    const t = new PropTemplate();
    for (let i = 0; i < 3; i++) {
      const rot = [[0.6, 0, 0], [0, 0, 0.6], [0.6, Math.PI / 2, 0]][i];
      t.box(M.rust, 0.14, 1.8, 0.14, 0, 0.8, 0, rot[0], rot[1], rot[2]);
      t.box(M.rust, 0.14, 1.8, 0.14, 0, 0.8, 0, -rot[0], rot[1], -rot[2]);
    }
    def('hedgehog', t, [[-0.6, 0, -0.6, 0.6, 1.4, 0.6]], 'metal');
  }

  // --- Chain-link fence panel (3m along X) ----------------------------------------------------
  {
    const t = new PropTemplate();
    const plane = new THREE.PlaneGeometry(3, 2.6);
    const uv = plane.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 6, uv.getY(i) * 5.2);
    t.add(M.fence, plane, 0, 1.3, 0);
    t.cyl(M.steel, 0.04, 0.04, 2.7, 6, -1.5, 1.35, 0);
    t.cyl(M.steel, 0.03, 0.03, 3.0, 6, 0, 2.6, 0, 0, 0, Math.PI / 2);
    t.castShadow = false;
    def('fencePanel', t, [[-1.5, 0, -0.06, 1.5, 2.7, 0.06]], 'metal', { solid: false });
  }

  // --- Pipe rack section (compound) ------------------------------------------------------------
  {
    const t = new PropTemplate();
    for (const x of [-2.9, 2.9]) t.box(M.metalDark, 0.3, 5.2, 0.3, x, 2.6, 0);
    t.box(M.metalDark, 6.2, 0.3, 0.6, 0, 5.1, 0);
    for (const [y, z, r] of [[5.6, -0.2, 0.3], [5.55, 0.45, 0.22], [5.7, 0.0, 0.18]]) t.cyl(M.steel, r, r, 6.2, 12, 0, y, z, 0, 0, Math.PI / 2);
    def('pipeRack', t, [[-3.05, 0, -0.15, -2.75, 5.2, 0.15], [2.75, 0, -0.15, 3.05, 5.2, 0.15]], 'metal');
  }

  return P;
}
