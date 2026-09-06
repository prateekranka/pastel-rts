# In-App Studio — Implementation Plan (review by Astra, then implement)

Date: 2026-09-06
Branch: `release/testflight-tools-1`
App Store Connect app: `6809144687` (Pastel RTS, bundle `com.pastelrts.app`)
Current TestFlight build: `0.0.1 (1)` — VALID, internal group `Pastel RTS Internal Testers`
Target of this plan: version `0.0.1` build `2`

Plan file: `docs/release/STUDIO-IN-APP-PLAN.md` (this document)

## 1. Objective

Bobby wants every game development tool in one place. Today the Pastel RTS
iPad app contains only the bundled Interaction Lab. The hosted studio (launcher,
browser playtest, Foundry library, unit editor, building editor, content status)
opens in Safari through links in the Developer sheet.

This plan adds a **Studio tab** to the app. The app then contains the game AND
the full hosted tool set. Safari is no longer required for the tools.

Decision record: user direction 2026-09-06. Committed in PROGRESS.md as R3.4
(commit `f182b2d`).

## 2. Current state (facts, verified 2026-09-06)

### Native shell (this repo, `apps/ios-shell/PastelRTS/`)

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
- Release launch: bundled `pastel://game/index.html` with
  `mode=interaction-lab&content=bundle&scenario=interaction-lab-alien-fantasy&seed=42`.

### Hosted studio (facts from release records)

- Public URL: `https://pastel.contenthelper.in` (Cloudflare Tunnel to a
  loopback gateway on the Mac).
- The gateway uses HTTP Basic authentication with an application-level
  password. The password is NOT in Git. It lives in the gateway environment on
  the Mac. Bobby does not know the value yet (open item 8.1).
- Routes: `/` launcher, `/game/` game build, `/foundry/` Foundry build,
  `/dev-content/` content API proxy. Health route exists.
- The studio works from an iPad browser today (verified in the release run).

### ASC state (facts)

- App `6809144687`; build `0.0.1 (1)` is VALID, `usesNonExemptEncryption=false`,
  `internalBuildState=READY_FOR_BETA_TESTING`, expiry 2026-12-05.
- Tester `prateek.ranka@gmail.com` is INVITED and the build is assigned to the
  tester. Internal group `Pastel RTS Internal Testers` exists.
- Internal TestFlight needs no App Review.

## 3. Goal, non-goals, acceptance criteria

### Goal

The app shows two tabs: **Game** and **Studio**.

- Game tab: the current bundled Interaction Lab. Behavior identical to build 1.
- Studio tab: an in-app web surface that loads `https://pastel.contenthelper.in`
  and lets Bobby use every hosted tool without leaving the app.
- Studio login: the first time Bobby opens Studio without a stored credential,
  the app shows a secure password field. On success the app stores the password
  in the iOS Keychain and answers the Basic-auth challenge automatically on
  later visits.

### Non-goals

- No change to Foundry, the game runtime, content packs, or the gateway.
- No change to simulation, navigation, input, rendering, or replay formats.
- No new gameplay features (M2–M7 stay inactive).
- No App Store submission.
- No change to the hosted studio's own authentication design.

### Acceptance criteria (all must pass)

1. App builds and runs on the dedicated iPad A16 simulator
   (`46C781B1-AEC3-4B64-A9DE-D1A087715FA5`).
2. On launch the Game tab loads the bundled Interaction Lab. No remote request
   occurs at startup or in the frame loop (code-path review + simulator run).
3. The Studio tab shows the login field when no Keychain credential exists.
4. Entering the correct studio password loads the studio launcher and the
   Foundry route works inside the app.
5. Entering a wrong password shows an error and stores nothing.
6. After a successful login and a full app relaunch, the Studio tab loads
   without asking for the password again (Keychain flow works).
7. The Studio web view can never load `pastel://` resources (separate
   configuration, no scheme handler, no file access).
8. The Game web view keeps its current configuration and offline behavior.
9. `git diff 6e4d580..HEAD -- packages/simulation packages/navigation` stays
   empty. No source outside `apps/ios-shell/**` and docs changes.
10. No new test files are added (existing release contract). Verification uses
    simulator runs and direct checks.

## 4. Design

### 4.1 Tab structure

Replace the root layout with a `TabView`:

- Tab 1 — Game: the existing `ContentView` game surface (or its body),
  unchanged behavior.
- Tab 2 — Studio: a new `StudioView` hosting a second `WKWebView` that loads
  `https://pastel.contenthelper.in/`.

Keep the gear/Developer sheet available on the Game tab exactly as today.
Do not route the game web view to any remote URL.

### 4.2 Studio web view

New file `StudioWebView.swift` (UIViewRepresentable):

- Own `WKWebViewConfiguration`:
  - NO `pastel://` scheme handler.
  - NO `allowFileAccessFromFileURLs`.
  - Scroll enabled (the studio is document-style web UI).
  - JavaScript enabled (required by the launcher and Foundry).
- Loads `https://pastel.contenthelper.in/` (launcher).
- Minimal in-app browser controls are acceptable and recommended: back,
  forward, reload. Do not add a browser address bar.
- Error state: when the host is unreachable or the tunnel is down, show a
  readable message with a Retry button. The Game tab keeps working offline.

### 4.3 Studio login and Keychain

- When the Studio view has no stored credential, show a login overlay with a
  secure text field and a Sign In button.
- On Sign In, store the entered password in the Keychain (service scoped to
  `pastel.contenthelper.in`; `kSecAttrAccessibleAfterFirstUnlock`), then reload
  the studio.
