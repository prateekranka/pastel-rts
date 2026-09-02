# Milestone 1 contracts and subagent ownership

Status: **contracts only**. This file is the coordination document for Composer implementers. It is not an implementation. Do not treat existing Milestone 0 stress-orbit code as the Milestone 1 rules engine.

Base: GitHub PR **#2** (head `f0f026c`) merged to `main` at **`f112a046`**. Branch `cursor/milestone-1-interaction-lab-29a7` is cut from that merge commit.

Package manager: **npm workspaces**. Do not migrate to pnpm, Yarn, Bun, or Turborepo. Root `package.json` / `package-lock.json` stay Grok-owned until schema, simulation, and navigation packages are registered.

---

## 1. How Milestone 1 extends Milestone 0 (do not weaken the proof)

Milestone 0 is a **platform and frame-budget proof**. Milestone 1 adds a **touch command sandbox** and **production-shaped content authoring** beside that proof. Benchmark mode must keep working with the same numbers, flags, and tests.

### Runtime modes

| Query | Meaning |
| --- | --- |
| *(omitted)* or `mode=benchmark` | Milestone 0 path. Default. |
| `mode=interaction-lab` | Milestone 1 sandbox. |

`mode` is **orthogonal** to existing flags. These Milestone 0 query parameters remain valid in both modes and **must not be renamed or removed**:

| Flag | M0 contract that remains true |
| --- | --- |
| `benchmark` | `idle-base`, `normal-midgame`, `dense-battle` (default when omitted), `camera-pan-stress`, `maximum-population`, `2x-stress`, `20-minute-soak`, `visual-capture` |
| `renderer` | `webgl` (baseline) / `webgpu` (benchmark, fallback required) |
| `dpr` | `1`, `1.25`, `1.5`, `native` |
| `zoom` | `50-percent`, `70-percent` (default), `100-percent`, `140-percent` |
| `seed` | Deterministic placement |
| `touchDebug` | Pointer overlay |
| `soakMs` | Test-only soak duration; soak **mode** is still 20 minutes (`SOAK_DURATION_MS`) |

**Default URL with no query** stays the Milestone 0 dense battlefield (`benchmark=dense-battle`, WebGL, 70-percent, stress population). Interaction-lab is **opt-in**. Playwright visual snapshots (`/?benchmark=visual-capture&seed=1&renderer=webgl&dpr=1&zoom=70-percent`) must remain bit-compatible in intent: frozen motion, same framing, same canvas.

Grok wires `mode` in `apps/game-web/src/runtime/config.ts` and `GameApp.ts`. Composers do not edit those files.

### What each mode runs

| Concern | `mode=benchmark` (M0, keep) | `mode=interaction-lab` (M1, add) |
| --- | --- | --- |
| Simulation | Existing `apps/game-web/src/sim/*` orbiting placeholders, pooled records, 20 Hz worker | New `@pastel-rts/simulation` tick rules + commands |
| Navigation | None (orbits) | `@pastel-rts/navigation` inside the worker. **No A\* on the render thread.** |
| Snapshot | `SNAPSHOT_STRIDE = 8` packed `Float32Array`, transferred buffers | Interaction snapshot (below). Still transferred `Float32Array`. |
| Population | 120/40/30/200 stress counts; 2× for max/`2x-stress` | Lab-spawned units/buildings from commands and scenarios, not the stress orbit |
| Camera / input | Pointer Events pan + pinch (`PointerCameraControls`) | Same camera controls **plus** tap-select / command (new controllers) |
| HUD | `DiagnosticsHud` (`.pastel-hud`) | Diagnostics HUD **kept**; `MatchHud` + `Minimap` added, not replacements |
| Foundry SSE | Dev-only `/dev-content` hot reload of unit proxies | Still works. Pack v2 also hot-reloads unit **and** building archetypes |
| iOS bridge | Coarse messages only (do not redesign) | Unchanged message types |

If a Composer change would make `npm test`, `npx playwright test` (chromium `battlefield.spec.ts` / foundry `foundry.spec.ts`), soak JSON keys, chunk layout, or iOS compile fail in benchmark mode, it is out of contract.

---

## 2. Package boundaries

Current Milestone 0 workspaces (do not remove):

```
apps/game-web              Vite + Three.js match surface
apps/foundry               Content Foundry UI
apps/ios-shell             XcodeGen SwiftUI WKWebView (bridge messages frozen)
packages/content-schema    Shared validation (v1 unit manifests today)
tools/content-server       HTTP + SSE writer for content/dev-pack
content/dev-pack           On-disk development pack (pack.json schemaVersion 1)
```

Milestone 1 **adds** two packages. Composers create the package trees; **Grok** adds them to root `workspaces`, root scripts, and the lockfile:

```
packages/simulation        Pure TS match rules (no Three.js)
packages/navigation        Pure TS grid pathfinding (no Three.js, worker-only)
```

### `packages/content-schema` (Composer A)

Owns on-disk and in-memory **content + shared wire types**.

