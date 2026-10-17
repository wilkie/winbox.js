---
kind: function
module: GDI
name: EngineEnumerateFont
ordinal: 300
summary: GDI's TrueType fonts handed to a printer driver's own walk of its fonts, at the resolution of the context being walked.
versions:
  '3.1': partial
probes: [pric]
source: src/win16/gdi/engine-font.ts
topics: [printer-drivers]
---

## Observed behaviour

- [[measured]] [[probe:pric]]: the PostScript driver's `EnumDFonts` asks for the TrueType fonts with it, and `EnumFonts` on its IC shows Arial, Courier New, Times New Roman, Wingdings and Symbol first, typed 6, at an em of 24 points at 300 dots an inch.

## Inside Windows

[[read out]] `GDI.EXE` seg5 `093c`, into `0697`: the context `EnumFonts` is walking (`[064Eh]`) is given `TC_RA_ABLE` for the while, and the TrueType directory walked at its resolution, or at 300 dots an inch with none; each font is typed `TRUETYPE_FONTTYPE` and `DEVICE_FONTTYPE` and handed to the driver's procedure with its data, its structures where GDI's walk of its TrueType fonts puts them (`07f5`). With TrueType off, 1 and nothing handed on. See [[topic:printer-drivers]].

## Implementation

`src/win16/gdi/engine-font.ts` and `crates/winbox-win16/src/gdi/engine_font.rs`.
