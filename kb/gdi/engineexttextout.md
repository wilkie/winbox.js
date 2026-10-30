---
kind: function
module: GDI
name: EngineExtTextOut
ordinal: 314
summary: GDI drawing a string of a TrueType font for a printer's driver onto the driver's device, or, given a negative count, measuring it.
versions:
  '3.1': partial
probes: [prtteng]
records: [extent, textextent]
source: src/win16/gdi/engine-glyphs.ts
topics: [printer-drivers]
---

## Observed behaviour

- [[measured]] [[probe:prtteng]]'s driver answers [[fn:GDI.GetTextExtent]] with it, the count negative. `abcdefgh` of Arial at an em of 40 is 163 across, the sum of its widths, and 45 down, the font's cell. A character outside the font is the default character's width. With a character extra of 3, 24 more.
- [[measured]] Arial turned 90 degrees is 44 down, the turned font's cell.

## Inside Windows

[[read out]] `GDI.EXE` seg1 `669a`. It takes 42 bytes: the device context, then a driver's `ExtTextOut` arguments — the device, the place, the clip, the string, the count, the `FONTINFO`, the `DRAWMODE`, the `TEXTXFORM`, the widths, the opaque rectangle and the options. It answers a doubleword.

- The `FONTINFO`'s block of widths is made again where it was discarded (`6748`).
- For a negative count, the string's extent (`69fe`, into `6a65`), measured with the context's own realized font (`6b73`). Each character's width is the one [[fn:GDI.EngineGetCharWidth]] gives, the context's character extra after each, its justification spread as [[fn:GDI.GetTextExtent]] spreads it, and the cell down. An extent past 7FFFh is 7FFFh. A font whose widths could not be filled answers nought across and 8000h down. A turned font's extent is stretched where GDI's two pixel shapes differ.
- Otherwise the context's device is made the one given, and its drawing flag set, while GDI draws the string itself (`6223`); then both are put back.

## Implementation

`src/win16/gdi/engine-glyphs.ts` and `crates/winbox-win16/src/gdi/engine_glyphs.rs`: the extent, with the `FONTINFO` given, which a driver hands on from its own `ExtTextOut`.

## Not yet done

- Drawing the string onto the driver's device, which answers nought and draws nothing.
- The context's own realized font, where a driver gives another.
- A turned font's extent where the pixel is not square.