Must keep exporting Milestone 0 APIs unchanged:

- `UNIT_MANIFEST_SCHEMA_VERSION = 1`
- `UNIT_FACTIONS = ['friendly','opposing','neutral']` (legacy **relationship** strings)
- `validateUnitManifest` / `createUnitManifest` / `detectOpaqueBounds`
- Unit id pattern `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`, max 64

Adds Pack v2, archetypes, command envelope types, entity id helpers, and fixed-point coord helpers (sections 3–7). Foundry and the content server **import** these; they do not fork copies.

Forbidden: Three.js, DOM (except tests), editing `apps/game-web/**`.

### `packages/simulation` (Composer B)

Owns tick advancement, command application, entity storage, occupancy **requests** to navigation, and interaction-lab snapshot writes.

- Dependency: `@pastel-rts/content-schema` only (plus test tooling). **Not** `@pastel-rts/navigation` as a hard compile-time cycle: simulation talks to navigation through the interfaces in section 9, injected by the worker glue (Grok).
- No renderer, no DOM, no pathfinding implementation.
- Deterministic for a fixed seed + command stream.
- 20 Hz (`TICK_HZ` / `TICK_MS` from game-web constants conceptually; the package should export `TICK_HZ = 20`, `TICK_MS = 50` so it does not import Three/game-web).

Forbidden: `apps/game-web/src/sim/**` (that tree is the M0 benchmark sim and stays Grok-owned).

### `packages/navigation` (Composer C)

Owns walkability, occupancy, and A\* (or equivalent grid search) on the 160×160 cell map.

- Dependency: `@pastel-rts/content-schema` for coords / ids / footprints. Not Three.js, not DOM.
- May be used with a stub occupancy source in unit tests without the full simulation package.
- Must run inside a Web Worker in production; APIs must be side-effect free aside from their own buffers.

Forbidden: calling navigation from `EntityRenderer`, `GameApp` render loop, or any main-thread module except **debug visualization of already-computed paths**.

### `apps/foundry` + `tools/content-server` (Composer D)

Owns authoring UX and the local writer/SSE protocol.

- Keep Milestone 0: PNG upload → opaque bounds → unit proxy → `POST /units` `{ manifest, pngBase64 }` → `content/dev-pack/units/<id>/sprite.png` + `manifest.json` → SSE `unit-published`.
- Extend for Pack v2 (buildings, faction ids, animation sheets) **without** breaking `apps/foundry/e2e/foundry.spec.ts` or the v1 POST body.
- Content server already binds `127.0.0.1:8787`, CORS, `/health`, `/events`, `/pack`, `/units`, `CONTENT_PACK_DIR`. Additive routes only.

Forbidden: rewriting game-web hot reload; changing native iOS code; removing v1 validation.

### `apps/game-web` subsystems

| Subsystem | Owner | Notes |
| --- | --- | --- |
| `src/app/GameApp.ts` | **Grok** | Composition root only. Named systems are constructed here. |
| `src/sim/**` (M0 worker, `Simulation`, `SimClient`, stride 8) | **Grok** | Benchmark mode. Do not delete. |
| `src/app/MatchRuntime.ts` (new) | **Grok** | Interaction-lab worker client + interpolate + system tick. |
| `src/input/PointerCameraControls.ts`, `TouchDebugOverlay.ts`, zoom tests | **Grok** | M0 pan/pinch. Additive query API only if strictly required (section 13). |
| `src/input/InteractionController.ts`, `CommandClient.ts` (new) | **E** | |
| `src/selection/**` (new) | **E** | |
| `src/ui/**` (new) | **E** | `MatchHud`, `Minimap`. Not `diagnostics/Hud.ts`. |
| `src/sandbox/**` (new) | **F** | Scenarios, `ScenarioController`, `UnitRenderSystem`, nav debug draw |
| `src/buildings/**` (new) | **F** | `BuildingRenderSystem` |
| `src/qa/**` (new) | **F** | Lab-only harness helpers |
| `src/camera/**`, `src/world/**`, `src/renderer/**`, `src/diagnostics/**`, `src/bridge/**`, `src/entities/EntityRenderer.ts` | **Grok / freeze** | M0 regression |
| `src/content/ContentHotReload.ts` | **Grok** later; D must not rewrite it | Keep SSE + disk PNG path; Grok extends for buildings |
| `src/runtime/config.ts` | **Grok** | `mode` flag |
| `e2e/battlefield.spec.ts` | **Freeze** | M0 Playwright |
| `e2e/interaction-lab.spec.ts` (new) | **F** | M1-only |

`GameApp` remains the **only** composition root. Composers export constructable classes; they do not mount canvases or start the rAF loop.

### Named systems (construct in `GameApp`, implement in owned folders)

