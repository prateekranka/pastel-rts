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
- TestFlight delivery is **available for internal testing**. ASC app `6809144687` (`Pastel RTS`, SKU `PASTELRTS-IOS-2026`) accepted the IPA as build `0.0.1 (1)`, build ID `ca177474-8146-4d8e-9463-6606bba56160`. The build is `VALID`, `usesNonExemptEncryption = false`, and `READY_FOR_BETA_TESTING`; it expires 2026-12-05.
- Internal group `Pastel RTS Internal Testers` contains `prateek.ranka@gmail.com`. The build is assigned directly to that tester. The invitation was resent as `cab33f99-fef9-40b8-a5ab-1cf976234775`; ASC now reports the tester state as `INVITED`. Acceptance remains pending.
- The physical iPad remains unavailable to `devicectl`. Physical touch and target-device frame-time validation remain pending.

## Decision 2026-09-06 — hosted studio inside the app (user direction)

Bobby directed: include the hosted studio as part of the Pastel RTS app so all game dev tools live in one place. No hard blockers were found.

- **UI**: a tab bar with two tabs — Game and Studio. Game keeps the bundled Interaction Lab exactly as it is today. Studio is a separate in-app web surface that loads `https://pastel.contenthelper.in` and gives access to the launcher, browser playtest, Foundry library, unit editor, building editor, and content status inside the app.
- **Studio login**: the app shows a secure password field when no credential exists. After the user enters the studio password once, the app stores it in iOS Keychain and answers the gateway Basic-auth challenge on later visits. Bobby does not yet know the studio password; he will enter it when he has it. No credential file is bundled and no credential enters Git.
- **Security invariant**: the Studio webview must use its own WKWebView configuration without the `pastel://` scheme handler and without local file access. The Game webview keeps `allowFileAccessFromFileURLs` and the pastel handler. A remote Studio page must never read bundled files.
- **Release invariants**: the bundled game remains the primary launch load. Studio use is user-initiated. No remote request joins the game startup or frame loop.
- **Delivery**: this becomes version `0.0.1` build `2` on the same ASC app `6809144687`. Upload needs the paired Mac online and the ASC web session valid. Internal TestFlight only; no App Store submission.

Implementation scope owner: game-dev profile (bottymcbotface) on this repository, native shell (`apps/ios-shell/**`) plus release docs only.

## R4 in-app Studio implementation — 2026-09-06

Implementation baseline (release plan HEAD before R4 source): `c38b23561325225913ca3841ff0ddeb721c27568`.

- Source changes are under `apps/ios-shell/**` plus this file and `docs/release/**`.
- `git diff 6e4d580..HEAD -- packages/simulation packages/navigation` is empty.
- Live unauthenticated `https://pastel.contenthelper.in/` returned HTTP 401 with `WWW-Authenticate: Basic realm="Pastel RTS Hosted Studio"`. The native username constant is the documented non-secret value `studio`. The password was not read, printed, or committed.
- A disposable WKWebView spike was not executed here: this agent is Linux and does not host the dedicated iPad A16 simulator. Spike-only code was not added. The native shell follows the planned challenge contract (`previousFailureCount`, exact protection space, `URLCredential.Persistence.none`, store-after-launcher-main-frame-2xx).
- `CURRENT_PROJECT_VERSION` is `2` for TestFlight build `0.0.1 (2)`.
- GitHub Actions CI passed on `20b0096`: web typecheck/test/build/Playwright and iOS Simulator Debug compile. Push run: https://github.com/prateekranka/pastel-rts/actions/runs/34036944202 PR run: https://github.com/prateekranka/pastel-rts/actions/runs/34036955857
- Dedicated iPad A16 simulator acceptance, Release archive, IPA upload, and tester assignment were not performed on this Linux agent and remain Mac/ASC steps.
- The WKWebView Basic-auth spike remains open until the dedicated simulator run. Live HTTP 401/realm was confirmed.

### R4 follow-up — pause-reason ownership (Astra review, 2026-09-06)

- Astra review of PR #5 at `566d99a` requested independent pause reasons; a background visibility resume could clear a Studio-tab native pause.
- Correction: `PauseGate` in game-web with `native` and `background` reasons; `GameApp` pause/resume only actually pause/resume the sim on the first pause / last resume. Native shell still uses combined scene+tab activity and does not change message types.
- Allowed source for this follow-up: `apps/game-web/src/app/PauseGate.ts`, `PauseGate.test.ts`, `GameApp.ts`, and one case in `apps/game-web/e2e/battlefield.spec.ts`. Plan native-only scope is explicitly amended in `docs/release/STUDIO-IN-APP-PLAN.md`.
- Dedicated iPad / Mac runs must `npm run build && npm run ios:sync-web` before simulator acceptance so the bundled `WebGame` includes PauseGate. That copy is gitignored.
- Local verification on this follow-up: typecheck, lint, 207 unit tests (prior 199 plus 8 `PauseGate` tests), production build, and Chromium battlefield e2e including `background visibility resume does not clear a native pause`. Tick stayed frozen across a visibility resume while native pause remained held.
- WKWebView Basic-auth spike and dedicated iPad A16 acceptance remain open on this Linux agent. Chromium e2e covers the pause-ownership sequence; it is not a WKWebView reproduction. Do not claim those gates passed.
- The password was not read, printed, or committed.

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

Retain this build for the M1.1 human walkthrough and physical iPad check. Simulator native behavior and one touch-selection path pass. Human design acceptance, physical-device behavior, broader touch coverage, target-device performance, and tester invitation acceptance remain open. ASC TestFlight delivery and tester assignment are complete. No later milestone starts automatically.

Numbered input documents and simulation/navigation source remain unchanged from their recorded baselines. Loose artifacts and logs remain in place; the working tree is not claimed clean. The early capture-name reuse and other evidence limits are documented in the gate record.
