# M5 — Restore the civilisation-building RTS loop

Read and apply docs/roadmap/00-astra-luna-contract.md. Prerequisites: M2 plus reviewed M3/M4 experiments. Only enable experimental systems approved for integration; retain toggles. Astra orchestrates/reviews; Luna Max Fast implements.

GOAL
Create one complete single-player skirmish: land, gather, build, expand, advance, fight, win/lose and rematch. This is no longer a fixed-army mechanics demonstration.

SCOPE
One Alien Fantasy map, two factions, the small tested roster and retained fusion recipes. Begin with two gathered resources plus population capacity, not a sprawling economy. Five building roles are enough: core, drop-off/extraction facility, population, basic production and advancement/specialist production. Use a single meaningful technological advancement.

DELIVER
- Visible workers with gather/carry/deposit/build states, legal interaction positions, reassignment and useful idle-worker handling. The player can allocate groups without selecting individual tiny workers.
- Resource depletion and expansion opportunity, construction progress, production queues, population caps and technology prerequisites.
- Deterministic cost reservation/refund rules: cancelling, destruction, blocked spawn exits, capacity changes and interrupted work cannot duplicate resources or lose them silently.
- Building destruction updates navigation, production and ownership. Preserve collision/pathing performance with crowded bases.
- Core destruction as the baseline victory rule. Other objective rules remain explicit scenario variants until tested; define ties and terminal-state handling.
- Basic explored/currently-visible fog and legal information-based targeting. Opponent AI must use its allowed information and resources; any diagnostic cheating mode is separately labelled.
- One competent non-cheating AI with authored priorities for gathering, expansion, production and attack. Do not build machine learning or numerous personalities yet.
- Simple native entry/results/rematch flow without redesigning the whole shell. Match state stays in the web runtime. Support local save/resume.

TOOLS
Extend Foundry with Economy/Production Editor: costs, gather rates, capacity, construction time, queue entries, dependencies and AI priority weights. Add dependency/cycle validation.

Economy Lab shows income/spending, idle workers, blocked production, army value, time to first expansion and match duration. Save build-order scenarios, switch balance revisions and replay deterministically. Do not call these metrics evidence of fun.

LUNA TASKS
A: economy/construction/production schemas and simulation.
B: workers, visibility, input and match flow.
C: AI priorities, economy authoring and failure-case tests.

ACCEPTANCE
Complete matches from landing to result using touch. Change a gather rate, building cost and queue through Foundry and run the same test again without runtime edits. Verify save/resume, replay, AI legality, full storage, no legal spawn cells, destroyed depots, simultaneous victory and resource conservation.

Use 10–15 minutes as an initial pacing hypothesis, not a forced win timer. Human gate: does expansion matter, and do retained fusion/folding systems improve the colony-building loop? No additional factions, ranked multiplayer or campaign production.