| System | Implementer folder | Role |
| --- | --- | --- |
| `MatchRuntime` | Grok (`src/app/`) | Worker port, interpolation, pause/resume, snapshot buffers |
| `InteractionController` | E `src/input/` | Tap vs camera gesture; issues selection and commands |
| `SelectionController` | E `src/selection/` | Selected entity ids, marquee optional |
| `CommandClient` | E `src/input/` | Versioned envelopes → worker |
| `NavigationDebugRenderer` | F `src/sandbox/` | Draw cached paths / occupancy **from worker debug payloads** |
| `UnitRenderSystem` | F `src/sandbox/` | Idle/move sprites from interaction snapshots |
| `BuildingRenderSystem` | F `src/buildings/` | Footprints + sprites |
| `MatchHud` | E `src/ui/` | Selection, command buttons, not FPS diagnostics |
| `Minimap` | E `src/ui/` | 160×160 overview; no fog |
| `ScenarioController` | F `src/sandbox/` | Load named lab scenarios (spawn set-pieces) |

---

## 3. Shared types

Canonical TypeScript for these types lives in `@pastel-rts/content-schema` so simulation, navigation, Foundry, and game-web import **one** module. Composer A adds files; B/C/D/E/F import them. Do not duplicate the structs.

Suggested new files (A-owned):

- `packages/content-schema/src/coords.ts`
- `packages/content-schema/src/ids.ts`
- `packages/content-schema/src/commands.ts`
- `packages/content-schema/src/pack.ts` (Pack v2)
- `packages/content-schema/src/animation.ts`
- Re-export from `packages/content-schema/src/index.ts` **additively** (keep v1 exports).

### Ticks

```ts
/** Monotonic simulation tick. Incremented once per 50 ms step. 0 before the first step. */
type Tick = number; // integer, uint32 range in practice
```

Pause does **not** fast-forward missed ticks (Milestone 0). Commands carry `issuedAtTick` equal to the last completed tick known to the issuer and `executeTick` for when the worker should apply (usually the same tick, never earlier). Same-tick commands from one issuer are ordered by `sequence`. The worker stamps `acceptedAtTick` on apply.

### Fixed-point coordinates

```ts
/** 1 map cell = 1024 subunits. Sim and nav use integers only. */
const SUBUNITS_PER_CELL = 1024;

type CellCoord = { cx: number; cz: number };     // 0..159 inclusive on the M0 map
type SubunitCoord = { x: number; z: number };    // integer world subunits
```

Conversion (do not change Milestone 0 `CELL_SIZE = 1` world floats used by camera, terrain, and benchmark snapshots):

```
worldFloatX = subunitX / SUBUNITS_PER_CELL
subunitX    = round(worldFloatX * SUBUNITS_PER_CELL)
cellX       = floor(subunitX / SUBUNITS_PER_CELL)  // clamp 0..MAP_CELLS-1
```

Map remains **160 × 160 cells**, **16 × 16 cell chunks**, **10 × 10 chunk grid**. `MAP_WORLD_SIZE` stays `160` world units. Interaction-lab snapshots **write world floats** at the worker boundary so the existing isometric camera math is unchanged.

Heading in sim: integer **milliradians** or a discrete facing (section 10). Snapshot field for render is a **float radians** yaw around +Y, matching M0 `heading`.

### Entity ids (not array indices)

Milestone 0 `Simulation` identity is the live pool slot used as snapshot row index. That is **illegal** for Milestone 1 commands, selection, and nav.

Required scheme: **index + generation** (fits the existing pool style).

```ts
type EntityIndex = number;      // 0 .. capacity-1
type EntityGeneration = number; // starts at 1; 0 is invalid

type EntityId = {
  index: EntityIndex;
  generation: EntityGeneration;
};

function isNilEntity(id: EntityId): boolean {
  return id.generation === 0;
}
```

Rules:

1. Snapshot rows **must** include `index` and `generation` (two float32 channels is acceptable).
2. After `removeEntity` / `removeBuilding`, the slot may be reused only after `generation += 1`.
3. Stale ids (wrong generation) are rejected, not applied to a new occupant.
4. Do not use `entities[i]` array position as an id in any public API.
5. Packed 64-bit (`index` low 32, `generation` high 32) is allowed internally; public TS API is the object or two numbers.

Monotonic uint32 ids are **not** the M1 choice (pooling is already in M0). Do not mix schemes.

### Relationship vs faction

Milestone 0 `FACTION` / manifest `faction: 'friendly' | 'opposing' | 'neutral'` is a **relationship to the local player**, not a civilization id.

| Term | Where | Example |
| --- | --- | --- |
| `factionId` | Content Pack v2 | `"sunweaver"`, `"gravemark"`, `"neutral"` |
| `relationship` | Runtime / snapshot | `'friendly' \| 'opposing' \| 'neutral'` |

Product faction ids are **`sunweaver` | `gravemark` | `neutral`**. Lab default: local player is `sunweaver`; `gravemark` is opposing. Neutral is props/environment, not a playable faction. Do not author `ember-court` / `violet-host`.

---

## 4. Content schema direction (Pack v2)

### Pack v1 (keep loading)

`content/dev-pack/pack.json` today:

```json
{ "schemaVersion": 1, "id": "dev-pack", "units": [] }
```

