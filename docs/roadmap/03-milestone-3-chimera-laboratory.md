# M3 — Reversible fusion and the Chimera Recipe Editor

Read and apply docs/roadmap/00-astra-luna-contract.md. Prerequisite: M2. Astra orchestrates/reviews; Luna Max Fast implements.

GOAL
Test whether separate units and a fused specialist are useful in different situations. Implement exactly one authored fusion recipe per faction, behind a feature toggle. Do not assume fusion is a permanent upgrade.

STARTER RECIPES
Three warm-faction ranged channelers become one Arc Stag: branching magic, larger footprint and a vulnerable stationary charge.
Three violet-faction controllers become one Hex Moth: a short containment/slow field with weaker independent coverage.
Names and component IDs are data. Reuse available compatible archetypes and explicitly label proxy art.

DELIVER
- Select eligible components and choose an explicit Fuse action in the Army Rail. Pinch remains camera zoom.
- Preview result, component count, transformation time, footprint and loss of coverage. Gather components into legal positions, reserve them once and allow a telegraphed interruption window.
- Fuse/split as atomic simulation transactions with stable component provenance. Prevent an entity from belonging to two pending recipes.
- Specify and test health normalization, damage distribution, cooldowns, statuses, population, selection and experience metadata. Repeated fusion/splitting must never create health, population capacity, resources or cooldown resets. Define death of a fused form explicitly.
- Split only into legal free positions; queue/reject with explanation when blocked. Never lose components or clip through terrain. Define interrupted gathering and transformation cleanup.
- One special capability per chimera; individual components must retain tactical advantages in coverage, mobility or charging exposure.

TOOLS
Add Chimera Recipe Editor: component filters/counts, result archetype, gathering radius, charge/split time, health/cooldown policy, footprint, cancellation rule, artwork/animation and enabled toggle.

Add Composition Comparator: identical investment as separate units versus fused units, several maps/opponents, swapped sides, performance and outcome comparison. Add inspection of the component ledger and rejection reasons.

LUNA TASKS
A: recipes, conservation rules and transactional simulation.
B: transformation presentation, selection and touch UI.
C: recipe authoring, comparison fixtures and exploit tests.

ACCEPTANCE
Author a second TEST recipe through the UI using existing primitives without a runtime switch statement; disable it afterward. Test interrupted fusion, death, repeated split cycles, no-space split, save/load, replay and content changes during a pending transformation.

Provide encounters that favor coverage and others that favor concentration. Stop for a design gate: do humans voluntarily use both forms for tactical reasons? Report observations and a retain/revise recommendation; do not declare universal balance from a win-rate table. No topology changes or economy yet.
