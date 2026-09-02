# iPad physical-device checklist

Status: **awaiting physical validation.** Do not record FPS or pass/fail
from this environment — there is no attached iPad here.

Use a production web bundle (`npm run build` then `npm run ios:sync-web`) and
the current Xcode project. Confirm the WKWebView loads `index.html` from the
app bundle, not a LAN URL, unless you are deliberately iterating on the Vite
dev server.

## Milestone 0 (still required)

- [ ] Cold start on iPad (Safari and WKWebView) without a laptop on the LAN
- [ ] 160×160 map, 70-percent default zoom, Pointer Events, WebGL (and WebGPU if available)
- [ ] HUD visible; pinch-zoom and two-finger pan; 40-unit dense battle still runs
- [ ] Haptic on first tap (existing M0 `requestHaptic`)
- [ ] No per-frame bridge spam

## Milestone 1 — Interaction Lab (`?mode=interaction-lab`)

- [ ] Tap a unit to select; selection ring visible
- [ ] Double-tap selects nearby units of the same type
- [ ] Lasso (pointer drag on empty ground while not in pan mode) selects multiple units
- [ ] One-finger pan on empty ground does **not** issue a move command
- [ ] Two-finger pinch does **not** issue a move command
- [ ] Tap selected + tap empty terrain issues a move (haptic `move`)
- [ ] Hold-drag on terrain with a group selected previews a formation, then commits
- [ ] Formation destinations are distinct (units do not stack on one cell)
- [ ] Minimap click/drag recenters the camera
- [ ] Army Rail lists selected units
- [ ] Building palette: place and remove a blocker; units replan around it
- [ ] ~40 units move together without the UI locking the main thread
- [ ] Idle vs move sprite animation (directional), not idle-glide
- [ ] Haptics: selection, move, place, invalid (coarse `requestHaptic` only)
- [ ] Replay inspector / save scenario from Army Rail (if using Foundry pack)
- [ ] Perf HUD / `reportPerf` after a 40-unit move — **record numbers on device, do not invent**

## After a session

Attach: iOS version, iPad model, Safari vs WKWebView, renderer (WebGL/WebGPU),
and any FPS / frame-time numbers **measured on hardware**. Update this file
and `docs/milestone-1.md` Physical status.