Unit files: `content/dev-pack/units/<id>/manifest.json` + `sprite.png`. Foundry e2e asserts `schemaVersion === 1`.

### Pack v2 (add)

Canonical types live in `@pastel-rts/content-schema`. Product `factionId` is `'sunweaver' | 'gravemark' | 'neutral'`.

```ts
type PackV2 = {
  schemaVersion: 2;
  id: string;
  revision: string;
  factions: FactionDef[];
  units: UnitArchetype[];
  buildings: BuildingArchetype[];
  maps?: MapReference[];
  scenarios?: ScenarioReference[];
  contentHash: string;
};

type FactionDef = {
  id: FactionId;
  displayName: string;
};

type UnitArchetype = {
  schemaVersion: 2;
  id: string;
  displayName: string;
  enabled: boolean;
  factionId: FactionId; // sunweaver | gravemark | neutral — NOT relationship
  assetPath: string;    // relative PNG or sheet, no `..`, no leading `/`
  sourceWidth: number;
  sourceHeight: number;
  frameWidth: number;
  frameHeight: number;
  margin: { x: number; y: number };
  spacing: { x: number; y: number };
  bounds: PixelBounds;
  anchor: UnitAnchor;   // 0..1, same as v1
  worldHeight: number;  // world units (cells), same meaning as v1
  selectionRadius: number;
  collisionRadius: number;
  animation: UnitAnimationDef; // idle AND move required
  movement: {
    speedSubunitsPerTick: number; // integer > 0
    accelerationRate: number;
    turnRateMilli: number;
    footprintCategory: string;    // M1 units: typically "unit-1x1" (one nav cell)
  };
  tags?: string[];
};

type BuildingArchetype = {
  schemaVersion: 2;
  id: string;
  displayName: string;
  enabled: boolean;
  factionId: FactionId;
  assetPath: string;
  sourceWidth: number;
  sourceHeight: number;
  bounds: PixelBounds;
  anchor: UnitAnchor;
  worldHeight: number;
  footprint: RectFootprint | CellMaskFootprint; // cellsW/cellsH >= 1
  animation?: AnimationDef; // idle required when present; move optional
  tags?: string[];
};
```

M1 units occupy **one nav cell** (`movement.footprintCategory`, typically `unit-1x1`). Buildings use cell footprints (`kind: 'rect' | 'mask'`). Footprints are in **cells**, origin = occupancy cell of the building’s south-west (min-x, min-z) corner. Placement fails if any covered cell is out of map or occupied.

### v1 → v2 migration

A must ship `upgradePackV1ToV2(packV1): PackV2`:

1. Keep `id`.
2. Synthesize three factions: `sunweaver`, `gravemark`, `neutral` (display names free).
3. Each v1 unit: `factionId` from legacy `faction` — `friendly` → `sunweaver`, `opposing` → `gravemark`, `neutral` → `neutral` (runtime **relationship** is still derived separately for Foundry proxies and snapshots).
4. Default `movement.speedSubunitsPerTick` from `DEFAULT_V1_UPGRADE_SPEED_SUBUNITS_PER_TICK` (64), `movement.footprintCategory: 'unit-1x1'`, `animation` = `{ clips: { idle: default, move: default }, directions: 1, mirrored: false }`.
5. `validateUnitManifest` continues to require `schemaVersion: 1`. A **new** `validateUnitArchetype` requires `schemaVersion: 2`.
6. Content server `readPack()` remains able to return v1 for M0 tests. Additive: `GET /pack?schema=2` or dual body field — D implements after A’s validators exist. Do not break `GET /pack` v1 shape used by Foundry e2e (`id`, `schemaVersion: 1`, `units` array of v1 manifests).

Sample authored content (A, under `content/**` only): at least two unit archetypes and two building archetypes, one per faction, plus a v2 pack fixture used by schema tests. Do not rewrite `apps/game-web` loaders.

Pack v2 may list `maps[]` / `scenarios[]` path references. On-disk **foundations** (stubbed, tested) are `MapDef` (`validateMapDef`) and `ScenarioDef` (`validateScenarioDef`): default lab map is 160×160 cells, 16-cell chunks; a scenario names a `mapId` plus unit/building spawn lists. Composer F authors scenario files against these types; C reads `MapDef.blockedCells` if present.

---

## 5. Command format

Wire type lives in `packages/content-schema/src/commands.ts`. Protocol / schema version **1** for M1.

Canonical envelope keeps the contract names `protocolVersion`, `commandId`, `issuedAtTick`, and `kind`. User-spec fields `sequence` and `executeTick` are **required** (same-tick ordering uses `sequence`; the worker applies at `executeTick`). Input aliases: `schemaVersion` for `protocolVersion`, `type` for `kind`. `entityIds` stay on the payload (move/stop). Optional `formation` on move.

