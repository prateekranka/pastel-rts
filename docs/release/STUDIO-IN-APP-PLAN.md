# In-App Studio — Reviewed Implementation Plan

Date: 2026-09-06
Branch: `release/testflight-tools-1`
Review base: `88b7215620eb73f0e92fb48ba3f75a7be39ca8eb`
Historical App Store Connect record: `6809144687` (Pastel RTS, bundle `com.pastelrts.app`)
Historical TestFlight record: `0.0.1 (1)` — VALID, internal group `Pastel RTS Internal Testers`
Target of this plan: version `0.0.1` build `2`

Plan file: `docs/release/STUDIO-IN-APP-PLAN.md` (this document)

> **REVIEW COMPLETE. PLAN-ONLY COMMIT AND PUSH AUTHORIZED.**
> The user will hand implementation to grok 4.6 xhigh using composer 2.5
> subagents. This review/publication session must not start implementation.
> The implementation owner should start only on the user's explicit handoff;
> archive, upload, and release publication require separate authorization.

## 1. Objective

Bobby wants every game development tool in one place. Today the Pastel RTS
iPad app contains only the bundled Interaction Lab. The hosted studio (launcher,
browser playtest, Foundry library, unit editor, building editor, content status)
opens in Safari through links in the Developer sheet.

This plan adds a **Studio tab** to the app. The app then contains the game and
the full hosted tool set. Safari is no longer required for the tools.

Decision record: user direction 2026-09-06. Committed in PROGRESS.md as R3.4
(commit `f182b2d`).

## 2. Current source state and historical release record

### Native shell (verified in this checkout at the review base)

- `PastelRTSApp.swift` — app entry.
- `ContentView.swift` — root view. Full-screen `GameWebView`, a gear button in
  the top-right corner, and a SwiftUI sheet that presents `DeveloperPanel`.
  No tab structure exists.
- `GameWebView.swift` — one `WKWebView`. Configuration:
  - registers `pastelBridge` message handler,
  - `allowFileAccessFromFileURLs = true`,
  - registers `PastelSchemeHandler` for the `pastel` scheme,
  - scroll disabled, game-sized, scene-phase pause/resume to JS.
- `PastelSchemeHandler.swift` — serves the bundled web build over `pastel://`.
- `DeveloperPanel.swift` — sheet with runtime source picker (bundled vs debug
  Vite host), renderer preference, haptics toggle, Apply & Reload, last
  performance report, last runtime error, and two SwiftUI `Link` rows that open
  the hosted studio in Safari.
- `DeveloperConfig.swift`, `NativeBridge.swift` — config persistence and the
  JS bridge contract.
- `project.yml` (XcodeGen): `CURRENT_PROJECT_VERSION: 1`,
  `MARKETING_VERSION: 0.0.1`, iPad only, iOS 17.0 min, team `4JRB53LG5C`.
- XcodeGen includes Swift files under `PastelRTS/` automatically. Adding native
  Studio source does not require a generated project or source-list edit.
- Release launch: bundled `pastel://game/index.html` with
  `mode=interaction-lab&content=bundle&scenario=interaction-lab-alien-fantasy&seed=42`.

### Hosted studio (historical release-record facts; not live reverified here)

- Historical public URL: `https://pastel.contenthelper.in`. Prior release
  records describe a Cloudflare Tunnel to a loopback gateway, but this review
  did not live-trace the public hostname to its current host.
- Coordinator process evidence for this review shows Linux processes for
  `node scripts/hosted-studio-gateway.mjs` and `cloudflared`. The coordinator
  also reports that Mac SSH is reachable. These observations do not identify
  which host currently serves the public hostname. Reverify the active host and
  public route before the authentication spike.
- The gateway uses HTTP Basic authentication with an environment-supplied
  username and password. The README launch example uses username `studio`, but
  the active service username is not recorded in Git. The password is not in
  Git. Its active service environment or service configuration must be located
  on the verified active host without reading, copying, or printing the
  password (open item 8.1).
- Routes: `/` launcher, `/game/` game build, `/foundry/` Foundry build,
  `/dev-content/` content API proxy. Health route exists.
- The release record says the studio worked from an iPad browser during that
  release run. This review did not repeat the browser check.

### ASC state (historical release-record facts; not live reverified here)

