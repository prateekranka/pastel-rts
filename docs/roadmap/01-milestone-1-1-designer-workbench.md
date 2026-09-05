# M1.1 — Verify the foundation and make iteration practical

Read and apply docs/roadmap/00-astra-luna-contract.md. Astra orchestrates/reviews; Luna Max Fast implements.

GOAL
Make the existing Milestone 1 implementation reliable and establish one rapid editing workflow. This is a completion/hardening pass, not a rewrite or a combat milestone.

FIRST VERIFY
Use the actual current M1 source/PR. Exercise PNG and sprite-sheet import, building editing, Test in Sandbox, unit selection, animated movement, blockers, save/load and replay. Check initial content loading AND hot reload, then production preview with the development content server stopped. Inspect the bundled iOS content path. Missing art or disconnected editors must be visible failures, not silent generic proxies labeled complete.

DELIVER
1. A single root dev:studio command starts game, Foundry and content server with clean shutdown and useful port/error messages. Add a connection/status strip with links to each surface.
2. Extend Foundry with shared-library search/filter, reference-image attachment, stable-ID replacement, duplicate, enable/disable, dependency-aware removal, dirty-state warning and undo/redo for current editor changes.
3. Establish Draft -> Validate -> Preview -> Publish revision -> Revert. Preserve original images. Show which runtime/scenario has acknowledged the published revision and whether restarting is required.
4. Use the actual runtime camera projection for gameplay-size preview, including 70-percent, rather than an arbitrary scaled thumbnail. Add ground anchor, collision/selection footprint, frame grid and direction overlays. Keep camera commands consistent across zooms.
5. Add named scenario presets and comparison runs: content revision A versus B, same seed and commands. Export a bounded bug bundle with scene, commands, hashes, diagnostics and reproduction steps. Exclude private local files and credentials.
6. Add content:validate, qa:scenario and qa:bundle root scripts with real implementations and documented inputs. Reuse existing equivalents where appropriate.
7. Include a tiny original fixture pack: at least two genuinely animated units, a large walker proxy and two buildings. No required downloads or fabricated animation. Package it into production web/iOS builds using relative paths, without /dev-content or SSE dependency.

LUNA TASKS
A: verify/harden revision schemas, content publication and packaging.
B: improve existing editor workflows/previews.
C: runtime integration, isolation tests, bug bundles and adversarial QA.
Astra resolves contracts first and integrates sequentially.

ACCEPTANCE
A non-coder replaces artwork under the same ID, changes scale/clip speed, publishes and sees the correct result; reverts without lost source files; reloads the browser with data intact; reproduces a bug from an exported bundle; and opens the fixture scene with the content server offline.

Test invalid/corrupt PNGs, oversized uploads, traversal, missing frames, stale concurrent saves, failed publication, reconnect and repeated replacement disposal. Existing M0/M1 tests still pass. Document unresolved device/touch verification separately. Do not build combat, fusion, folding or a universal editor.
