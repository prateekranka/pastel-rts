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

Git HTTPS push works despite gh being unauthenticated. Documentation commit f88998d was pushed and remote exact ref read back. No milestone PR creation is claimed yet.

Gates: ENGINEERING pending; HUMAN DESIGN ACCEPTANCE pending; PHYSICAL-DEVICE VALIDATION pending.
