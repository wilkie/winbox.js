---
kind: function
module: GDI
name: ConvertOutlineFontFile
ordinal: 312
summary: Does nothing; answers GDI's own data segment, which its prologue leaves in AX.
versions:
  '3.1': exact
probes: [prtteng]
records: [ConvertOutlineFontFile]
source: crates/winbox-win16/src/gdi/engine_glyphs.rs
topics: [font-resources]
---

## Observed behaviour

- [[measured]] [[probe:prtteng]]: it answers something other than nought, and the same whatever it is given.

## Inside Windows

[[read out]] `GDI.EXE` seg7 `0d8a`: an exported function's prologue and epilogue and nothing between them, popping 12 bytes. The prologue loads AX with GDI's data segment, and that is the answer. DX is left as the caller had it.

## Implementation

`src/win16/gdi/engine-glyphs.ts` and `crates/winbox-win16/src/gdi/engine_glyphs.rs`: the selector WinBox keeps for GDI's data segment, the one GDI's callbacks find in DS.
