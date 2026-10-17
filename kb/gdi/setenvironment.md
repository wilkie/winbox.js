---
kind: function
module: GDI
name: SetEnvironment
ordinal: 132
summary: Keeps an environment — a printer driver's DEVMODE — for a port, in a block of GDI's.
versions:
  '3.1': exact
probes: [prdlg]
source: src/win16/gdi/environment.ts
topics: [printer-drivers]
---

## Inside Windows

[[read out]] `GDI.EXE` seg7 `05ed`: the one kept for the port let go; a count of nought answers -1 and keeps nothing. Else the count's bytes copied into `GlobalAlloc(2002h)`, put in the first of twenty slots that is free with the port's atom (the device name on the null port), and the block's handle answered; nought with no slot free. The PostScript driver's `Enable` keeps a `DEVMODE` it is given that is not the one kept (`PSCRIPT.DRV` seg1 `0232`). See [[topic:printer-drivers]].

## Implementation

As [[fn:GDI.GetEnvironment]]'s.
