# M6 — One readable ecological participant

Read and apply docs/roadmap/00-astra-luna-contract.md. Prerequisite: M5. Astra orchestrates/reviews; Luna Max Fast implements.

GOAL
Make one place worth understanding and contesting. Do not create a planet-wide hidden director, rubber-banding or punish factions for using their own abilities.

MECHANIC
Implement one neutral giant Prism Flower in a contested area. Nearby authored magical events charge it. Its visible petals and meter communicate charge; either player can contest its activation point and release a clearly forecast directional pulse. The flower then cools down.

Use a small state machine: dormant, charging, ready, warning, releasing, cooldown. Distinguish stored charge, activation control and ownership; hostile players cannot both spend the same charge. Both factions need a useful way to interact.

DELIVER
- Trigger subscriptions to simulation events, not a full world scan every render frame.
- Bounded charge, contribution and cooldown rules, explicit target/direction validation, predictable friendly-fire policy and reset behaviour.
- Telegraph radius/direction and enough time to respond. Make the local rule visible by inspecting the flower; no hidden personality score.
- Reuse combat effect primitives. One authored environmental reaction is enough; do not add new terrain, spawning predators and weather simultaneously.
- Add the organism to one expansion route with a no-flower control variant. Keep distant quiet terrain quiet.

TOOLS
Ecology Editor with trigger types, filters, radius, charge rate/cap, activation conditions, warning/cooldown, effect and appearance.

Event Trace shows exactly which actor/event changed charge, when a threshold was reached and why activation succeeded/failed. Add Reset Organism, Inject Test Event and replay-from-seed actions. Use typed dropdown rules, not arbitrary JavaScript.

LUNA TASKS
A: local state machine, event accounting and capture contention.
B: environmental animation, telegraph and touch inspection.
C: Ecology Editor, event trace and seeded A/B scenarios.

ACCEPTANCE
Tune the flower in Foundry, publish and reset the scenario. Replay preserves charge/ownership and pulse outcome. Test simultaneous activation, faction switching, loss of control during warning, destroyed/moved event sources, save/load and depleted charge.

Human gate: players can explain why it activated and intentionally use, avoid or contest it. Do not assume the mechanic works merely because its animation is attractive. No biome-wide adaptation, campaign persistence or random retaliation.
