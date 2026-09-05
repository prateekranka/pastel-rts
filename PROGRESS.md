# M1.1 progress

M1.1 only. M2–M7 remain inactive. E1 and N1 need separate approval. No merge or roadmap advancement is authorized.

## Current gate

Local functional checks and both remote CI runs pass at product commit 8a84af0. K's functional review found no confirmed blocker, but the later long soak exposed unresolved renderer texture growth from 7 to 12. Overall ENGINEERING PASS is withheld. HUMAN DESIGN ACCEPTANCE and PHYSICAL-DEVICE VALIDATION remain pending.

## Verified implementation

The integrated product source is d23642d. It includes safe draft/publication revisions, exact-version runtime loading, restart acknowledgement for rule changes, original animated fixtures, shared projection previews, Foundry workbench controls, library/dependency/reference workflows, scenario and seed controls, save/load/compare, and real bug-bundle export/reproduction. The framing PNG was reconciled at 9a17c16 after review confirmed only intended G control rows differed. No tolerance was changed.

Coordinator execution:

- All workspace typechecks, configured lint, unit tests and both web builds passed.
- `ios:sync-web` and validation of its copied content pack passed.
- Final isolated developer-mode browser run at 9a17c16: 32 passed; one production-only test skipped by mode. No retries.
- Separate production-preview test, without a content server: one passed.
- Real pointer movement was accepted, exported as a non-empty command log, and reproduced in a fresh browser context with the exact checksum sequence. Tampered checksums and mismatched historical revisions were refused without changing the scene.
- Two CLI scenario outputs were byte-identical. Content validation and bug-bundle CLI checks passed.
- Studio startup returned healthy game, Foundry and content endpoints. SIGINT freed all owned ports. Duplicate ports were refused.
- Simulation and navigation packages have no diff from prerequisite 6be785f. Numbered uploads have no diff from preserved input commit f88998d.

Evidence directories: docs/roadmap/M1.1-final-isolated-artifacts, M1.1-final-offline-artifacts, M1.1-G2-coordinator-artifacts, M1.1-final-cli-artifacts. Detailed build and preservation receipt: docs/roadmap/M1.1-d23642d-verification.md.

## Remaining engineering work

Remote CI run 33978204772 at 8a84af0 passed all blocking steps: workspace checks, builds, 32 developer browser tests, the separate production-offline test, and iOS simulator compilation. Run 33978202051 also passed. Receipts are in docs/roadmap/M1.1-release-ci.json and M1.1-release-ci.log. M corrected the test-mode routing; T fixed the actual platform-font wrapping difference with two font-stack declarations. No thresholds or functional assertions were weakened.

The independent K verdict is committed at af81c3b. Its remaining native-pause rerun condition passed in the complete isolated coordinator run. K documentation landed on the coordinator branch rather than the requested review worktree; readback verified only K-prefixed documents/evidence changed. The valid receipt was preserved without history rewrite.

Q completed an actual 1,210,872 ms soak with 12 successful publications and runtime acknowledgements. Rules hash and 25 entities stayed fixed. Raw renderer counts rose from 7 to 12 textures; geometries stayed at 17. S is diagnosing this growth. The only browser console error was a missing favicon 404, assigned to R for a real resource fix. Q's art-ready helper used the wrong diagnostics shape; captured unit/building asset states are ready. Raw failed attempts and the completed-with-blockers summary remain unchanged. No whole-milestone pass.

An unchanged native pause timing assertion failed once while separate SwiftShader browser runs overlapped. It passed in the complete isolated rerun, without threshold or source changes. The failure evidence remains under docs/roadmap/M1.1-native-pause-failure. Desktop software-renderer results do not prove iPad timing.

## Routing and publication

Coordinator: gpt-6-astra/openai-codex, CLI-requested medium, fast off. Workers: explicitly pinned gpt-5.6-luna/openai-codex, requested max, fast off. Recovery smoke session 20260905_185350_ad6f16 succeeded. No provider, profile, credential or security configuration was changed. Session metadata is retained where available; unavailable raw wire fields are not claimed.

Draft milestone PR: https://github.com/prateekranka/pastel-rts/pull/4
Base remains the unmerged M1 prerequisite PR #3. No existing PR was merged.

Built web archive:
/home/bobbyranka/Projects/pastel-rts/artifacts/m1.1/pastel-rts-m1.1-8a84af0-web.tar.gz
SHA-256: e1b5062c63941b830ced8e94e166eee535171327eee9fdde09b3b4a4d4f82065
This contains built game and Foundry static files. Studio editing still needs the source content server. It is not an iOS binary.

Walkthrough: docs/roadmap/M1.1-WALKTHROUGH.md.

macOS CI compiled the simulator target at the current product commit 8a84af0. This is not a simulator launch or physical iPad report. No physical performance, human design pass, or whole-milestone completion is claimed.

All user work, retained lane worktrees and remaining uncommitted evidence stay in place. No later milestone or optional experiment was started.