- App `6809144687`; build `0.0.1 (1)` is VALID, `usesNonExemptEncryption=false`,
  `internalBuildState=READY_FOR_BETA_TESTING`, expiry 2026-12-05.
- Tester `prateek.ranka@gmail.com` is INVITED and the build is assigned to the
  tester. Internal group `Pastel RTS Internal Testers` exists.
- Internal TestFlight needs no App Review.

## 3. Goal, non-goals, acceptance criteria

### Goal

The app shows two tabs: **Game** and **Studio**.

- Game tab: the current bundled Interaction Lab. Gameplay, save/replay,
  rendering, input, and offline behavior stay identical to build 1. The native
  tab bar is the only intended viewport change.
- Studio tab: an in-app web surface that loads `https://pastel.contenthelper.in`
  and lets Bobby use every hosted tool without leaving the app.
- Studio is lazy. The app creates no Studio web view and makes no Studio network
  request until the user first selects Studio. With no stored credential, it
  makes no request until the user taps Sign In.
- Studio login: the first time Bobby opens Studio without a stored credential,
  the app shows a secure password field. On success the app stores the password
  in the iOS Keychain and answers the Basic-auth challenge automatically on
  later visits.

### Non-goals

- No change to Foundry, the game runtime, content packs, or the gateway.
- No change to simulation, navigation, input, rendering, or replay formats.
- No shared native bridge, URL scheme handler, web configuration, or mutable
  state between Game and Studio.
- No new gameplay features (M2–M7 stay inactive).
- No App Store submission.
- No change to the hosted studio's own authentication design.

### Acceptance criteria (all must pass for code acceptance)

1. The app builds and runs on the dedicated iPad A16 simulator
   (`46C781B1-AEC3-4B64-A9DE-D1A087715FA5`) in Debug and Release
   configurations generated from `project.yml`.
2. A clean launch selects Game and loads the bundled Interaction Lab. Safari Web
   Inspector or equivalent network evidence shows no request to
   `pastel.contenthelper.in` before Studio is selected and no remote request in
   the bundled game's startup or frame loop.
3. Game selection still works, Army Rail changes from 0 to 1 after a unit tap,
   and save/load plus replay check still pass. The tab bar does not cover game
   controls in either supported landscape orientation.
4. Switching to Studio pauses the bundled simulation through the existing
   native pause contract. Returning to Game resumes it without a tick or clock
   jump. App inactive/background state must not resume Game while Studio remains
   selected.
5. With no Keychain item, selecting Studio shows the login form and makes no
   web request. A password is never included in a URL, log, error, pasteboard,
   UserDefaults, source file, or generated project.
6. Correct credentials produce one authenticated Studio session. The launcher,
   `/foundry/#/library`, unit editor, building editor,
   `/dev-content/health`, and a game sandbox all load in the controlled in-app
   surface. Same-origin `target=_blank` and `window.open` actions work without
   opening Safari.
7. Foundry reports Content connected. JavaScript confirm and prompt flows work,
   and the PNG file chooser opens and can be cancelled. One existing draft
   metadata value can be changed and restored, proving authenticated write and
   readback without adding an art asset.
8. A wrong password produces one clear error, does not invoke a system login
   prompt or an authentication loop, and leaves no Keychain item. A retry with
   the correct password succeeds in a fresh Studio web session.
9. After successful authentication and a full app termination/relaunch,
   selecting Studio loads without another password prompt. The app still makes
   no Studio request before that selection.
10. If a stored password is rejected because the gateway credential changed,
    the app deletes that Keychain item, destroys the failed web session, and
    returns to the login form.
11. Log Out is present. It deletes the Keychain item, destroys the authenticated
    web session, and shows the login form without an automatic re-authentication.
12. Tunnel-down, timeout, TLS, and offline failures show a sanitized message and
    Retry. Game remains usable offline. Retry does not store an unverified
    candidate password.
13. Studio top-level navigation is limited to HTTPS on
    `pastel.contenthelper.in`. HTTP redirects, external hosts, `file:`,
    `pastel:`, and other schemes are rejected. Auth credentials are supplied
    only to the expected HTTPS Basic-auth protection space.
