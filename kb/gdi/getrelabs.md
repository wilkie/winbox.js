---
kind: function
module: GDI
name: GetRelAbs
ordinal: 86
summary: Answers a device context's relative-or-absolute mode, the polygon fill mode in the high word.
versions:
  '3.1': exact
probes: [dcinner]
topics: [device-context-internals]
---

## Observed behaviour

- [[measured]] A new device context answers 10001h: `ABSOLUTE` and, above it, `ALTERNATE` ([[probe:dcinner]]). After `SetPolyFillMode(WINDING)` the high word is 2.
- [[measured]] A handle of nought answers nought.

## Inside Windows

[[read out]] `GDI.EXE` seg1 `5145` hands offset 80h to seg1 `5162`, which checks the handle is a device context's and answers the dword there: the mode at 80h and the fill mode at 82h.

## Implementation

The mode and the fill mode as a dword. [[probe:dcinner]] agrees in both.
