# Pastel RTS

A touch-first science-fantasy real-time strategy game for iPad.

The first playable biome is **Alien Fantasy**: clean teal terrain, oversized alien flora, crystal resources, spatial magic, gravity weapons, and two visually distinct civilizations.

## Current milestone

**Milestone 1 — touch command sandbox and Pack v2 authoring** (no combat). See `docs/milestone-1.md`.

Milestone 0 platform proof remains the default URL (`docs/milestone-0.md`). Interaction Lab is opt-in via `?mode=interaction-lab`.

Physical iPad status: **awaiting physical validation**. Do not treat desktop FPS as device proof.

## Setup

Requires Node **22** (see `.nvmrc`). npm workspaces — do not switch to pnpm, Yarn, Bun, or Turborepo.

Lockfile install (the root install step):

```bash
nvm use
npm ci
```

Root scripts: `npm ci` (install), `npm run dev`, `npm run build`, `npm run typecheck`, `npm test`, `npm run test:visual`, `npm run lint`.

## Game runtime (Three.js)

```bash
npm run dev          # Vite at http://127.0.0.1:5173
npm run preview      # production preview (run npm run build first)
```

Useful query flags:

| Flag | Example | Meaning |
| --- | --- | --- |
| `mode` | `?mode=interaction-lab` | Milestone 1 sandbox (omit or `benchmark` keeps Milestone 0) |
| `renderer` | `?renderer=webgpu` | WebGPU benchmark path (falls back to WebGL) |
| `benchmark` | `?benchmark=dense-battle` | idle-base, normal-midgame, dense-battle, camera-pan-stress, maximum-population, 2x-stress, 20-minute-soak, visual-capture |
| `dpr` | `?dpr=1.5` | 1, 1.25, 1.5, native |
| `zoom` | `?zoom=70-percent` | Named camera stop |
| `seed` | `?seed=1` | Deterministic placement |
| `touchDebug` | `?touchDebug=1` | Pointer / gesture overlay |
| `soakMs` | `?soakMs=5000` | Short soak for tests only |
| `spawnUnit` | `?spawnUnit=sunweaver-infantry` | Foundry Test-in-sandbox spawn (lab only) |
| `spawnBuilding` | `?spawnBuilding=sunweaver-sanctum` | Foundry building placement (lab only) |
| `scenario` | `?scenario=interaction-lab-alien-fantasy` | Named Pack v2 scenario (lab only) |

Interaction Lab (deterministic seed 42):

```bash
# http://127.0.0.1:5173/?mode=interaction-lab&seed=42&renderer=webgl&dpr=1&zoom=70-percent
```

Commands are recorded in the lab. Replay checksums: Army Rail / ReplayInspector, or `runSimulationReplay` in `@pastel-rts/simulation`.

## Content Foundry + local content server

Two processes:

```bash
npm run dev:content    # http://127.0.0.1:8787  writes content/dev-pack
npm run dev:foundry    # http://127.0.0.1:5174
npm run dev            # game-web proxies /dev-content to the content server
```

Foundry path: upload one transparent PNG → checkerboard/neutral preview → auto bounds → set id, name, faction, anchor, world height, selection radius → save. The server writes PNG + `manifest.json` and notifies game-web over SSE so the proxy hot-reloads without editing runtime source.

Pack v2 (units, buildings, animation sheets): Foundry also writes `content/dev-pack-v2`. **Test in sandbox** opens game-web with `mode=interaction-lab` and `spawnUnit=` / `spawnBuilding=`.

```bash
CONTENT_PACK_DIR=content/dev-pack-v2 npm run dev:content
```

## Tests, lint, production build

```bash
npm run typecheck
npm run lint
npm test                 # unit tests (schema + runtime)
npm run test:visual      # production build + Playwright
npm run build            # game-web + foundry production builds
```

Visual tests use a frozen seed, 1280×800 viewport, WebGL, and the `visual-capture` preset. Snapshots live in `apps/game-web/e2e`.

## iOS shell

Checked-in source of truth is **XcodeGen**, not a generated `.xcodeproj`.

```bash
npm run build
npm run ios:sync-web
npm run ios:generate     # requires macOS + `brew install xcodegen`
# or: (cd apps/ios-shell && xcodegen generate && open PastelRTS.xcodeproj)
```

- **Debug:** Developer gear → local Vite host (LAN IP of the Mac running `npm run dev`). WKWebView is inspectable. Unreachable servers show a concrete error.
- **Release / local device:** loads the **bundled** production files through `pastel://` (no network, not a remote production URL).

iOS compile needs macOS + Xcode. Linux cloud agents cannot run `xcodebuild`; CI has a `macos-latest` job that generates the project and compiles for the iOS Simulator.

## Soak test and performance reports

1. Open the runtime with `?benchmark=20-minute-soak` or press **Start 20-min soak** in Diagnostics.
2. Leave the tab visible; camera motion is automatic. Do not continuously pan.
3. When finished, the JSON report downloads. In the iPad app it is also sent as `performanceReport` and saved under Documents/`performance-reports/`.
4. Every report records live viewport, DPR, renderer, user agent, and timestamp. It never hard-codes an iPad model.

Tests may use `?soakMs=2000`. The soak **mode** itself is 20 minutes (`SOAK_DURATION_MS`).

Memory / leak observation: the HUD rolling window is ~5s and idle sample arrays are capped at 10s. Full frame-time series are retained only while a soak/report is recording. On device, use Xcode Memory Gauge or Instruments over the 20-minute soak and confirm object/mesh counts do not climb without bound. `GameApp.dispose()` drops renderer, worker, controls, terrain, entities, and hot-reload GPU resources.

## Connecting a physical iPad

Follow `docs/ipad-physical-device-checklist.md`. Until that checklist is executed on hardware, performance claims stay **awaiting physical validation**.