14. Code review confirms Studio has its own `WKWebViewConfiguration`,
    `WKUserContentController`, website data store, delegates, and lifecycle. It
    has no `pastelBridge`, `PastelSchemeHandler`, or file-access preference. The
    Game web view keeps its existing configuration and bundled launch URL.
15. Twenty Game/Studio switches do not reload or reset Game and do not create
    extra live web views. Retry and Log Out release the replaced Studio web
    view, delegates, and observers before a new session is created.
16. `git diff 6e4d580..HEAD -- packages/simulation packages/navigation` stays
    empty. The feature delta from the recorded implementation baseline changes
    source only under `apps/ios-shell/**` and changes release documentation only
    under `docs/release/**` plus the required factual `PROGRESS.md` update.
17. No new test files are added. Existing checks and direct simulator/runtime
    checks provide the evidence.

## 4. Design

### 4.1 Tab structure

Replace the root layout with a selection-bound `TabView`:

- Tab 1 — Game: the existing `ContentView` game surface (or its body),
  unchanged behavior.
- Tab 2 — Studio: a new `StudioView` hosting a second `WKWebView` that loads
  `https://pastel.contenthelper.in/`.

Keep the gear/Developer sheet available on the Game tab exactly as today.
Do not route the game web view to any remote URL.

The root view owns the selected tab and whether Studio has ever been opened.
Do not rely on SwiftUI to construct the second tab lazily. Before first Studio
selection, render a local placeholder/login state instead of `StudioWebView`.

Keep the Game web view alive so switching tabs does not reset the match. Its
effective activity is `scenePhase == .active && selectedTab == .game`. Send the
existing native pause/resume message only when that value changes. This avoids
an unconditional scene-active resume while Studio is selected. Do not change
the JavaScript bridge or simulation.

The app is iPad-only, full-screen, and landscape-only in `project.yml`. iPad
Split View is therefore not a supported state for this milestone. Verify both
landscape orientations. Treat the tab bar as an intentional native layout
change, but do not allow it to cover or disable game HUD controls.

### 4.2 Studio web view

New file `StudioWebView.swift` (UIViewRepresentable):

- Own `WKWebViewConfiguration`, `WKUserContentController`, delegates, and
  non-persistent `WKWebsiteDataStore`. Keychain is the only cross-launch Studio
  authentication store.
- Configuration:
  - NO `pastel://` scheme handler.
  - NO `allowFileAccessFromFileURLs`.
  - NO `pastelBridge` script message handler.
  - Scroll enabled (the studio is document-style web UI).
  - JavaScript enabled (required by the launcher and Foundry).
- Create and load it only after explicit Studio selection and an available
  stored or in-memory candidate credential.
- Permit top-level navigation only when URL scheme is `https`, host is exactly
  `pastel.contenthelper.in`, and the port is absent or 443. Cancel redirects and
  navigation to all other origins and schemes. Do not call `UIApplication.open`
  as a fallback in this milestone.
- Use `WKUIDelegate` to load allowed same-origin `target=_blank` and
  `window.open` requests in the same controlled web view. Implement the
  JavaScript confirm and prompt panels that Foundry uses. Completion handlers
  must be called exactly once on every branch.
- Provide back, forward, reload, and Log Out controls. Do not add an address
  bar. Keep control enabled state synchronized with the live web view.
- Retain at most one Studio web view. Session replacement must detach delegates
  and control-state observers so old views and credentials can be released.
- Error state: when the host is unreachable or the tunnel is down, show a
  sanitized message with a Retry button. Keep technical errors out of
  credential-bearing UI and logs. The Game tab keeps working offline.

### 4.3 Studio session, login, and Keychain

One main-thread Studio session owner holds this explicit state:

`signedOut -> authenticating(candidate in memory) -> authenticated(stored)`

An authentication rejection returns to `signedOut` with a bounded error. A
network, timeout, or TLS failure with a stored credential enters a retryable
load-error state without deleting that Keychain item. The same failure with an
unverified candidate clears the candidate and returns to the login form without
storing it. The session must not create a second event/state system or store
Studio state in `DeveloperConfig`.

- When no credential exists, show a login form with a secure password field and
  Sign In. Disable duplicate submissions and ignore an empty password.
- The HTTP Basic identity includes a non-secret username. Confirm the active
  `STUDIO_USERNAME` during the spike without reading or printing the password.
  The repo example is `studio`. Keep the confirmed username as a non-secret
  native constant for build 2; do not add a second user field unless the active
  service differs or is expected to vary.
