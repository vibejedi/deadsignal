# DEAD SIGNAL: A Horrors.Fun Game

**Play free at [deadsignal.horrors.fun](https://deadsignal.horrors.fun)**

District 9 stopped answering three nights ago. Get in, bring the depot uplink back to life, hunt WARDEN-9, then
signal RAVEN 2-1 and survive the final horde long enough to board it, before the rot reaches the landing zone.
A first-person extraction-survival shooter in the browser, built with Three.js, TypeScript and Vite.

This is the Horrors.Fun edition: blood-moon night lighting, violet contamination, red-eyed infected with claws and
fangs, and the Horrors.Fun look and voice throughout. Co-op for 2–4 players is in development.

### Credits

Built on [Dead Signal: Exclusion Zone](https://github.com/bridge-mind/claude-opus-5.5-zombies-game) by BridgeMind,
released under the MIT License (see [LICENSE](LICENSE)). All 3D models, textures and audio are generated in code.

## Run it

```bash
pnpm install
pnpm dev          # http://127.0.0.1:5173
pnpm build        # typecheck + production build into dist/
pnpm preview      # serve the production build
pnpm typecheck
pnpm test         # vitest unit tests for the pure game logic
```

Requires a desktop browser with WebGL and pointer lock (current Chrome, Edge, Firefox or Safari). No backend or accounts.

## Controls

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| WASD | Move | E | Interact |
| Mouse | Look | 1 / 2, wheel | Switch weapon |
| LMB / RMB | Fire / aim down sights | G | Frag grenade |
| R | Reload | Q | Apply armor plate |
| Shift | Sprint | M (or Tab) | Tactical map |
| Space / C | Jump / crouch (toggle) | Esc | Pause and release the mouse |

At a Quartermaster station or the Armory bench, press **E** to open it and a **number key (3–6)** to buy.

## The mission (~8–10 minutes)

1. **Defend the Uplink Relay** (Kessler Depot, medium threat): activate it, then stay inside the ring for 60 s. Progress only
   builds while you are in the zone and slowly decays when you leave.
2. **Hunt WARDEN-9** (Halcyon Compound, high threat): a large armored elite. Shoot the helmet off, then go for the head.
3. **Extract**: once both contracts are done, the contamination front starts spreading from the reactor and the timer
   clamps to a 5:30 exfil window. Signal RAVEN 2-1 at the LZ radio, hold for 75 s while the final horde comes in, then walk
   to the helicopter door and press E. Dying, or running out of time, fails the mission.

Threat regions change zombie composition (runners and armored infected become common further north), health, damage and
salvage rewards. Supply caches in higher-threat areas hold better loot.

## Project layout

```
src/
  config.ts            all balancing values (weapons, zombies, regions, economy, mission timing)
  core/                Game (state machine, fixed 60 Hz simulation, render loop), Input, Settings, RNG
  render/              renderer + post-processing, procedural textures, materials, geometry batching/instancing
  world/               Level layout, collision (AABB + grid broadphase, ray casts), navigation flow field, props
  player/              movement controller and pure vitals (health/armor/plates/stamina) rules
  weapons/             pure ammo/reload state, weapon system (hitscan + pellets), viewmodel, grenades
  enemies/             procedural skinned zombie models, AI state machine, manager, spawner
  mission/             contracts, extraction FSM, economy, mission timeline, helicopter, interactables
  audio/               procedurally synthesised WebAudio engine
  ui/                  HUD, minimap/tactical map, menus
tests/                 unit tests (weapons, vitals/economy, contracts/extraction/mission, collision/navigation)
```

## Development test mode

`pnpm dev` then open `http://127.0.0.1:5173/?dev` to expose `window.__DS` automation hooks (teleport, synthetic input,
time scale, spawn helpers). They drive the real systems and are only compiled into dev builds — the production bundle
contains none of it.

## Assets and attribution

Everything is generated at runtime: textures (canvas noise, normal maps from height fields), meshes (primitives merged and
instanced), zombie skinned meshes, signage, and all audio (WebAudio synthesis). No third-party art or sound files are used.
Fonts come from the local system stack. Three.js is MIT licensed.

## License

MIT — see [LICENSE](LICENSE).
