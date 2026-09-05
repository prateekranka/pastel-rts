# M1.1 progress

Active scope: M1.1 only. No later milestone or optional experiment started.

Verified baseline: root typecheck, lint, unit tests and build passed on existing M1 prerequisite 6be785f. M1.1 engineering gate remains pending.

Routing: current coordinator CLI is pinned gpt-6-astra/openai-codex/medium. Luna smoke session 20260905_154737_a9d0e4 completed; persisted model metadata says gpt-5.6-luna/openai-codex with effort max. Fast mode not requested; no profile changes.

Two independent Luna workers started with explicit same pins, isolated worktrees and disjoint write scope:
- A content publication: /home/bobbyranka/Projects/pastel-rts-m11-content, branch m1.1/content-publication, tmux pastel-m11-content. Exclusive schema/server owner.
- B fixture packaging: /home/bobbyranka/Projects/pastel-rts-m11-fixtures, branch m1.1/fixture-packaging, tmux pastel-m11-fixtures. Exclusive scripts/root package/lockfile owner.

Briefs and logs are under docs/roadmap. Dependent editor/runtime work waits for the publication API checkpoint. Fixture code review and focused integrated verification passed; browser acceptance remains pending.

Fixture checkpoint integrated through 38c2dd8. Coordinator ran content:validate, root typecheck/lint, tests, build, ios:sync-web, and validation of the copied iOS pack. All passed on the completed rerun. The first integrated test run failed the unchanged desktop pathfinding timing budget (2364ms versus 2000ms); full rerun passed (1227ms). This variability remains performance evidence, not a relaxed threshold. Web/iOS packaged content hash c1eea326ce929eaffaa825f732be03e8ec939d000c90521c8f6d40f442bb0995.

Independent QA lane C completed commits 81034c0 and ae7c506 in its own worktree. Its audit exposed pause, blocker readback, replay and Foundry sheet-control defects; not yet accepted/integrated. Source review is docs/roadmap/M1.1-source-review.md. Root default Playwright collides with unrelated service on 8787; isolated QA uses 14373/14374/14387. Do not stop unrelated services.

Git HTTPS push works. Documentation commit f88998d was pushed and its remote exact ref read back. Publication status is updated below.

Current integration: backend A2 and editor D through 9e282fc. Coordinator reran root typecheck/lint/tests, direct Foundry tests (4 files, 8 tests), and build; all passed. Root npm test does not yet include Foundry; fresh verification lane F owns that coverage fix and real integrated editor/API acceptance. Runtime E remains in its isolated worktree and is not accepted. Current whole-browser gate still fails as documented in M1.1-integrated-browser-findings.md.

Draft stacked milestone PR #4 exists and was read back: https://github.com/prateekranka/pastel-rts/pull/4, base cursor/milestone-1-interaction-lab-29a7. Existing Git credential helper works for authenticated gh calls without altering gh or Hermes configuration. No merge performed.

Luna worker metadata read from profile state.db: A2 20260905_164327_ffe67e, D 20260905_164327_860a99, E 20260905_164327_f0a112 all record gpt-5.6-luna/openai-codex and requested effort max. D was stopped and resumed in the same session to prohibit explicit security-disabling browser flags; no profile changes. Later D captures used ordinary Playwright. Raw response service-tier metadata remains unavailable; no fast option requested.

Gates: ENGINEERING pending; HUMAN DESIGN ACCEPTANCE pending; PHYSICAL-DEVICE VALIDATION pending.