```ts
type CommandKind =
  | 'spawnUnit'
  | 'removeEntity'
  | 'move'
  | 'stop'
  | 'placeBuilding'
  | 'removeBuilding';

type MoveFormation = {
  kind: 'none' | 'line' | 'box';
  spacingSubunits?: number;
};

type CommandEnvelopeV1 = {
  protocolVersion: 1;
  commandId: string;     // client-generated, unique per issued command (uuid or `lab-${n}`)
  sequence: number;      // same-tick order; lower applies first; >= 0
  issuedAtTick: Tick;
  executeTick: Tick;     // >= issuedAtTick
  playerId: string;      // sandbox: "lab-local"
  kind: CommandKind;
  payload: CommandPayload;
};

type CommandPayload =
  | { kind: 'spawnUnit'; archetypeId: string; position: SubunitCoord; headingMilli?: number }
  | { kind: 'removeEntity'; entityId: EntityId }
  | { kind: 'move'; entityIds: EntityId[]; destination: SubunitCoord; formation?: MoveFormation }
  | { kind: 'stop'; entityIds: EntityId[] }
  | {
      kind: 'placeBuilding';
      archetypeId: string;
      originCell: CellCoord; // min corner
      headingMilli?: number;
    }
  | { kind: 'removeBuilding'; entityId: EntityId };
```

Discriminated payloads **must** repeat `kind` so validators do not need the envelope.

Worker results (main thread, not schema-mandatory but B must post them):

```ts
type CommandResult = {
  type: 'commandResult';
  commandId: string;
  status: 'accepted' | 'rejected';
  acceptedAtTick?: Tick;
  reason?: string;          // stable codes: 'stale-id' | 'blocked' | 'unknown-archetype' | 'out-of-bounds' | 'capacity'
  spawnedId?: EntityId;
};
```

Semantics:

| Command | Success | Reject |
| --- | --- | --- |
| `spawnUnit` | Slot allocated, id returned, idle at position | OOB, unknown archetype, capacity |
| `removeEntity` | Unit (not building) despawned, generation bumped | Stale id, target is a building (use `removeBuilding`) |
| `move` | Nav request queued per id; unit state → move. Optional `formation` is recorded for B to apply | Stale id, empty list, destination OOB, invalid formation |
| `stop` | Cancel path, state → idle | Stale id |
| `placeBuilding` | Occupancy claimed, idle building | Overlap, OOB, unknown archetype |
| `removeBuilding` | Occupancy released | Stale id, target is a unit |

No attack, gather, produce-queue, patrol, or stance commands in M1.

---

## 6. Coordinate system (render vs sim)

Already true in Milestone 0 and **must stay true**:

- Logical map 160×160 cells; `CELL_SIZE = 1` world unit per cell.
- Terrain: one mesh per 16×16 chunk, 10×10 chunks (`assertChunkLayout`).
- Default camera `70-percent`: ~44 cells ground AABB width; look-at clamped to the map.
- Fixed isometric orthographic camera (no player yaw/pitch). Azimuth `π/4`, elevation `atan(1/√2)`.
- Pointer Events; `touch-action: none`.

Milestone 1 addition:

- **Sim/nav integer space** is subunits (1024 per cell).
- **Render/camera space** stays world floats. Worker snapshot `x`,`z` are world floats (`subunit / 1024`).
- Building origins snap to **cell** coordinates. Units move in subunits (can stand off cell centers).
- Ground picking: main thread ray/plane hit → world float → round to subunits for commands. E implements picking; must not import A\*.

---

## 7. Entity ID rules (summary)

1. Index + generation; generation `0` is never a live entity.
2. Snapshot identifies entities explicitly; row order may be dense-packed live entities and **must not** be used as identity.
3. Selection, commands, and nav keys use `EntityId`.
4. Capacity is package-defined (recommend ≥ 512 lab entities, independent of M0 stress 390). Benchmark mode keeps 120+40+30+200 (+2× presets) in the **old** sim.

---

## 8. Worker-message protocol

### Process split (both modes)

| Thread | Owns | Must not |
| --- | --- | --- |
| Main | Input, camera, Three.js render, UI, interpolation, native bridge | A\*, occupancy flood fills, sim `step` |
| Worker | Sim step + nav search + snapshot pack | Touch handlers, WebGL, DOM |

20 Hz `setInterval` / equivalent in the worker. Main interpolates previous→current `Float32Array` using arrival time (existing `interpolationAlpha`). Pause on `document.hidden` and native `pause`; resume does not catch up ticks. First resumed frame omitted from FPS sampling (M0).

### Benchmark worker (keep)

Messages in `apps/game-web/src/sim/types.ts`:

Main → worker: `init`, `start`, `pause`, `resume`, `setCounts`, `terminate`  
Worker → main: `snapshot` (`tick`, `simTimeMs`, `producedAtMs`, `tickDurationMs`, `counts`, transferred `payload`)

`SNAPSHOT_STRIDE = 8`: `x, z, heading, anim, kind, faction, radius, speed`.

### Interaction-lab worker (add; Grok glues, B/C implement libraries)

Main → worker:

