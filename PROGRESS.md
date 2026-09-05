# M1.1 progress

Active scope: M1.1 only. M2–M7 inactive. E1/N1 require separate approval. Numbered roadmap uploads remain unchanged.

Coordinator: gpt-6-astra/openai-codex, current CLI requests medium. Workers: explicit gpt-5.6-luna/openai-codex/max, fast OFF. No profile configuration changes or inherited delegation. Request/persisted-metadata limitations are in docs/roadmap/M1.1-routing-addendum.md.

Integrated checkpoints:
- Original animated fixtures, deterministic generation, relative production web/iOS packaging and dev:studio.
- Safe publication foundation A/A2: drafts, revisions, source preservation, references, validation, historical assets, acknowledgements.
- Foundry D: library and editor workflow, runtime projection preview. D2 fixes projected ground-circle footprint; coordinator reran 9 Foundry tests and game typecheck successfully.
- Runtime E checkpoint fe1a725 integrated as 6208146. Coordinator ran root typecheck, lint, tests and build on its combined code with A2/D; all passed. E's original smoke captures used an explicit sandbox override and are rejected. No browser acceptance is inferred from that worker report.

Current validation:
- Last complete root test run: schema 40, simulation 19, navigation 21, content server 18, game web 76 passed. Foundry is verified separately until lane F wires it into root test.
- F is integrated at 34fbbb3. Correctly seeded coordinator Foundry/API browser run at 853df6a passed all 9 tests. An earlier empty-pack invocation was invalid for fixture-dependent assertions; correction is in docs/roadmap/M1.1-recovery-evidence.md.
- Provider recovery was confirmed by actual Luna smoke session 20260905_185350_ad6f16. Existing G/H/I sessions resumed with explicit approved pins after confirming no duplicate workers or owned listeners. No profile or credential changes.
- Studio I integrated at 4136c5b. Coordinator started combined studio on 25373/25374/25387 with a disposable fixture. All three HTTP endpoints returned200; SIGINT produced exit0 and all owned ports were freed. Duplicate-port invocation failed explicitly with exit1. Walkthrough exists at docs/roadmap/M1.1-WALKTHROUGH.md; bundle section awaits G.
- G/G2 integrated through809b1cd. Coordinator passed6bundle unit tests and the2fresh browser reproduction/refusal tests. The stronger G2 run issued a real pointer move, observed acceptance and motion, exported a non-empty command log, and matched the actual checksum sequence in a fresh context. Evidence: docs/roadmap/M1.1-G2-coordinator-artifacts.
- J integrated atf9a80a8. Coordinator ran all9Foundry tests with automatic disposable fixture selection; all passed without an explicit pack path or worker override.
- Root content:validate, qa:scenario (twice) and qa:bundle passed. Repeated scenario files were byte-identical; receipts are in docs/roadmap/M1.1-final-cli-artifacts.
- Final combined runtime/browser gate and independent review remain pending. H is correcting the visible diagnostics/minimap overlap as well as testing publication lifecycle. No whole-milestone pass.
- Existing macOS CI run 33965323173 compiled iOS Simulator successfully at 6308242772c224b20e9a813dd2398c6fa6828b23. Web browser step failed, so overall CI is not passing. Native compile is not simulator launch or physical iPad proof.
- Linux timing is not iPad/GPU performance proof. An unchanged desktop timing test failed once and passed on rerun; its threshold was not relaxed.

Outstanding engineering work:
- Verify combined runtime against actual A2/D: published initial load, hot replacement/disposal, SSE reconnect, acknowledgement and rules restart.
- Fix/verify blocker readback, replay and pause behavior. Preserve simulation/navigation packages.
- Implement and exercise actual UI bounded bug export/reproduction; CLI JSON-only artifacts do not substitute for that path.
- Run full focused/integrated browser gates and fresh independent review, document non-coder walkthrough and final artifacts.

Publication: draft stacked PR #4, https://github.com/prateekranka/pastel-rts/pull/4, base cursor/milestone-1-interaction-lab-29a7. Git HTTPS credential helper also supports scoped gh calls without config changes. No merge or history rewrite. Checkpoints are pushed; final gate is not claimed.

Process isolation: do not stop unrelated service on 8787. Coordinator test ports 14373/14374/14387; lane F 20373/20374/20387. E-owned 193xx servers were cleaned up by its owner.

ENGINEERING PASS: pending.
HUMAN DESIGN ACCEPTANCE: pending.
PHYSICAL-DEVICE VALIDATION: pending.
