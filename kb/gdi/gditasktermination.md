---
kind: function
module: GDI
name: GDITaskTermination
ordinal: 460
summary: What USER tells GDI as a task ends -- nothing is done in Windows 3.1.
versions:
  '3.1': exact
probes: [gdiint]
records: [call]
source: crates/winbox-win16/src/gdi/system_exports.rs
topics: [gdi-internals]
---

## Observed behaviour

- [[measured]] It takes a task's handle and comes back ([[probe:gdiint]]).

## Inside Windows

[[read out]] `GDI.EXE` seg1 `7690`: the frame made and unmade, `retf 2`. Nothing else; AX is GDI's data segment.

## Callers

[[read out]] `USER.EXE` imports it (seg1 `0e4c`).

## Implementation

An exact no-op in both engines, popping its word.

**Recommendation:** done.