- The web view navigation delegate answers the HTTP Basic authentication
  challenge (`NSURLAuthenticationMethodHTTPBasic`) with the Keychain
  credential via `webView(_:didReceive:completionHandler:)`.
- Wrong password: the challenge fails or the gateway returns 401; surface an
  error and do not store the password.
- Log out is optional for this milestone. If included, it deletes the Keychain
  item and returns to the login overlay.

### 4.4 Credential policy

- The password enters the app only through user typing.
- The password is never written to source, Info.plist, UserDefaults, logs, or
  Git. Keychain only.
- Do not commit any file that contains a credential or a credential hint.

## 5. Implementation order (suggested)

1. **Spike first (small)**: verify that WKWebView's navigation delegate
   receives the HTTP Basic challenge for `pastel.contenthelper.in` and that
   answering it with a credential loads the launcher. Do this before building
   the full UI. If the challenge never arrives, stop and record findings
   (see risk 9.1) before continuing.
2. Add the tab structure with a placeholder Studio tab.
3. Add `StudioWebView` with the isolated configuration.
4. Add the login overlay and Keychain store.
5. Wire the auth-challenge handler to the Keychain item.
6. Add error/retry state.
7. Run acceptance criteria 2–9 on the dedicated simulator.
8. Update PROGRESS.md (facts only) and this plan's status section.
9. Commit per checkpoint with the `R4:` prefix (for example
   `R4.1: add Studio tab`), push `release/testflight-tools-1`, and leave the
   tree clean.

## 6. Verification checklist for the implementer

- [ ] `npm`/repo checks unchanged: simulation and navigation diffs empty.
- [ ] Simulator: Game tab loads bundled lab, selection works (Army Rail shows 1
      after a unit tap, as in build 1 evidence).
- [ ] Simulator: Studio tab shows login when no Keychain credential.
- [ ] Simulator: correct password reaches the launcher; `/foundry/` loads.
- [ ] Simulator: wrong password shows error; nothing stored.
- [ ] Simulator: relaunch keeps the session (no second password prompt).
- [ ] Release compile: unsigned Release archive builds on the Mac.
- [ ] No credential string appears in `git diff` output or in the archive.

## 7. Build 2 delivery (after code acceptance; separate owner)

Owner: app-dev (this account) with the paired Mac online.

1. On the Mac worktree: bump `CURRENT_PROJECT_VERSION` 1 → 2 in
   `apps/ios-shell/project.yml`, run `xcodegen generate`.
2. Archive + export the IPA (existing signing recipe, team `4JRB53LG5C`).
3. Upload with `asc builds upload --app 6809144687 --ipa <path>`.
4. Clear export compliance: `usesNonExemptEncryption=false`.
5. Wait for VALID; assign the build to the tester
   (`ec68c7ff-1fe2-4485-9820-1890c5b7bef2`) or the internal group.
6. Confirm `internalBuildState` shows `READY_FOR_BETA_TESTING` or later.
7. Update PROGRESS.md and record a new source record (src-00XX) in the
   life-knowledge-base portfolio note.

## 8. Open items

1. **Studio password value**: Bobby does not know it. Location to check on the
   Mac when it is online: the gateway process environment or its config file
   under the service account home (never commit it; never print it in chat).
   Bobby will enter the password in the app himself when he has it.
2. **Mac availability**: the Mac was offline during this plan's writing. Build
   2 delivery needs it online; the ASC web session may need a fresh secure
   login (user-assisted prompt, same as build 1).
3. **Studio copy inside the app**: the Studio tab shows the same UI as the
   hosted site today. Tool-specific deep links from the Developer sheet can be
   added later (non-goal now).

## 9. Risks and mitigations

1. **WKWebView Basic-auth behavior**: if the navigation delegate does not
   receive the challenge, the login flow cannot work as designed. Mitigation:
   the step-1 spike verifies this first. Fallback if needed: add a tiny
   credential-provisioning route on the gateway that accepts the password once
   over HTTPS and issues a session cookie (gateway change — would need a second
   plan amendment before implementation).
2. **Remote page escaping its sandbox**: mitigated by the isolated Studio web
   view configuration (4.2). Code review must confirm no shared
   `WKWebViewConfiguration` object.
3. **Session loss after relaunch**: WKWebView website data is persistent by
   default; verify during acceptance criterion 6. If the studio session resets,
   the Keychain credential answers the challenge again without user input.
4. **Parallel edits**: another session may edit this repo. Check `git status`
   and `git log --oneline -3` before committing; do not commit another
   session's in-flight work.

## 10. Review instructions for Astra

Review this plan before implementation. Answer these questions:

1. Is the acceptance criteria list complete and testable?
2. Is the WKWebView configuration isolation sufficient?
3. Is the Keychain flow correct and complete (store, read, delete, error)?
4. Is the spike (step 1) the right first action?
5. Are there missing edge cases (tunnel down, auth timeout, iPad rotation,
   split view)?

Then implement in the order in section 5. Stop at the acceptance criteria;
do not expand scope. When blocked, record the blocker in PROGRESS.md and stop.

## 11. Status

- [x] Decision recorded (R3.4, `f182b2d`)
- [x] Plan written (this document)
- [ ] Spike: WKWebView Basic-auth challenge verified
- [ ] Tab structure implemented
- [ ] Studio web view implemented
- [ ] Login + Keychain implemented
- [ ] Acceptance criteria passed on simulator
- [ ] Build 2 uploaded and assigned (app-dev + Mac)
