# Learnings

Dated notes from the build. Each one cost us time or changed a decision.

## 2026-10-04

**Never write a file format from memory.** None of the 25 smallest demo schematics that ship with KiCad 10 is in the KiCad 10
format (they are 7.99 to 9.99). `kicad-cli sch upgrade --force` re-saves a copy in the installed version, and that
copy is the ground truth the emitter follows. The first file the engine wrote loaded with 0 ERC violations because
of this.

**"0 violations" needs a negative control.** A file that loads empty also has 0 violations. One acceptance test
drafts the same regulator without `PWR_FLAG` and asserts that KiCad then reports `power_pin_not_driven`. Without
that test the clean result proves nothing.

**ERC JSON positions are in units of 100 mm.** A violation at 33.02 mm is reported as `0.3302`, although the report
says its units are mm. We map findings to parts by UUID through `layout.json` and ignore the positions.

**Library symbols can extend other symbols.** `AMS1117-3.3` extends `AP1117-15`, and `MIC5317-3.3xM5` extends
`AP2204K-1.5`. The embedded copy in a schematic must be flattened: parent graphics and pins, child properties, and
the unit names renamed to the child.

**Power symbols are power inputs.** A `+5V` or `GND` symbol on a net that only has passive pins (a connector) fails
ERC until the net has a `PWR_FLAG`. The engine adds exactly one per undriven net.

**Gemma wraps JSON in a markdown fence** even when told not to, and once named its own model family wrongly. The
reply parser strips fences; nothing the model says about itself is shown to the user.

**The hosted model is slow and flaky.** Calls took 30 to 111 seconds and many returned 500 or 503 first. The
provider retries twice (5 s, then 15 s). "Minimal" thinking halved the latency and intents still validated, so it
is the default. This is why the recorded demo mode exists.

**Keep the model's job small.** The intent for a regulator is about 1,500 bytes; the schematic is about 40,000.
Validation needed its one retry zero times in ten eval prompts. Everything a model is bad at (coordinates, UUIDs,
syntax) is done by code.

**A simple grid router is enough for a row of parts.** Putting every part on a common rail line makes the supply
rails straight wires. Dijkstra over (cell, direction) with a turn penalty, crossings only at right angles, and a
fallback to net labels when a net cannot be routed, gave the hand-drawn look for the regulator on the first run.
Busier circuits route correctly but less neatly.

**A connector's pins may face the wrong way.** KiCad's 2-pin connector has its pins on the left. Placed at the left
edge it must be mirrored, or every wire has to go around it. The engine mirrors a part when all its side pins face
away from the parts it connects to.

**Git Bash here-documents ate backslashes** in two patch scripts on Windows, silently breaking a regular
expression. Patches are now written as files, not piped through the shell.

**Reference files have licences.** The KiCad demo schematics used as format references belong to their authors, so
they are git-ignored and the test reads one from the local KiCad install instead.