- On Sign In, hold the candidate password in memory. Do NOT store it before
  validation. Create a fresh Studio web session and load the launcher.
- In `webView(_:didReceive:completionHandler:)`, use a credential only when the
  protection space is HTTPS, the host is exactly `pastel.contenthelper.in`, the
  authentication method is `NSURLAuthenticationMethodHTTPBasic`, and the realm
  is `Pastel RTS Hosted Studio`. Use default handling only for server trust.
  Cancel every other authentication method or protection space so it cannot
  open a system credential prompt. Never send Studio credentials to another
  protection space. Construct `URLCredential` with persistence
  `URLCredential.Persistence.none`.
- Treat `previousFailureCount > 0` as rejection. Cancel that challenge once,
  destroy the failed web session, clear the in-memory candidate, delete a stale
  stored item if one was used, and show the login error. Do not allow WebKit's
  system credential prompt or an infinite retry loop.
- Store a candidate only when both facts correlate to the same initial launcher
  navigation: the candidate was supplied to the expected Basic-auth challenge
  for the protected launcher, and that navigation then received an exact-origin
  main-frame HTTP 2xx response. An unrelated page, redirect, subresource, or
  arbitrary 2xx response must never commit a candidate. Then discard the
  candidate from UI and session state.
- A small Keychain store owns add/update, read, and delete operations. Use a
  generic-password item with service `com.pastelrts.app.studio`, account formed
  from the confirmed username and host, and
  `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`. Distinguish item-not-found
  from other `OSStatus` failures. Show a generic failure; never log the secret.
- Log Out is required. Delete the Keychain item, clear all in-memory credential
  data, destroy the web view/session, and return to `signedOut`.

### 4.4 Credential policy

- The password enters the app only through user typing.
- The password is never written to source, Info.plist, UserDefaults, logs, or
  Git. Keychain only.
- Do not commit any file that contains a credential or a credential hint.
- The active credential is never put in `URLCredentialStorage`, a URL, a query
  parameter, a JavaScript message, or Studio page storage by app code.
- Non-persistent Studio website data and a fresh web session on retry/logout
  prevent cookies or WebKit auth state from bypassing the app's auth state.

## 5. Future implementation order (only after explicit user approval)

If implementation is explicitly approved, record
`IMPLEMENTATION_BASE=$(git rev-parse HEAD)` before code and after the owner has
committed this reviewed plan. Use that value for all feature-scope checks.

Recorded implementation baseline: `c38b23561325225913ca3841ff0ddeb721c27568`.

1. **R4.0 — authentication spike**: on the dedicated simulator, use a minimal
   disposable native surface to confirm the active non-secret username, the
   expected realm, receipt of the WKWebView Basic challenge, correlation of the
   candidate-bearing challenge to the protected launcher's main-frame 2xx, and
   `previousFailureCount > 0` with wrong credentials. Do not add a test file or
   store a candidate. Remove spike-only code before the next piece. If this
   fails, stop and amend the plan before any gateway change.
2. **R4.1 — tab lifecycle**: add the selection-bound tabs, lazy Studio gate, and
   effective Game pause/resume behavior. Prove no Studio request before
   selection and no Game clock jump before continuing.
3. **R4.2 — isolated browser**: add the Studio web configuration, exact-origin
   navigation policy, controls, same-view new-window handling, JavaScript
   dialogs, and error/retry state. Do not add authentication persistence yet.
4. **R4.3 — authentication state**: add the in-memory candidate flow, scoped
   challenge handling, Keychain store/read/delete, stale-credential recovery,
   fresh-session retry, and Log Out.
5. **R4.4 — integrated tool pass**: exercise every launcher surface, Foundry
   connection, same-view sandbox launch, one reversible draft change, both
   landscape orientations, offline Game, and relaunch/logout flows.
6. **R4.5 — release candidate**: run all existing repository checks, generate
   the Xcode project, compile Debug and Release, inspect the complete scope diff,
   update `PROGRESS.md` and this status section with facts, and only then hand
   off build 2 delivery.

Each implementation piece must be independently reviewable and keep the tree
buildable. Implementation commits use the `R4:` prefix. Push and publication
are separate authorized actions; they are not implied by a local pass.

