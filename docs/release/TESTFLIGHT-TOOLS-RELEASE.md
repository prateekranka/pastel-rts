# Pastel RTS TestFlight and hosted-tools release contract

Date: 2026-09-06
Owner: Bottymcbotface
Release branch: `release/testflight-tools-1`
Starting commit: `8b0112de83728970d05cd4683458a8e2b0e16cb3`
Verified product commit: `6e4d5804999f949710ebf59cc507befff91b1b26`

## Goal

Deliver the verified M1.1 iPad build through TestFlight. Give Bobby tap-ready access to the game and all M1.1 Foundry surfaces without requiring Bobby to run terminal commands.

## Release surfaces

1. **TestFlight app:** iPad-only SwiftUI/WKWebView shell. The game runtime and Pack v2 stay bundled and work without a network connection.
2. **Hosted studio:** `https://pastel.contenthelper.in/` provides a touch-friendly launcher, the bundled game, the Foundry library, unit editor, building editor, and content-service status.
3. **Native tool links:** the existing Developer sheet contains explicit links that open the hosted studio and browser playtest in Safari.

## Security and persistence

- The writable hosted studio must require authentication before it serves HTML, assets, or content API responses.
- Cloudflare Access is not enabled on the account. This release uses an application-level password gate. It does not change account-wide identity or permission policy.
- The public hostname reaches a loopback-only gateway through a named Cloudflare Tunnel.
- The content server writes to a dedicated runtime copy under the service account home. It must not write to the Git worktree.
- Credentials, tunnel secrets, generated profiles, archives, and signing material must not enter Git.
- The gateway and tunnel restart automatically after host restart. Bobby only needs Safari or the TestFlight app.

## Required iOS release metadata

- Product name: `Pastel RTS`
- Bundle identifier: keep `com.pastelrts.app` unless Apple reports that it is unavailable.
- Apple team: `4JRB53LG5C`
- Marketing version: `0.0.1`
- Build number: use the next unused TestFlight build number for version `0.0.1`.
- Minimum iOS: 17.0
- Device family: iPad only
- Encryption declaration: the app uses no non-exempt encryption.
- App icon: use the existing Pastel RTS cube mark. The App Store icon must be opaque and valid at 1024×1024.

## Invariants

### Simulation and determinism

- Do not change `packages/simulation/**` or `packages/navigation/**`.
- Do not change tick rules, command ordering, checksums, random state, entity IDs, scenario data, or replay formats.
- Save/load and bug-bundle formats remain byte-compatible.

### Input and rendering

- Do not change touch arbitration, camera controls, renderer selection, map size, zoom stops, sprites, terrain, or gameplay HUD behavior.
- The TestFlight app must load `pastel://game/index.html`, not a remote game URL.
- Hosted links open in Safari. They do not replace the bundled WKWebView source.

### Performance

- No remote request is added to the native game startup or frame loop.
- The only native runtime changes are release configuration, app icon resources, and user-initiated external links.
- Physical-device frame-time claims remain pending until measured on Bobby’s iPad.

### Scope preservation

- Do not start M2–M7, E1, or N1.
- Do not add combat, fusion, Worldfold, economy, or a new editor framework.
- Do not merge PR #3 or PR #4 as part of this release.
- Do not modify the dirty evidence work in `/home/bobbyranka/Projects/pastel-rts`.
- Do not add new test files. Use existing tests and direct runtime checks.

## Small implementation pieces

### R1 — Native release shell

Allowed paths:

- `apps/ios-shell/**`, except bundled generated `WebGame/**` unless produced by `npm run ios:sync-web`
- release documentation only

Deliver:

- Team and App Store export settings.
- Opaque App Store icon resources based on the existing cube mark.
- `ITSAppUsesNonExemptEncryption = false`.
- Two clear touch targets in the Developer sheet: **Open hosted studio** and **Open browser playtest**.
- Keep the bundled source selected in Release.

### R2 — Authenticated hosted studio gateway

Allowed paths:

- `scripts/**`
- root `package.json` only if one launch script is needed
- release documentation only

Deliver:

- A Node 22 gateway that serves a small launcher at `/`, game build at `/game/`, Foundry build at `/foundry/`, and proxies `/dev-content/` to the loopback content server.
- Correct HTML, JavaScript, CSS, JSON, PNG, SVG, and source-map MIME types.
- Basic authentication with constant-time password verification from environment configuration.
- Traversal-safe static file resolution, no directory listings, no credential logging, and streamed SSE/request bodies.
- Health route suitable for service readback.

## Acceptance evidence

### Source and web

- `git diff 6e4d580..HEAD -- packages/simulation packages/navigation` is empty.
- Existing `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` pass.
- `npm run ios:sync-web` and copied Pack v2 validation pass.
- Unauthenticated hosted requests return `401`.
- Authenticated `/`, `/game/`, `/foundry/`, `/dev-content/health`, and one critical asset for each app return the correct status and MIME type.
- A real browser opens the hosted launcher, enters Foundry, opens each M1.1 tool route, launches the interaction sandbox, and records zero page or console errors.
- One draft mutation and revert are exercised against the dedicated hosted copy, not repository content.

### Native and TestFlight

- Generate the Xcode project from `project.yml` on the paired Mac.
- Compile and launch on an iPad simulator.
- Confirm the bundled runtime renders, the Developer sheet opens, and both hosted links are present and tappable.
- Archive with Apple Distribution signing for team `4JRB53LG5C`.
- Export and validate the IPA.
- Upload to the existing or newly created `Pastel RTS` App Store Connect record.
- Wait for Apple processing. Require a valid processed build before assigning it to an internal TestFlight group.
- Confirm Bobby’s available App Store Connect tester account can install the build.

## Completion boundary

A successful upload command is not completion. Completion requires a processed TestFlight build assigned to a tester group, live authenticated tool URLs exercised in a browser, and truthful updates to `PROGRESS.md`. Physical iPad gameplay and frame-time validation remain pending until Bobby opens the build on the actual device and returns the device report.
