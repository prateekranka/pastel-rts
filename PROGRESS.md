# M1.1 progress

ENGINEERING PASS for the specified local and CI scope.
HUMAN DESIGN ACCEPTANCE: PENDING.
PHYSICAL-DEVICE VALIDATION: PENDING.

Stop at M1.1. M2–M7 remain inactive. E1 and N1 need separate approval. No merge or automatic roadmap advancement.

## Verified result

Product commit: `6e4d580`. Later commits contain evidence and documentation only.

- Root typecheck, lint, workspace tests, game/Foundry builds, iOS web sync and copied-pack validation pass.
- Integrated developer browser suite: 32 passed with zero retries. The production-only case passed separately with the content server stopped.
- Current-source CI passes, including iOS simulator compilation: https://github.com/prateekranka/pastel-rts/actions/runs/33984434752
- Bug export reproduces a real pointer movement command in a fresh browser context. Invalid bundles leave the active scene intact.
- The original long soak found texture growth. S repaired disposal ordering. Independent V review found no confirmed blocker in the public lifetime path.
- Q2 ran for 1,205,967 ms with 12 successful publications and acknowledgements. All 1,199 resource samples stayed at 7 textures, 17 geometries and 24 draw calls. No missing art or browser/runtime errors were observed.
- Task workers and owned validation servers are stopped. Unrelated services remain untouched.

## Build and records

Build:
`/home/bobbyranka/Projects/pastel-rts/artifacts/m1.1/pastel-rts-m1.1-6e4d580-web.tar.gz`

SHA-256: `2e02a5a14164356b1a1fcadc6580805aed842d8416538b3fa3f92780e772c283`

Gate, commands, evidence, limits and preservation caveat: `docs/roadmap/M1.1-GATE.md`.
Walkthrough: `docs/roadmap/M1.1-WALKTHROUGH.md`.
Raw long-run result: `docs/roadmap/M1.1-Q2-artifacts/summary.json`.
PR: https://github.com/prateekranka/pastel-rts/pull/4

The archive contains web builds, not a native iOS binary. Foundry authoring uses the source content server. Simulator compilation is not a device run. Linux SwiftShader timings are not iPad performance evidence.

## Remaining decision

Retain this build for the M1.1 human walkthrough and physical iPad check. Human design, native/device behavior, touch and target-device performance remain open. No later milestone starts automatically.

Numbered input documents and simulation/navigation source remain unchanged from their recorded baselines. Loose artifacts and logs remain in place; the working tree is not claimed clean. The early capture-name reuse and other evidence limits are documented in the gate record.
