---
kind: function
module: GDI
name: FTrapping0
ordinal: 355
summary: Not a function -- an entry naming a place in GDI's data segment, which nothing imports.
versions:
  '3.1': stub
source: src/win16/gdi.ts
topics: [gdi-internals]
---

## Inside Windows

[[read out]] `GDI.EXE`'s entry table puts ordinal 355 at seg48 `02ef`, and segment 48 is GDI's data segment: the export names a place in GDI's data, not code. Its word there starts as `FFFFh`.

## Callers

[[read out]] None imports it.

## Implementation

A stub in both engines.

**Recommendation: not applicable.** WinBox's GDI keeps no data segment of Windows' layout to point into.
