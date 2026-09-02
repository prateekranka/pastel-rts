# Physical iPad QA checklist (Milestone 0)

Target device: **11-inch iPad**. Landscape. Do not copy numbers from a Mac, Simulator, or desktop browser into a “device” report.

Status for this repository until a device run is filed: **awaiting physical validation**.

## Before the session

- [ ] Install Xcode, XcodeGen (`brew install xcodegen`), Node 22 (`nvm use`).
- [ ] `npm ci && npm run build && npm run ios:sync-web`
- [ ] `(cd apps/ios-shell && xcodegen generate && open PastelRTS.xcodeproj)`
- [ ] Connect the physical iPad. Trust the computer. Select the iPad as the run destination.
- [ ] Confirm **Release** (or a local-device run that loads **bundled** files, not a remote production URL).
- [ ] Record **device temperature at start** (warm/cool to the touch is enough if no sensor app).
- [ ] Record **battery %** and whether it is **charging**.
- [ ] Confirm **Low Power Mode is off**.
- [ ] Note **renderer mode** (WebGL default; optionally retry WebGPU from the diagnostics HUD / developer panel).
- [ ] After launch, copy **viewport CSS size**, **backing-buffer size**, and **DPR** from the diagnostics HUD. Do not type an iPad model’s marketing resolution from memory.

## Runtime checks

- [ ] 5-minute **dense-battle** observation (HUD open). Note rolling FPS, 1% low, frame time.
- [ ] 20-minute **soak** (`benchmark=20-minute-soak` or HUD “Start 20-min soak”). No continuous finger input; periodic camera motion is automatic.
- [ ] Camera **pan** (one finger) and **pinch zoom**; confirm 70-percent default and snap-to-stop after pinch.
- [ ] **Background / resume**: Home out for ~10s, return. Sim should not leap forward.
- [ ] **Memory-growth observation**: Xcode Memory Gauge or Instruments over the soak. Object/mesh counts must not climb without bound.
- [ ] **Saved performance report**: JSON downloaded in Safari/WKWebView or written under the app Documents `performance-reports/` folder. Confirm it contains timestamp, UA, viewport, DPR, renderer.
- [ ] **Sprite shimmer inspection**: pan/zoom slowly across instanced proxies; nearest-neighbour atlas should stay crisp at zoom stops without crawling seams.

## Final status

- [ ] Pass
- [ ] Fail (attach report JSON + notes)
- [ ] **Awaiting physical validation** (default until the boxes above are actually run on device)

## Honesty rule

If the iPad was unavailable, leave the box **awaiting physical validation**. Never invent FPS, thermals, or memory numbers.