| `type` | Body |
| --- | --- |
| `initLab` | `{ seed, pack: PackV2 \| PackV1, scenarioId?: string }` |
| `start` / `pause` / `resume` / `terminate` | same names as M0 for pause semantics |
| `command` | `CommandEnvelopeV1` |
| `setNavDebug` | `{ enabled: boolean }` |

Worker → main:

| `type` | Body |
| --- | --- |
| `snapshot` | Interaction snapshot (below), transferred buffer |
| `commandResult` | see section 5 |
| `navDebug` | Paths/occupancy **already computed**; small JSON or packed ints, not a search request |

Interaction snapshot (suggested stride **12**, B documents the exact layout in `packages/simulation` and F/E consume it):

| Offset | Content |
| --- | --- |
| 0–1 | `x`, `z` world floats |
| 2 | heading radians |
| 3 | anim phase 0..1 |
| 4 | kind (`0` unit, `1` building, `2` reserved) |
| 5 | relationship enum (0/1/2 as M0) |
| 6–7 | entity index, generation |
| 8 | anim state (`0` idle, `1` move) |
| 9 | facing index (0..7) for sprites |
| 10–11 | reserved (hp/path t) |

Benchmark mode **must not** switch to this stride.

Worker implementation location: Grok adds `apps/game-web/src/app/matchWorker.ts` (or equivalent) that imports `@pastel-rts/simulation` and `@pastel-rts/navigation`. Composers B and C do not create that file.

---

## 9. Navigation interfaces

`packages/navigation` exports (names may match; behavior must):

```ts
type PathId = number;

type NavCell = { cx: number; cz: number };

type GridPath = {
  entityId: EntityId;
  cells: NavCell[];       // including start and goal, 4-connected (N/E/S/W)
  status: 'pending' | 'found' | 'blocked' | 'cancelled';
};

interface NavigationService {
  /** 160×160 default; tests may use smaller maps. */
  resize(cellsX: number, cellsZ: number): void;
  setBlocked(cx: number, cz: number, blocked: boolean): void;
  setFootprintBlocked(origin: NavCell, cellsW: number, cellsH: number, blocked: boolean): void;
  isWalkable(cx: number, cz: number): boolean;
  /** A* (or equivalent). Must not be called on the main thread in apps/game-web. */
  requestPath(entityId: EntityId, from: SubunitCoord, to: SubunitCoord): PathId;
  cancel(entityId: EntityId): void;
  /** Follow: next waypoint in subunits, or null if idle/blocked. */
  nextWaypoint(entityId: EntityId): SubunitCoord | null;
  debugSnapshot(): {
    blocked: Uint8Array;           // length cellsX*cellsZ
    paths: Array<{ entityId: EntityId; cells: NavCell[] }>;
  };
}
```

Rules:

- Buildings: hard blockers for their footprint.
- Units: M1 may treat the **current cell** as a soft cost (prefer empty cells) but must not deadlock `move` to an adjacent occupied cell if a wait-and-repath exists; simplest legal M1: units do **not** block the grid (buildings only). Document the choice in simulation tests; default **buildings only** so Composer B and C stay decoupled.
- No diagonal corner-cutting through two blocked orthogonals.
- Search budget: complete A\* on 160×160 is acceptable for lab population; if a cap is needed, fail with `blocked` rather than running on the main thread.
- `NavigationDebugRenderer` only consumes `navDebug` / `debugSnapshot()` copies posted off the worker.

---

## 10. Animation interfaces

Content (`AnimationDef` in schema):

```ts
type AnimClipId = 'idle' | 'move'; // M1 only; no attack/death

type AnimationDef = {
  clips: {
    idle: SpriteClip;
    move?: SpriteClip; // units require move; buildings may omit
  };
  /** 1 = billboard / single frame set; 4 = N E S W; 8 = N NE E SE S SW W NW */
  directions: 1 | 4 | 8;
  /** If true, west-ish facings are east-ish frames with X flip. 4 dirs + mirror ⇒ 8 visual. */
  mirrored?: boolean;
};

type SpriteClip = {
  /** Atlas or sheet path relative to the pack; may equal the unit assetPath for M1 proxies */
  assetPath?: string;
  frames: { kind: 'indexes'; indexes: number[] } | { kind: 'range'; start: number; end: number };
  fps: number;           // display rate; sim only stores phase 0..1
  looping: boolean;
};
```

Unit archetypes **must** include `idle` and `move`. Buildings may omit `animation` entirely, or supply idle-only.

Runtime (`UnitRenderSystem`):

1. Read snapshot `anim state` + `heading` / `facing index`.
2. Map heading to a facing:
   - `1`: ignore heading, no flip.
   - `4`: quadrants N/E/S/W.
   - `8`: eight octants.
   - `mirrored && (4|8)`: store only E/NE/SE/N (and S if 8); flip for W/NW/SW.
3. Sample clip frame from `anim phase`. `visual-capture` / freeze still applies in benchmark mode only; lab may freeze via scenario flag later (Grok).
4. Do not implement combat hit flashes.

Foundry (D): author `directions` and `mirrored`; preview at least idle + one facing. M0 single-PNG path remains the default for v1 units.

