# N1 — Optional multiplayer feasibility, after the core slice

Read and apply docs/roadmap/00-astra-luna-contract.md. Execute after explicit approval; Echo is not a dependency. Astra orchestrates/reviews; Luna Max Fast implements.

GOAL
Prove one complete skirmish can remain synchronized between two local clients without rewriting the simulation. No accounts, matchmaking, ranked ladders, paid hosting or live-service backend.

Begin by measuring cross-runtime determinism with identical scenario/content and recorded commands in Node, Chromium and WebKit where available. Isolate the first divergent tick and state field before choosing a transport strategy. A browser WebKit test is not proof for every physical WKWebView configuration.

Implement a small local authoritative command relay with player ownership/sequence validation, content/version handshake, fixed tick scheduling, configurable input delay and well-defined pause/disconnect behaviour. Clients cannot authorize commands by claiming another player's ID. Record both proposed and accepted command order. Do not describe this proof as production anti-cheat.

TOOLS
Network Lab supplies deterministic latency/jitter/loss schedules, pause/reconnect tests, queue and acknowledgement inspection, checksum comparison, first-divergence state diff and a portable two-client reproduction bundle. Keep failures reproducible. A bounded snapshot/resync experiment is optional only if the agreed protocol requires it.

LUNA TASKS
A: command protocol, relay and ownership validation.
B: client integration, readiness/disconnect UI and test transport.
C: Network Lab, adverse-condition tests and parity reports.

ACCEPTANCE
Two clients complete the retained skirmish with matching authoritative checksums under documented clean and impaired conditions. Tests cover wrong content versions, duplicate/late commands, forged ownership, disconnect and unsupported resumption. Preserve solo/offline play and measure iPad input responsiveness. Stop with a protocol/risk report, not a claim that online multiplayer is launch-ready.