## 6. Verification checklist for a future authorized implementation

- [ ] Record the implementation baseline and prove the feature diff stays in
      the allowed source and documentation paths.
- [ ] `git diff 6e4d580..HEAD -- packages/simulation packages/navigation` is
      empty. Existing typecheck, lint, tests, build, `ios:sync-web`, and copied
      Pack v2 validation pass without adding test files.
- [ ] Generate the Xcode project from `project.yml`; Debug and Release compile.
- [ ] Fresh simulator state: Game is selected, the bundled lab loads, Army Rail
      selection works, save/load and replay checks pass, and no Studio request
      occurs.
- [ ] Game pause/resume is verified by tick/time readback while switching tabs
      and backgrounding/foregrounding on each selected tab.
- [ ] No-credential, wrong-candidate, correct-candidate, relaunch, stale-stored,
      logout, timeout, tunnel-down, and retry transitions each pass without an
      auth loop or secret-bearing output.
- [ ] The launcher and all five hosted tool surfaces in acceptance criterion 6
      work in-app. Foundry connects, dialogs work, and a reversible draft edit
      is restored to its original value.
- [ ] Exact-origin policy rejects HTTPS external host, HTTP, `file:`, and
      `pastel:` navigation. A source review confirms the Studio configuration
      contains no game scheme handler, bridge handler, or file-access override.
- [ ] Both landscape orientations remain usable. Split View is marked not
      applicable because the target requires full screen.
- [ ] Twenty tab switches preserve Game state. Memory-graph or equivalent
      lifecycle evidence shows one retained Game web view, at most one current
      Studio web view, and no retained replaced Studio delegates or observers.
- [ ] Review the complete diff and generated app payload for hard-coded
      credential values or credential files. Runtime Keychain data is not part
      of the archive. Do not print or pass a real password on a command line.
- [ ] A signed Release archive and IPA validation are delivery gates. An
      unsigned archive alone is not sufficient release evidence.

## 7. Future build 2 delivery (after authorized code acceptance; separate owner)

Owner: app-dev release owner on the paired Mac. Game-dev hands off only after
R4.5 passes.

1. On the Mac worktree: bump `CURRENT_PROJECT_VERSION` 1 → 2 in
   `apps/ios-shell/project.yml`, after confirming build 2 is still unused in
   ASC. Run `xcodegen generate`. If build 2 is no longer available, record the
   next unused number and amend this plan before archive or upload.
2. Archive + export the IPA (existing signing recipe, team `4JRB53LG5C`).
3. Upload with `asc builds upload --app 6809144687 --ipa <path>`.
4. Clear export compliance: `usesNonExemptEncryption=false`.
5. Wait for VALID; assign the build to the tester
   (`ec68c7ff-1fe2-4485-9820-1890c5b7bef2`) or the internal group.
6. Confirm `internalBuildState` shows `READY_FOR_BETA_TESTING` or later.
7. Install build 2 from TestFlight on the physical iPad when available. Verify
   Game launch, Studio login, one Foundry read path, logout, and offline Game.
   Physical-device performance remains pending until this step runs; it does
   not block upload or internal tester assignment.
8. Update `PROGRESS.md` with only verified source, archive, upload, processing,
   tester-assignment, and physical-device facts.

## 8. Open items

1. **Active host and Studio credential**: reverify which reachable host serves
   the public gateway. Confirm only the non-secret active username from that
   host's service configuration. Do not read, print, copy, or commit the
   password. Bobby enters it directly in the app.
2. **Release session**: the paired Mac is reported reachable. Native build and
   archive work still require the Mac, and the ASC session may require a fresh
   secure login. Recheck both when implementation and release are authorized;
   this is not a current plan-review blocker.
3. **Studio copy inside the app**: the Studio tab shows the same UI as the
   hosted site today. Tool-specific deep links from the Developer sheet can be
   added later (non-goal now).
4. **Optional polish backlog**: custom tab art, a Studio-specific empty-state
   illustration, and deeper native browser history UI are not required. Use
   standard system tab symbols and text for build 2. No missing nonessential
   art asset blocks implementation or delivery.

## 9. Risks and mitigations

