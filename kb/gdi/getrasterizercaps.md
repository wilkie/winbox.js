---
kind: function
module: GDI
name: GetRasterizerCaps
ordinal: 313
summary: Reports whether TrueType is installed and enabled.
versions:
  '3.1': exact
probes: [fontboot]
topics: [font-resources]
---

## Observed behaviour

- [[measured]] **TrueType on**, its fonts installed: it answers 1033 (409h), and writes `nSize` 6, `wFlags` 3 (`TT_AVAILABLE` and `TT_ENABLED`) and `nLanguageID` 409h. The answer is the language, not TRUE: [[probe:fontboot]].
- [[measured]] **TrueType off**, `[TrueType]` `TTEnable=0`: it answers 0, `nSize` 6 and `wFlags` 0.

## Inside Windows

[[read out]] `GDI.EXE` seg7 `0d36`. For a size of nought or less it answers nought and writes nothing. Else it makes the six bytes on its stack -- `TT_AVAILABLE` where the TrueType table has a font in it, `TT_ENABLED` where `TTEnable` is on, and GDI's language, `[648h]` -- and copies as many bytes as the size says, more than six copying what follows them on its stack. AX is left the language. With TrueType off there is no table, and the language is nought.

## Implementation

As read out, in both engines; more than six bytes asked for writes only the six. [[probe:fontboot]] agrees in both.