---

## 11. File ownership (six Composers, no overlapping high-conflict files)

Work in **isolated git worktrees** when possible (create later; do not share a dirty `apps/game-web/src/app/GameApp.ts`):

| Worktree | Path |
| --- | --- |
| A | `../pastel-rts-m1-schema` |
| B | `../pastel-rts-m1-sim` |
| C | `../pastel-rts-m1-nav` |
| D | `../pastel-rts-m1-foundry` |
| E | `../pastel-rts-m1-input` |
| F | `../pastel-rts-m1-qa` |

### A — CONTENT

**Owns**

- `packages/content-schema/**` (including tests, `package.json` inside the package, `index.ts` additive exports)
- `content/**` (sample Pack v2 fixtures, extra archetypes). Do not delete `content/dev-pack/pack.json` v1 compatibility.

**Must not**

- `apps/game-web/**`, `apps/foundry/**`, `tools/content-server/**`, root `package.json`, CI, Playwright config

### B — SIM

**Owns**

- `packages/simulation/**` (new package: `package.json`, `src/**`, vitest)

**Must not**

- `apps/game-web/src/sim/**`
- `packages/navigation/**`, `packages/content-schema/**`
- Root workspace registration

Stub `NavigationService` in sim tests.

### C — NAV

**Owns**

- `packages/navigation/**` (new package)

**Must not**

- Simulation internals, game-web, schema source (import published types only)

### D — FOUNDRY

**Owns**

- `apps/foundry/**`
- `tools/content-server/**`

**Must not**

- `packages/content-schema/**` (import only)
- `content/dev-pack/pack.json` committed shape for v1 e2e — runtime writes are fine via `CONTENT_PACK_DIR`
- `apps/game-web/src/content/ContentHotReload.ts`

Keep Foundry Vite proxy `/dev-content` → `8787`. Additive screens for buildings/factions after A’s Pack v2 types exist. Do not break PNG → bounds → save.

### E — INPUT / HUD

**Owns**

- `apps/game-web/src/input/InteractionController.ts` (new)
- `apps/game-web/src/input/CommandClient.ts` (new)
- `apps/game-web/src/input/InteractionController.test.ts` (new)
- `apps/game-web/src/selection/**` (new directory)
- `apps/game-web/src/ui/**` (new directory: `MatchHud.ts`, `Minimap.ts`, styles scoped under `.pastel-match-hud` / `.pastel-minimap`)

**Must not**

- `PointerCameraControls.ts`, `PointerCameraControls.test.ts`, `zoomStops.test.ts`, `TouchDebugOverlay.ts` (M0 camera proof)
- `diagnostics/**` (`DiagnosticsHud` class, soak, report keys)
- `GameApp.ts`, `runtime/config.ts`
- iOS Swift

Gesture contract: existing one-finger **drag** = pan; two-finger = pinch; wheel = zoom. E uses **press-and-release with small movement** as tap (select / ground command). Do not bind competing `pointerdown` pan logic. If a read-only hook is required, propose it for Grok; do not rewrite the camera class.

### F — SANDBOX / QA

**Owns**

- `apps/game-web/src/sandbox/**`
- `apps/game-web/src/buildings/**`
- `apps/game-web/src/qa/**`
- `apps/game-web/e2e/interaction-lab.spec.ts` (new) and any `tests/` M1-only specs **new files only**

**Must not**

- `e2e/battlefield.spec.ts`, `apps/foundry/e2e/foundry.spec.ts`
- `playwright.config.ts` (Grok adds the spec path / project if needed)
- `entities/EntityRenderer.ts` (benchmark placeholders stay)
- `GameApp.ts`

### Grok-owned (Composers: do not edit without approval)

| Path | Why |
| --- | --- |
| `package.json`, `package-lock.json` | Workspace registration, scripts (`typecheck`/`test` include new packages) |
| `.github/workflows/ci.yml` | Web + iOS jobs |
| `.nvmrc`, `tsconfig.base.json` | Toolchain |
| `playwright.config.ts` | Shared visual pipeline, Foundry pack dir |
| `README.md` | Later, with `docs/milestone-1.md` |
| `docs/architecture.md`, `docs/milestone-0.md`, `docs/milestone-1-contracts.md` | Architecture; M1 product doc comes later as `docs/milestone-1.md` |
| `docs/ipad-physical-device-checklist.md` | Physical QA |
| `apps/game-web/src/app/GameApp.ts` | Composition wiring |
| `apps/game-web/src/app/MatchRuntime.ts`, `matchWorker.ts` (new, Grok) | Worker glue |
| `apps/game-web/src/sim/**` | M0 20 Hz orbit sim |
| `apps/game-web/src/runtime/config.ts` | Flags including future `mode` |
| `apps/game-web/src/main.ts` | `__pastelApp` |
| `apps/game-web/src/bridge/**` | Native message types |
| `apps/ios-shell/**` | Bundled WKWebView; **do not redesign bridge messages** |
| `scripts/**` | `ios:sync-web`, XcodeGen generate |
| `apps/game-web/src/camera/**`, `world/**`, `renderer/**`, `diagnostics/**`, `entities/EntityRenderer.ts`, `entities/atlas.ts` | M0 frame-budget proof |
| `apps/game-web/e2e/battlefield.spec.ts` | Visual + pan + soak |

