# M1.1 progress

ENGINEERING PASS for the specified local and CI scope.
HUMAN DESIGN ACCEPTANCE: PENDING.
PHYSICAL-DEVICE VALIDATION: PENDING.

Stop at M1.1. M2–M7 remain inactive. E1 and N1 need separate approval. No merge or automatic roadmap advancement.

## Verified result

Product commit: `6e4d580`. Native release-shell fixes are at `ff400e3` (`R1.4` and `R1.5`). These fixes only select the locked Interaction Lab route and give successful bundled `pastel://` fetches HTTP status `200`. Simulation and navigation remain unchanged.

- Root typecheck, lint, workspace tests, game/Foundry builds, iOS web sync and copied-pack validation pass.
- Integrated developer browser suite: 32 passed with zero retries. The production-only case passed separately with the content server stopped.
- Current-source CI passes, including iOS simulator compilation: https://github.com/prateekranka/pastel-rts/actions/runs/33984434752
- Bug export reproduces a real pointer movement command in a fresh browser context. Invalid bundles leave the active scene intact.
- The original long soak found texture growth. S repaired disposal ordering. Independent V review found no confirmed blocker in the public lifetime path.
- Q2 ran for 1,205,967 ms with 12 successful publications and acknowledgements. All 1,199 resource samples stayed at 7 textures, 17 geometries and 24 draw calls. No missing art or browser/runtime errors were observed.
- Task workers and owned validation servers are stopped. Unrelated services remain untouched.

## TestFlight release candidate

- Authenticated hosted access is live at `https://pastel.contenthelper.in`. The launcher, browser playtest, Foundry routes, and content health route passed. Unauthenticated requests return `401`.
- All 37 checked hosted responses matched the current local release bytes. Entry HTML is `no-store`. A Chromium iPad-viewport pass reached the game and Unit Editor with zero page, console, or request errors.
- The exact Release build from commit `ff400e3eec04b9293a39e75021d19f30f6782b84` compiled and ran on the dedicated iPad A16 simulator `46C781B1-AEC3-4B64-A9DE-D1A087715FA5`.
- Native readback showed content source `bundle`, revision `3`, scenario `interaction-lab-alien-fantasy`, requested and actual seed `42`, and no init or content error.
- Maestro entered selection mode and selected one `sunweaver-infantry`. Army Rail changed from `0` to `1`.
- A fresh Grok 4.6 XHigh critic returned **PASS-WITH-POLISH**. The single visible gap is workbench chrome density over the battlefield. It is not an M1.1 TestFlight blocker.
- Signed archive: `/Users/prateekranka/Builds/PastelRTS/PastelRTS-0.0.1-1-ff400e3.xcarchive`.
- Validated IPA: `/Users/prateekranka/Builds/PastelRTS/export-0.0.1-1-ff400e3/PastelRTS.ipa`.
- IPA SHA-256: `b58e3a9e9002527bf9bf6f0a9a08cf1df7c10d125519e9ed88c59f7634cc4a95`.
- IPA identity: `com.pastelrts.app`, version `0.0.1`, build `1`, iPad-only, team `4JRB53LG5C`, `get-task-allow = false`. Signature, provisioning profile, all 34 release files, executable UUID, and dSYM passed independent payload validation.
- TestFlight upload is **blocked**, not complete. Apple has no Pastel app record. The required `eshabhoon@gmail.com` web session is not authenticated and has no stored password. The exact requested tester address `prateek. ranka@gmail.com` is malformed; no tester was added.
- The physical iPad remains unavailable to `devicectl`. Physical touch and target-device frame-time validation remain pending.

## Build and records

Build:
`/home/bobbyranka/Projects/pastel-rts/artifacts/m1.1/pastel-rts-m1.1-6e4d580-web.tar.gz`

SHA-256: `2e02a5a14164356b1a1fcadc6580805aed842d8416538b3fa3f92780e772c283`

Gate, commands, evidence, limits and preservation caveat: `docs/roadmap/M1.1-GATE.md`.
Walkthrough: `docs/roadmap/M1.1-WALKTHROUGH.md`.
Raw long-run result: `docs/roadmap/M1.1-Q2-artifacts/summary.json`.
PR: https://github.com/prateekranka/pastel-rts/pull/4

The original M1.1 web archive contains web builds, not a native iOS binary. The separate signed TestFlight release candidate is listed above. Foundry authoring uses the dedicated hosted content service. A simulator run is not a physical-device run. Linux SwiftShader and simulator timings are not iPad performance evidence.

## Remaining decision

Retain this build for the M1.1 human walkthrough and physical iPad check. Simulator native behavior and one touch-selection path pass. Human design acceptance, physical-device behavior, broader touch coverage, and target-device performance remain open. TestFlight completion also requires an Esha web login, app-record creation, upload processing, and tester assignment. No later milestone starts automatically.

Numbered input documents and simulation/navigation source remain unchanged from their recorded baselines. Loose artifacts and logs remain in place; the working tree is not claimed clean. The early capture-name reuse and other evidence limits are documented in the gate record.
