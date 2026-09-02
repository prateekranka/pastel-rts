# Milestone 1 — Touch Command Sandbox and Production Content Authoring

Milestone 1 turns the Milestone 0 stress battlefield into a **deterministic touch command sandbox** plus **Pack v2 content authoring**. Combat, economy, and AI are out of scope.

Physical iPad status: **awaiting physical validation**. Do not treat desktop FPS as device proof.

## Modes

| Query | Meaning |
| --- | --- |
| *(omitted)* or `mode=benchmark` | Milestone 0 dense battlefield (default). |
| `mode=interaction-lab` | Milestone 1 sandbox. |

All Milestone 0 flags remain valid (`benchmark`, `renderer`, `dpr`, `zoom`, `seed`, `touchDebug`, `soakMs`). Interaction-lab is opt-in.

## What landed

- **Pack v2** in `@pastel-rts/content-schema` with faction ids `sunweaver` / `gravemark` / `neutral`, unit + building archetypes, v1 migration, maps/scenarios.
- **Deterministic simulation** (`packages/simulation`) at 20 Hz: index+generation ids, command envelopes, checksums, replay.
- **Navigation** (`packages/navigation`) on the 160×160 grid: A\* (worker-only), building blockers, formation slots, replan after placement.
- **Foundry + content-server**: v1 PNG path kept; v2 unit/building authoring; `GET /pack?schema=2`; Test in sandbox launches `mode=interaction-lab`.
- **Touch + HUD**: tap select, double-tap same type, lasso, pan vs command, formation hold-drag, Army Rail, minimap.
- **Interaction Lab**: named scenario `interaction-lab-alien-fantasy`, spawn/place palettes, placement ghost, replay inspector, nav debug overlay.
- **Composition root**: `GameApp` constructs `MatchRuntime` + `createInteractionLab` only when `mode=interaction-lab`. Benchmark mode still uses the Milestone 0 20 Hz orbit worker.

## Architecture

Simulation and A\* run in `apps/game-web/src/app/matchWorker.ts`. The main thread interpolates transferred `Float32Array` snapshots (stride 12) and never calls `requestPath`. Placement preview uses occupancy `isWalkable` only.

iOS bridge message types are unchanged. `requestHaptic` may include an optional `reason` of `selection` | `move` | `place` | `invalid` in addition to `style`.

## Commands

```bash
nvm use
npm ci

# Milestone 0 battlefield (default)
npm run dev

# Interaction Lab
# http://127.0.0.1:5173/?mode=interaction-lab&seed=42&renderer=webgl&dpr=1&zoom=70-percent

# Foundry + content server
npm run dev:content    # 127.0.0.1:8787  (CONTENT_PACK_DIR defaults to content/dev-pack)
npm run dev:foundry    # 127.0.0.1:5174
# Test in sandbox opens game-web with mode=interaction-lab&spawnUnit=<id>

# Replay / checksums
# In the lab, commands are recorded. Playwright asserts replayFromCommandLog / ReplayInspector.
# Programmatic: runSimulationReplay in @pastel-rts/simulation

npm run typecheck
npm run lint
npm test
npm run build
npm run test:visual
npm run ios:sync-web
npm run ios:generate   # macOS + xcodegen; Linux agents rely on GHA ios job
```

## Interaction Lab demo

Scenario `interaction-lab-alien-fantasy`: 12 Sunweaver infantry, 1 walker, 8 Gravemark infantry, 1 walker, 3 buildings, static obstacles with a narrow and a broad passage.

Suggested sequence: lasso six Sunweaver units → tap beyond an obstacle → hold-drag a line formation → Place a building across the route → Stop → replay checksums (automated).

## Honesty

No 60 fps claim is made for the 11-inch iPad. Reports still use `physicalValidationStatus: awaiting-physical-validation`.

Milestone 2 recommendation: **combat** (attacks, HP, death) on top of this command/nav/content stack — not implemented here.
