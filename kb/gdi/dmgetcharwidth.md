---
kind: function
module: GDI
name: DMGetCharWidth
ordinal: 215
summary: A raster font's character widths for a memory bitmap, from the display driver's GetCharWidth -- which reads past the font's table for a range beyond it.
versions:
  '3.1': partial
probes: [gdidmdrw]
records: [charwidth]
source: src/win16/gdi/driver-bitmap.ts
topics: [gdi-internals, printer-drivers]
---

## Observed behaviour

- [[read out]] `DMGetCharWidth(lpDestDev, lpBuffer, wFirstChar, wLastChar, lpFontInfo, lpDrawMode, lpFontTrans)` takes 24 bytes of arguments, as the display driver's `GetCharWidth` does. For a device that is not a memory bitmap -- its first word not nought -- nothing is drawn and the answer is GDI's data segment in AX and 38h in DX.
- [[measured]] [[probe:gdidmdrw]]: each character's width from the font's table, and 1 answered. Below the font's first character, the default character's width.
- [[measured]] Above the font's last character the table is read on: the entry after the last, nought, and then whatever bytes follow it. The driver counts how many to read as the font's last character's code less the index from the first, not its index.
- [[measured]] A last character below the first answers nought and writes nothing.
- [[measured]] A `TEXTXFORM` of weight 700 or more on a lighter font adds two to each width.

## Inside Windows

[[read out]] `GDI.EXE` seg13 `0130`: `mov cx,3810h`, CL the words `Brute` moves and CH the offset 38h of `GetCharWidth` in the display driver's table, a jump to [[fn:GDI.Brute]] (seg13 `0171`).

[[read out]] `VGA.DRV` seg1 `17dc`, its data segment the font's: the emboldening at `17f6`-`1815`; a fixed font's width for every character at `182e`; the default character's entry at `183b`; those below the first at `1862`; then `187a`, `mov al,[60h]` -- the last character -- less the index, for the count read from the table; any left take the last width read (`18b7`-`18bb`). Six bytes an entry in a font of 3.0, four before.

## Callers

[[read out]] None imports it (`kb/data/gdi-callers.json`).

## Implementation

`driver-bitmap.ts` and `driver_bitmap.rs` on the VGA, the Super VGA and the EGA, as read out. [[probe:gdidmdrw]] agrees in both engines on the three.

## Not yet done

- The Hercules's and the 256-colour display's own `GetCharWidth` (known gaps of [[probe:gdidmdrw]]).
