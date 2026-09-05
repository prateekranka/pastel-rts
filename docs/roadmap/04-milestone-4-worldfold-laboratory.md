# M4 — One foldable region inside a large stable world

Read and apply docs/roadmap/00-astra-luna-contract.md. Prerequisite: M1 navigation; integrate after M3 but keep fusion disabled in the folding test. Astra orchestrates/reviews; Luna Max Fast implements.

GOAL
Prove that reconfiguring a local region creates understandable counterplay. Preserve the expansive map: most terrain remains stable. Do not replace it with four floating arena tiles.

SCOPE
One substantial foldable peninsula, one contested monolith and two authored states separated by an exact quarter turn. Gaining one route must sacrifice another access or defensive advantage. Give both players warning, a cooldown and a clear contest/cancel policy. Start without combat, then repeat with the existing small combat encounter.

DELIVER
- Plate-local integer coordinates, explicit ownership of terrain/entities/buildings and a high-level crossing graph. Quarter-turn transforms must preserve exact deterministic coordinates and headings.
- Fold command lifecycle: requested, validated, telegraphed, transitioning, committed or cancelled. Define the one authoritative tick where connectivity changes.
- Close crossings during transition; specify queue/reject/brace behaviour for units at crossings and on the plate. Define targeting/cast interruption and occupied-building behaviour. No units stranded in illegal cells, duplicated or silently killed.
- Visual interpolation cannot become authority. Replan affected paths from current state after the topology update.
- Handle sprite-facing and building art deliberately. Rotating a parent object must not turn camera-facing sprites edge-on. Use authored direction views or clearly labelled simple 3D proxies for the experiment.
- Preserve selection, IDs, content, health and commands through folding. Save/replay covers intermediate fold state.
- A visible monolith control works at every playable zoom, with before/after route preview. Zooming out helps comprehension but is not mandatory to issue the command.

TOOLS
Extend map/scenario authoring with Fold Editor: region mask, pivot, states, entry/exit portals, protected cells, anchors, warning/cooldown and activation cost/charge.

Preview connectivity before/after; paint sample start/destination pairs; show disconnected regions and illegal placements. A Fold Test button repeats both transitions with occupied crossings and moving units.

LUNA TASKS
A: topology/coordinate contracts and deterministic transition logic.
B: renderer/camera-facing integration and fold interaction.
C: Fold Editor, connectivity validation and hostile transition fixtures.

ACCEPTANCE
Change crossing connections and fold timing through Foundry and retest without code edits. Test off-center pivots, boundary ownership, queued commands, rollback, crowded crossings, buildings, repeated rotations, selected units and replay hashes. Disallow invalid layouts before publication.

Human gate: can the opponent predict the change and exploit the new trade-off? Test stalling and unassailable-island exploits. Keep a no-fold version for comparison. No arbitrary terrain deformation, world-wide plate system, ecological response or automatic commitment to Worldfold as the headline mechanic.
