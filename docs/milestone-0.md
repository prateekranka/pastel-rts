# Milestone 0 — platform, performance, input, native hosting, content pipeline

Milestone 0 proves the iPad hosting surface. It is **not** a playable game slice. Combat, economy, AI, pathfinding, fog of war, and multiplayer are out of scope.

## Proof goals

1. A large Three.js RTS battlefield can run inside WKWebView on an 11-inch iPad.
2. The runtime can be instrumented for a 60 fps target under representative stress. **Do not claim 60 fps until a report is recorded on the physical device.**
3. Touch pan and pinch zoom feel correct (physical device still required for feel).
4. The runtime can switch between WebGL (baseline) and WebGPU (benchmark, with fallback).
5. Swift and JavaScript exchange coarse lifecycle and performance messages only.
6. A developer can upload a transparent PNG in Content Foundry, configure it as a unit proxy, and hot-reload it into the running battlefield without editing runtime source.
7. The repository has tests, CI, profiling tools, and physical-device QA instructions.

## Physical device status

**Awaiting physical validation.** No 60 fps number in this milestone was measured on an 11-inch iPad. Desktop Chromium instrumentation exists; the soak/report path is implemented and exports JSON with live viewport, DPR, UA, renderer, and timestamp fields.

See `docs/ipad-physical-device-checklist.md`.

## Implemented structure vs original scaffold

The original scaffold (`ae93b6d`) declared an `apps/game-web` workspace and an iOS web-sync script, plus architecture notes. Milestone 0 extends that npm workspace (not pnpm/Yarn/Bun/Turborepo) with:

| Path | Role |
| --- | --- |
| `apps/game-web` | Vite + TypeScript + Three.js match runtime |
| `apps/foundry` | Browser Content Foundry |
| `apps/ios-shell` | SwiftUI WKWebView host (XcodeGen) |
| `packages/content-schema` | Shared unit-manifest schema |
| `tools/content-server` | Local Node server that writes `content/dev-pack` |
| `content/dev-pack` | Development content pack on disk |
| `.github/workflows/ci.yml` | Web + iOS CI |

## Commands

See the root `README.md` for install, dev, foundry, tests, iOS generation, soak, and bundled vs dev-server flows.
