# Architecture

pastel-rts is a TypeScript monorepo (`npm workspaces`) with a Vite + PixiJS web client
and a thin WKWebView iOS shell. The same web bundle runs in Safari, Chrome, and
the native iPad app.

## Repository layout

```
apps/game-web/          Vite + PixiJS client (renderer, input, HUD, sandbox, QA)
apps/foundry/           Local content Foundry (Vite + Hono API)
apps/ios-shell/         SwiftUI WKWebView host + NativeBridge
packages/content-schema Versioned JSON schemas + loaders (Pack v1 + Pack v2)
packages/simulation     Deterministic lockstep sim (M0 orbit + M1 command/nav)
packages/navigation     Occupancy grid + A* + formation slots (runs in worker)
packages/render-core    Shared Pixi helpers
packages/native-bridge  Typed postMessage protocol
packages/perf           HUD / frame timing helpers
tools/content-server    Pack HTTP + SSE hot-reload (Foundry API)
e2e/                    Playwright visual + interaction-lab specs
content/dev-pack        Pack v1 (M0 dense-battle)
content/dev-pack-v2     Pack v2 (M1 archetypes, buildings, scenarios)
docs/                   Contracts, milestone notes, iPad checklist
```

## Runtime modes

`apps/game-web/src/runtime/config.ts` parses the URL:

| `?mode=` | Default | Worker | Purpose |
| --- | --- | --- | --- |
| `benchmark` | yes (also when omitted) | 20 Hz M0 orbit worker | Dense-battle visual / perf capture |
| `interaction-lab` | no | 20 Hz M1 command worker | Selection, movement, buildings, replay |

M0 URLs used by Playwright (`/?benchmark=visual-capture&seed=1&renderer=webgl&dpr=1&zoom=70-percent`)
do not set `mode`, so they keep the dense-battle path.

## Threading

- **Main / render thread:** PixiJS, camera, Pointer Events, HUD, interpolation,
  `InteractionController`, `UnitRenderSystem` (instanced sprite batches).
  Placement preview uses occupancy `isWalkable` only — never A*.
- **Match worker (`matchWorker.ts`):** `SimulationWorld.tick`, occupancy updates,
  A* / formation via `NavigationService`. Checksums every N ticks.
- **Logic rate** is 20 Hz (`FIXED_DT`) independent of rAF / display refresh.

## Snapshot layout (M1 lab)

Little-endian `Float32Array` stride **12**:

`id, x, y, vx, vy, hp, facing, anim, selected, orderKind, archetypeIndex, buildingFlag`

M0 benchmark snapshots remain stride **8**.

Entity ids are `index + generation * 2^16` (see `packages/simulation` EntityRegistry).

## Content

Pack v2 is the M1 source of truth (`content/dev-pack-v2`). Pack v1 remains for M0.
Vite serves `/content/dev-pack-v2/` in dev and copies it into `dist/` for production.
Foundry writes atomically under `content/dev-pack-v2/` and broadcasts SSE `v2-changed`.

Factions in v2: `sunweaver`, `gravemark`, `neutral`. Relationship is a separate
field (`friendly` / `hostile` / `neutral`).

## Native bridge

`NativeBridge` messages are coarse: `requestHaptic` (optional `reason`:
`selection` | `move` | `place` | `invalid`), `reportPerf`, `notifyReady`.
No per-frame entity dumps. The Swift decoder ignores unknown keys and rejects
an unknown `reason` string if present.

## iOS

`apps/ios-shell` loads `apps/game-web/dist` from the app bundle after
`npm run ios:sync-web`. Simulator CI compiles with `xcodebuild` on `macos-latest`.
Physical-device status lives in `docs/ipad-physical-device-checklist.md`.
