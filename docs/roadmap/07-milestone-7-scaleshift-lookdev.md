# M7 — Scaleshift, artwork replacement and real iPad evidence

Read and apply docs/roadmap/00-astra-luna-contract.md. Prerequisite: retained integrated slice. Astra orchestrates/reviews; Luna Max Fast implements.

GOAL
Make the actual playable game—not generated trailer imagery—look coherent and feel good from strategic view to close-up unit viewing. Preserve the user's ability to admire units while playing.

DELIVER
- Continuous pinch zoom with readable preferred stops. At distance, aggregate markers without changing simulation entities; close up, reveal authored unit detail. Add hysteresis to prevent flickering between representations.
- Selection and all core commands survive zoom transitions. Never require a special camera scale to fuse, build, fold, stop or activate an organism. Provide deliberate contextual targeting when distant objects overlap.
- A production-ready path to replace proxy art under stable IDs: directional clips, shadows, anchors, damaged/construction states and clear missing-art reports. Do not claim stills contain locomotion.
- Verify draw order and occlusion near tall buildings, folded terrain and large flora; selected units remain locatable. Art must not determine collision or navigation.
- Profile actual content across WebGL and available WebGPU, touch, background/resume and bundled offline WKWebView mode. Fix measured regressions rather than adding expensive post-processing.

TOOLS
Add Look Development workspace: real-scene previews, palette/biome settings, environment density, unit scale, animation timing, effect intensity/duration, UI scale and LOD thresholds. Separate aesthetic preferences from authoritative rules.

Add a pinned-reference side-by-side view for human art review, not an automated "matches concept art" claim. Store approved presets and deterministic camera bookmarks.

Add Replay Capture tools: hide/show HUD, normal-speed camera tracks, stills, and supported local recording or frame-sequence export. State actual capture resolution/frame rate; never label an interpolated capture as proof the device renders at 60 fps.

LUNA TASKS
A: scale-aware presentation, selection continuity and touch regression tests.
B: artwork pipeline, animation/occlusion and Look Development controls.
C: capture, packaging, profiling fixtures and device QA documentation.

ACCEPTANCE
Replace one unit, one building and one environment landmark without engine edits. Verify close-up walking, distant readability, no terrain-detail noise and consistent selection. Run a release-build 20-minute soak on the actual iPad when available, logging hardware/OS, conditions, renderer, quality and frame-time distribution. Otherwise mark the hardware gate pending.

Produce a short actual-gameplay capture and a plain list of remaining art assets. This is a polished vertical-slice gate, not an App Store launch claim. Do not build the other two biomes or add headline systems here.
