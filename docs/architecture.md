# Milestone 0 architecture

Milestone 0 is a platform and frame-budget proof, not a game-rules prototype.

## Runtime boundaries

- **SwiftUI** owns app lifecycle, future menus/navigation, local storage, haptics, and the `WKWebView` host. It must not render a live match HUD or sync entity state every frame.
- **Three.js (game-web)** owns the complete live match surface: battlefield, camera, touch, stress simulation, renderer switching, and in-match diagnostics.
- The native bridge transports **coarse** events only: `gameReady`, `requestHaptic`, `performanceReport`, `runtimeError` (JS→Swift) and `pause`, `resume`, `setDeveloperConfiguration` (Swift→JS).

## Repository layout

The original scaffold only listed `apps/game-web`. Milestone 0 keeps **npm workspaces** and adds packages around that runtime:

```
apps/game-web          Vite + Three.js match runtime
apps/foundry           Content Foundry (PNG → unit proxy)
apps/ios-shell         XcodeGen SwiftUI WKWebView shell
packages/content-schema Shared unit-manifest validation
tools/content-server   Local HTTP+SSE writer for content/dev-pack
content/dev-pack       On-disk development content pack
```

## Map scale

- Logical map: `160 × 160` cells.
- Chunks: `16 × 16` cells, `10 × 10` grid.
- Terrain is **one mesh per chunk**, not one mesh per tile.
- Default camera preset: `70-percent` (~44 cells of ground AABB width; height follows viewport aspect, ~28 cells on a typical landscape iPad aspect).
- The map is larger than the viewport; pan reveals more terrain. Look-at is clamped so the battlefield cannot be lost.

## Stress population

Default dense scene:

- 120 combat-unit placeholders
- 40 worker placeholders
- 30 building placeholders
- 200 instanced environment props

`2x-stress` / `maximum-population` double those counts. `idle-base` is a lighter preset. `visual-capture` freezes motion for Playwright.

## Simulation and render threads

- Simulation runs at a fixed **20 Hz in a Web Worker**.
- The main thread renders at display refresh and interpolates compact `Float32Array` snapshots from the previous snapshot toward the current one, clocked from when the current snapshot arrived.
- Snapshot buffers are pooled in the worker (the in-flight buffer is transferred; the next buffer is preallocated). Simulation entities are pooled across population resets.
- No SharedArrayBuffer / COOP-COEP is required.
- Pause on `document.hidden` and on native `pause`; resume does not fast-forward missed ticks. The first resumed frame is omitted from FPS sampling so a background interval cannot appear as one long frame.
- Foundry SSE (`EventSource /dev-content/events`) is **dev-only**. Production preview and bundled iOS builds do not open that connection.

## Rendering

- Fixed isometric `OrthographicCamera` (no yaw/pitch from the player).
- Instanced sprite-like quads from a generated nearest-neighbour atlas with padding.
- `WebGLRenderer` is the baseline. `WebGPURenderer` is a developer-selected benchmark (`?renderer=webgpu`); availability is checked before the canvas is claimed. If `init()` still fails after a WebGPU context is taken, the canvas is replaced so WebGL fallback can proceed. Failure is shown in diagnostics.
- Default DPR cap is 1.5; presets are 1.0, 1.25, 1.5, and native.

## Content pipeline

Content Foundry uploads one transparent PNG, auto-detects opaque bounds, authors a versioned unit manifest, and POSTs to the local content server. The server writes `content/dev-pack/units/<id>/` and broadcasts over SSE. game-web loads the PNG from disk via `/dev-content` (Vite proxy) and hot-reloads proxy meshes. Blob URLs are not the source of truth.

## Performance reporting

Diagnostics record FPS, 1% low, frame-time percentiles (p95/p99), sim tick duration, snapshot latency, draw calls, triangles, visible chunks/units, renderer, DPR, CSS viewport, backing-buffer size, and elapsed time. Soak mode defaults to **20 minutes** (`SOAK_DURATION_MS`). HUD-started soaks enable the same automatic camera motion as `?benchmark=20-minute-soak`. Tests may pass `?soakMs=` for a short run. Reports include `physicalValidationStatus: awaiting-physical-validation`, live viewport/DPR/UA/renderer/timestamp, `benchmark`, and `autoCameraMotion`. Full sample series are retained only while a report is recording.