---

## 12. Integration order

```
A schema  ──────────────────────────────────────────►
              B sim ──────────────┐
              C nav ──────────────┼─► E input/HUD ─► F sandbox/QA
              D foundry ──────────┘
Grok: register workspaces after A (and after B/C package.json exist);
      wire GameApp / MatchRuntime after E+F classes exist.
```

1. **Wave 1 (immediately after this contracts file):** Composer **A only**. Schema is the type source of truth. B/C/D would fork types if they start first.
2. **Wave 2 (after A is merged or its public types are on the branch):** **B, C, and D in parallel**. Simulation and navigation are independent packages. Foundry only needs schema + content-server routes.
3. **Wave 3:** **E** once command envelopes and `EntityId` exist in schema **and** simulation’s public `CommandEnvelope` apply API / result codes are documented in `packages/simulation` (even if Grok has not wired the worker yet). E may unit-test `CommandClient` serialization without the worker.
4. **Wave 4:** **F** after sim + nav + input **contracts** (this file + A’s types + B/C exported APIs + E’s controller types). F may mock `CommandClient` / snapshots.

Grok integration (not this PR): add workspaces; worker imports B+C; `GameApp` constructs named systems; `mode=interaction-lab`; CI `test` scripts; Playwright project entry for `interaction-lab.spec.ts`.

---

## 13. Milestone 0 regression checklist (must remain true)

- Map **160×160**, chunks **16×16**, **10×10** grid, one terrain mesh per chunk.
- Default **70-percent** framing (~44 × ~28 cells), named zoom stops, look-at clamp.
- **Pointer Events** pan / pinch / wheel; Pencil / pinch-lift behavior covered by existing unit tests.
- **WebGL** baseline; **WebGPU** opt-in with fallback and canvas reclaim.
- Simulation worker **20 Hz**; main-thread interpolation; pooled/transferred snapshots; no SharedArrayBuffer requirement.
- Diagnostics HUD: FPS, 1% low, p95/p99, sim tick, snapshot latency, draw calls, triangles, chunks, renderer, DPR, viewport.
- Soak **20 minutes** (`SOAK_DURATION_MS`); `?soakMs=` for tests; report keys include `physicalValidationStatus`, viewport, DPR, UA, renderer, timestamp, `benchmark`, `autoCameraMotion`.
- Foundry hot reload: disk pack + SSE, **dev-only** `EventSource` (not production/iOS bundle).
- Bundled WKWebView `pastel://`; iOS CI `macos-latest` XcodeGen + `xcodebuild` simulator compile.
- Visual regression: Chromium 1280×800, `visual-capture`, snapshots under `apps/game-web/e2e`.
- Benchmark names listed in section 1.
- npm workspaces, Node 22 (`.nvmrc`).
- iOS bridge types frozen: JS→native `gameReady`, `requestHaptic`, `performanceReport`, `runtimeError`; native→JS `pause`, `resume`, `setDeveloperConfiguration`. Handler name `pastelBridge`.

---

## 14. Out of scope (Milestone 1)

Combat, projectiles, HP as gameplay, economy, resources, build queues, production, AI opponents, fog of war, networking / multiplayer, pathfinding on the render thread, replacing npm, rewriting the iOS shell, claiming 60 fps without physical-device reports, changing default boot away from the dense benchmark battlefield, diagonal-only movement models that break the 160-cell grid, or new package managers.

---

## 15. TypeScript / test conventions for implementers

- Extend `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`.
- Package `exports`: `"."`: `./src/index.ts` (same as content-schema).
- Vitest colocated `*.test.ts`. Schema tests must keep v1 unit fixtures passing.
- No `any`. Prefer branded numbers only if they stay serializable on the worker boundary.
- Do not add Three.js to schema/sim/nav.

---

## 16. Composer definition of done (for later PRs)

| Agent | Done when |
| --- | --- |
| A | Pack v2 + command/id/coord/animation/map/scenario types exported; v1 tests green; v1→v2 upgrade tested; sample content under `content/**` |
| B | Commands in section 5 applied; ids + generations; 20 Hz step; snapshot layout documented; vitest without Three |
| C | 160×160 A\* + footprints; debug snapshot; vitest on a small fixture map |
| D | v1 Foundry e2e still passes; v2 authoring for unit+building+factionId; server additive routes |
| E | Tap select/move/stop/spawn/place wired to `CommandClient`; MatchHud + Minimap; camera pan still works in isolation tests |
| F | Lab scenario loads; unit/building render from interaction snapshots; nav debug overlay; Playwright `interaction-lab.spec.ts` |

Grok merges and wires. Until then, packages may exist unreferenced by root `workspaces`.
