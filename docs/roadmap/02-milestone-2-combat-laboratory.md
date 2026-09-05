# M2 — Readable combat and a reusable Battle Lab

Read and apply docs/roadmap/00-astra-luna-contract.md. Prerequisite: verified M1.1 workflow. Astra orchestrates/reviews; Luna Max Fast implements.

GOAL
Prove ordinary movement, targeting and combat are enjoyable before adding transformations. Create a small playable encounter with two unit roles per faction, not the complete seven-unit roster.

DELIVER
- Tick-driven attacks, health, damage, death, target validation, range, attack anticipation/recovery and interruption rules. Death clears selection, collisions, queued targets and render resources safely.
- A small fixed vocabulary of effects: direct damage, bounded push/pull and temporary slow. Express attacks using validated data; no general scripting engine.
- Distinct melee and magical ranged roles. Use short spatial impacts and readable magical arcs, not rows exchanging realistic bullets. Make casting visibly originate from the actor.
- Unit animation events aligned with authoritative impact ticks. Missing cast/hit/death art is flagged as proxy; no unannounced animation synthesis.
- Attack, attack-move, stop and explicit ability targeting integrated with the existing touch grammar. UI interaction must never also pan, move or fire.
- Controlled enemy policies for the laboratory: hold, approach, pursue and retreat. They are test opponents, not a full economic AI.
- A small objective encounter with restart and results; no economy yet.

TOOLS
Extend Unit Editor with health, movement/combat values and role tags. Add a compact Ability Inspector/Editor: target rule, range, windup, effect parameters, recovery, animation event and readable effect colors. Use forms plus a timing strip, not a node graph.

Battle Lab must spawn chosen compositions, reset the same seed, pause, single-step and show target, range, current state, displacement legality and last damage source. Run mirrored duels with swapped sides and several fixed seeds; compare survival, damage, time to engagement, time to resolution and idle/stuck time. Reuse common replay/bug export.

LUNA TASKS
A: combat schemas and deterministic simulation.
B: animation/effect rendering and touch commands.
C: Battle Lab authoring, test fixtures and regression tests.

ACCEPTANCE
Change a unit's range and attack timing in Foundry, restart the same duel and observe the measured difference without code edits. Melee reaches its target without stacking; push/pull cannot move units through cliffs; cancelled casts cannot damage later; dead actors cannot fire. Replaying the encounter matches the checksum sequence.

Record a short real gameplay capture. Human playtest asks whether targeting, impact and counterplay are clear—not whether the art looks finished. Test baseline performance with effects on/off at equal population. No fusion, Worldfold, ecology director or production economy in this milestone.
