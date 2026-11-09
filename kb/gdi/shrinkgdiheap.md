---
kind: function
module: GDI
name: ShrinkGDIHeap
ordinal: 354
summary: GDI's local heap made smaller where much of it is free, as USER asks after a task ends; WinBox's GDI has no such heap.
versions:
  '3.1': exact
probes: [gdiint]
records: [call]
source: crates/winbox-win16/src/gdi/system_exports.rs
topics: [gdi-internals]
---

## Observed behaviour

- [[measured]] It takes no arguments and comes back ([[probe:gdiint]]). Nothing it answers is meant to be read.

## Inside Windows

[[read out]] `GDI.EXE` seg1 `1fdf`: `LocalCountFree`; where more than 1000h bytes are free, `LocalShrink(0, LocalHeapSize() - free + 400h)` -- what is used and 400h more. A plain `retf`; AX is what the last call left.

## Callers

[[read out]] `USER.EXE` imports it (seg1 `257e`).

## Implementation

Nothing: WinBox's GDI keeps its objects in itself, and the bytes a program sees of GDI's heap are made as they are read ([[topic:gdi-objects]]). No heap is there to shrink.

**Recommendation:** done.