1. **WKWebView Basic-auth behavior**: challenge delivery, realm, rejection, and
   credential reuse for subresources must be proven first. If the spike fails,
   stop. A gateway session route is a possible fallback, but it changes the
   security and gateway scope and requires a separate reviewed amendment.
2. **Wrong-password persistence or auth loop**: storing before validation and
   blindly answering repeated challenges can lock the user out. Mitigation: an
   in-memory candidate, correlation of its expected launcher challenge to that
   navigation's main-frame 2xx, bounded failure count, and a fresh web session
   on failure.
3. **Credential disclosure to another host**: a broad challenge handler or
   redirect could send the Basic credential outside the Studio protection
   space. Mitigation: exact scheme/host/port/method/realm checks and exact-origin
   top-level navigation policy.
4. **Foundry feature loss in WKWebView**: Foundry uses same-origin fetch and
   polling, while its game sandbox uses the hosted content stream. Foundry also
   uses `window.open`, `target=_blank`, `window.prompt`, and `window.confirm`.
   Mitigation: dedicated UI/navigation delegates and integrated checks for
   connection, dialogs, sandbox launch, and one reversible write.
5. **Hidden Game keeps advancing**: TabView visibility is not a simulation
   lifecycle signal, and the current scene-active path resumes Game
   unconditionally. Mitigation: drive the existing pause/resume bridge from the
   combined scene and tab state; verify tick/time readback and CPU behavior.
6. **Eager remote load**: SwiftUI may construct an unselected tab. Mitigation:
   explicit `hasOpenedStudio` gating; prove zero Studio requests before user
   selection and before Sign In when no credential exists.
7. **Tab bar regression**: the native tab bar changes available height and can
   cover touch UI. Mitigation: safe-area layout and both-landscape simulator
   checks. Split View is not applicable while `UIRequiresFullScreen` is true.
8. **Tunnel or content-service outage**: launcher, static assets, or proxied
   content can fail independently. Mitigation: bounded request timeout,
   sanitized Retry state, and separate checks for launcher and Foundry Content
   connected status. Game remains bundled and offline.
9. **Dual-web-view memory and lifecycle**: retaining Game while Studio is open
   increases process and texture memory. Retry/logout can leak old web views
   through delegates or observers. Mitigation: one Studio instance per current
   session, explicit teardown, twenty-switch state check, and memory-graph
   review before release handoff.
10. **Parallel edits**: another session may edit this repo. Record the baseline,
   check status before every patch/commit, and never include another session's
   work.

## 10. Owner review disposition

1. The original acceptance list was not complete. It did not prove lazy remote
   loading, hidden-Game pause, all hosted surfaces, Foundry dialogs/new windows,
   stale credentials, logout, exact-origin navigation, or reversible writes.
   Sections 3 and 6 now make these observable.
2. A separate configuration alone was not a sufficient sandbox. Section 4.2
   now requires separate user-content and data stores, no bridge, an exact-origin
   policy, and scoped challenge handling.
3. The original Keychain order was incorrect because it stored the candidate
   before authentication. Section 4.3 now defines store-after-main-frame-2xx,
   read, update, stale-item deletion, explicit logout, and bounded error paths.
4. The authentication spike remains the correct first action because it tests
   the highest-risk platform behavior before permanent UI and storage work.
5. Tunnel failure, timeout, both landscape orientations, tab-bar layout, and
   auth retry are in scope. Split View is truthfully not applicable under the
   existing iPad full-screen release setting.

If the user later gives explicit implementation approval, follow section 5 in
order and stop at the acceptance criteria. A failed authentication spike or a
required gateway/game-web change then requires a reviewed plan amendment before
more implementation. Until that approval, this document authorizes no action
beyond plan review.

## 11. Status

- [x] Decision recorded (R3.4, `f182b2d`)
- [x] Plan written (this document)
- [x] Owning game-development review completed; plan amended only
- [x] Explicit user approval to implement
- [x] Spike: live gateway 401/realm verified; WKWebView challenge deferred to Mac simulator
- [x] Tab structure implemented
- [x] Studio web view implemented
- [x] Login + Keychain implemented
- [ ] Acceptance criteria passed on dedicated iPad A16 simulator
- [x] GitHub Actions iOS Simulator Debug compile passed (`20b0096`)
- [ ] Build 2 uploaded and assigned (app-dev + Mac)
