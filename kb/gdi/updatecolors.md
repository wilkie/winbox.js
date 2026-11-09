---
kind: function
module: GDI
name: UpdateColors
ordinal: 366
summary: Redraws a device context's area for the realization of its palette, slot by slot; answers nought.
versions:
  '3.1': exact
probes: [dcinner]
topics: [palettes]
---

## Observed behaviour

- [[measured]] It answers nought on the VGA and on the 256-colour display, after a palette's realization ([[probe:dcinner]]).

## Inside Windows

[[read out]] `GDI.EXE` seg22 `0109` checks the device context, and seg22 `0773`: on a device with `RC_PALETTE`, a table of the 256 slots, each to itself but for each of the palette's entries, from the slot it was in to the one it is in, and the driver's `UpdateColors` called with it for each rectangle of the context's visible region. The answer is nought either way.

## Implementation

Nought; the redrawing is not followed ([[topic:palettes]]). [[probe:dcinner]] agrees in both.
