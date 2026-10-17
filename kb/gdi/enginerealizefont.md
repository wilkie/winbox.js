---
kind: function
module: GDI
name: EngineRealizeFont
ordinal: 302
summary: GDI's TrueType engine realizing a font for a printer's driver; with no FONTINFO to fill it answers the size of one.
versions:
  '3.1': partial
probes: [prdlg, pric]
source: src/win16/gdi/engine-font.ts
topics: [printer-drivers]
---

## Observed behaviour

- [[measured]] The PostScript driver asks it as it enables a device, and the device is enabled ([[probe:prdlg]], [[probe:pric]]).

## Inside Windows

[[read out]] `GDI.EXE` seg3 `2b2d`: nought with TrueType off (no TrueType table) and for a `LOGFONT` with no face and a height of nought; any other with no `FONTINFO` answers 96h. Given one, the font is mapped among the TrueType faces and realized into it (seg3 `2841`, `22b3`). The PostScript driver keeps room for the answer doubled, and fails the device on nought (`PSCRIPT.DRV` seg5 `009e`). See [[topic:printer-drivers]].

## Implementation

`src/win16/gdi/engine-font.ts` and `crates/winbox-win16/src/gdi/engine_font.rs`. Not followed: a `FONTINFO` given to fill, which answers nought.
