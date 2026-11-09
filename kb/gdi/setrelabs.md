---
kind: function
module: GDI
name: SetRelAbs
ordinal: 5
summary: Sets a device context's relative-or-absolute mode, which GDI keeps and nothing it draws reads; answers the mode before.
versions:
  '3.1': exact
probes: [dcinner]
topics: [device-context-internals]
---

## Observed behaviour

- [[measured]] A new device context's mode is `ABSOLUTE`, 1. Any number is kept and answered back: 2, then 7 ([[probe:dcinner]]).
- [[measured]] [[fn:GDI.SaveDC]] saves it and [[fn:GDI.RestoreDC]] puts it back.
- [[measured]] DX on return is not the call's: its high byte is whatever DH held.

## Inside Windows

[[read out]] `GDI.EXE` seg1 `5218` hands the context's offset 80h and the metafile record 105h to seg1 `51a6`, which exchanges the word there for the one given, or records `META_SETRELABS` for a metafile's context. Nothing else reads the word.

## Implementation

The mode is kept with the rest of what `SaveDC` saves, and a metafile's context records it. [[probe:dcinner]] agrees in both.
