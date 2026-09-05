# M1.1 progress

M1.1 only. M2–M7 remain inactive. E1 and N1 need separate approval. No merge or roadmap advancement is authorized.

## Current gate

Local functional checks pass. Overall ENGINEERING PASS remains pending current CI and the final independent review receipt. HUMAN DESIGN ACCEPTANCE and PHYSICAL-DEVICE VALIDATION remain pending.

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

Remote CI run 33975185566 at 9a17c16 failed because it ran the full developer-workbench suite against production preview. The compiled Foundry origin was 5173, while the harness expected 4173; developer-only controls differed from the framing baseline; studio lifecycle tests were skipped by mode. Luna lane M owns the narrow workflow correction: full developer-mode suite plus a separate real offline-preview check. No test or security gate may be removed.

The independent K reviewer initially mistook Playwright's deliberate magenta diagnostics mask for a render defect. The real unmasked screenshot has the teal diagnostics panel. K is checking this provenance and writing the final independent verdict. Human design acceptance is not delegated.

An unchanged native pause timing assertion failed once while separate SwiftShader browser runs overlapped. It passed in the complete isolated rerun, without threshold or source changes. The failure evidence remains under docs/roadmap/M1.1-native-pause-failure. Desktop software-renderer results do not prove iPad timing.

## Routing and publication

Coordinator: gpt-6-astra/openai-codex, CLI-requested medium, fast off. Workers: explicitly pinned gpt-5.6-luna/openai-codex, requested max, fast off. Recovery smoke session 20260905_185350_ad6f16 succeeded. No provider, profile, credential or security configuration was changed. Session metadata is retained where available; unavailable raw wire fields are not claimed.

Draft milestone PR: https://github.com/prateekranka/pastel-rts/pull/4
Base remains the unmerged M1 prerequisite PR #3. No existing PR was merged.

Built web archive:
/home/bobbyranka/Projects/pastel-rts/artifacts/m1.1/pastel-rts-m1.1-d23642d-web.tar.gz
This contains built game and Foundry static files. Studio editing still needs the source content server. It is not an iOS binary.

Walkthrough: docs/roadmap/M1.1-WALKTHROUGH.md.

Existing macOS CI has compiled the simulator target. Linux cannot provide an Xcode simulator launch or physical iPad validation. Final native CI status still needs exact-current-run confirmation. No physical performance, human design pass, or whole-milestone completion is claimed.

All user work, retained lane worktrees and remaining uncommitted evidence stay in place. No later milestone or optional experiment was started.
