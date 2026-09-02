# Milestone 0 architecture

Milestone 0 is intentionally a platform and frame-budget proof, not a game-rules prototype.

## Runtime boundaries

- **SwiftUI** owns app lifecycle, future menus, local storage, haptics, and the `WKWebView` host.
- **Three.js** owns the complete live match surface, camera, touch input, rendering, stress simulation, and in-match diagnostics.
- The native bridge transports only coarse events. No per-frame entity state crosses the bridge.

## Map scale

- Logical map: `160 × 160` cells.
- Render/pathfinding chunks: `16 × 16` cells.
- Chunk grid: `10 × 10`.
- Default camera preset: `70-percent`, sized so a landscape iPad sees only a portion of the complete battlefield.

## Milestone 0 stress population

- 120 combat-unit placeholders.
- 40 worker placeholders.
- 30 building placeholders.
- 200 instanced environment props.

The normal scene is already a stress scene. A `2x` mode doubles those counts for short profiling runs.

## Rendering strategy

- Orthographic fixed-isometric camera.
- Chunked terrain meshes with frustum culling.
- Instanced unit, worker, building, crystal, mushroom, and monolith batches.
- WebGL is the default renderer.
- WebGPU is a benchmark path selected with `?renderer=webgpu`; initialization failure falls back to WebGL and is shown in the diagnostics overlay.
- Render pixel ratio is capped and can be adjusted without changing CSS-size UI.

## Performance reporting

The runtime records frame-time samples, simulation time, draw calls, triangle count, entity counts, renderer kind, render scale, viewport, user agent, and elapsed time. Reports can be downloaded in a browser or passed to Swift as `performanceReport` events.
