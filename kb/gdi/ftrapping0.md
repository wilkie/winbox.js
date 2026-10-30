---
kind: function
module: GDI
name: FTrapping0
ordinal: 355
summary: Not a function -- a word of GDI's data segment, nought once GDI has hooked the divide fault, which GDI's fault handler reads.
versions:
  '3.1': exact
probes: [ugaps]
records: [ftrap]
source: src/win16/gdi.ts
topics: [gdi-internals]
---

## Observed behaviour

- [[read out]] GDI makes the word nought as it starts, once it has hooked the divide fault (seg2 `011a`); its fault handler reads it, 1 while GDI's own arithmetic is guarded (seg1 `54c5`-`5548`).
- [[measured]] [[probe:ugaps]]: the address is GDI's data segment, the one `GDISeeGDIDo` answers, and 2EFh; the word there is nought.

## Inside Windows

[[read out]] `GDI.EXE`'s entry table puts ordinal 355 at seg48 `02ef`, and segment 48 is GDI's data segment: the export names a place in GDI's data, not code. Its word there starts as `FFFFh`.

## Callers

[[read out]] None imports it.

## Implementation

**Implemented (b), data.** In both engines `GetProcAddress` and an import of it give GDI's data segment and 2EFh (`exported-data.ts`, `exported_data.rs`), where WinBox's GDI segment reads nought. Not done: a GDI handle of 2EEh, which WinBox gives out only after some six hundred objects, would read there as its entry. See [[topic:gdi-internals]].
