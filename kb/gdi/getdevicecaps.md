---
kind: function
module: GDI
name: GetDeviceCaps
ordinal: 80
summary: Answers one numbered question about the device behind a device context — its size, its colour layout, its resolution and what drawing it will do itself — with whatever the installed driver reported.
versions:
  '3.1': exact
probes: [devcaps, text]
source: src/win16/gdi/GetDeviceCaps.ts
topics: [display-drivers]
---

## Observed behaviour

- [[measured]] For the screen, every answer is the display driver's, not Windows's. [[probe:devcaps]] asks 27 indices on four displays. Fifteen give different answers on different displays:

| Index                     | VGA     | Super VGA | EGA     | Hercules |
| ------------------------- | ------- | --------- | ------- | -------- |
| `HORZRES` x `VERTRES`     | 640x480 | 800x600   | 640x350 | 720x348  |
| `HORZSIZE` x `VERTSIZE`   | 208x156 | 208x156   | 240x175 | 225x145  |
| `LOGPIXELSX`/`LOGPIXELSY` | 96/96   | 96/96     | 96/72   | 96/72    |
| `ASPECTX`/`ASPECTY`       | 36/36   | 36/36     | 38/48   | 11/16    |
| `ASPECTXY`                | 51      | 51        | 61      | 19       |
| `PLANES`, `NUMCOLORS`     | 4, 16   | 4, 16     | 4, 16   | 1, 2     |
| `RASTERCAPS`              | 18137   | 18137     | 18137   | 665      |
| `TEXTCAPS`                | 8708    | 8708      | 8708    | 8196     |
| `CLIPCAPS`                | 1       | 1         | 1       | 0        |
| `NUMBRUSHES`, `NUMPENS`   | -1, 80  | -1, 80    | -1, 80  | 77, 10   |

- [[measured]] The other twelve are the same on all four displays: `LOGPIXELSX` 96, `BITSPIXEL` 1, `DRIVERVERSION` 778, `TECHNOLOGY` 1, `LINECAPS` 34, `POLYGONALCAPS` 8, `CURVECAPS` 0, and 0 for `NUMFONTS`, `NUMMARKERS`, `NUMRESERVED`, `SIZEPALETTE` and `COLORRES`.
- [[measured]] The [[probe:text]] probe asks ten of these indices on the VGA and gets the same values as `devcaps-vga`.
- [[measured]] winbox.js gives the same answer as Windows in all 27 records on each display and all 10 of the `text` probe's.

## Nuances

- [[measured]] A 16-colour display reports `BITSPIXEL` 1 and `PLANES` 4, not 4 bits in one plane. Code that builds a device bitmap by hand has to use that layout.
- [[inferred]] `HORZSIZE` is a size the driver claims, not one it works out from `LOGPIXELSX`. At 96 dots to the inch, 640 pixels would be about 169 mm, but the VGA reports 208. The Super VGA reports the same 208x156 at 800x600.
- [[inferred]] `LOGPIXELS` and `ASPECT` disagree about the shape of a pixel. On the EGA, `LOGPIXELS` and the millimetre sizes both give 3:4 across to down, while `ASPECT` gives 38:48. On the Hercules they also give 3:4, and `ASPECT` gives 11:16. On the EGA the aspect pixel is closer to square than 3:4, and on the Hercules it is further from square. See [[topic:non-square-pixels]].
- [[inferred]] `ASPECTXY` is the rounded diagonal of `ASPECTX` and `ASPECTY` on all four displays (51, 61, 19).
- [[documented]] Decoded with the Windows 3.1 constants, the colour displays' `TEXTCAPS` of `0x2204` sets `TC_CP_STROKE`, `TC_EA_DOUBLE` and `TC_RA_ABLE`. The Hercules's `0x2004` does not set `TC_EA_DOUBLE`. The colour displays' `RASTERCAPS` of `0x46D9` sets `RC_SAVEBITMAP`, `RC_BIGFONT` and `RC_OP_DX_OUTPUT`, and the Hercules's `0x299` sets none of the three.
- Not yet measured: `PDEVICESIZE`, an index that is not a whole word of the device's information, and any device context other than the screen's.

## Inside Windows

- [[read out]] The index is the byte offset of a word in the driver's `GDIINFO`. The font mapper reads `ASPECTY` and `ASPECTX` directly at offsets `0x2a` and `0x28` and uses them for its off-square penalty. See [[fonts:3]] and [[topic:font-mapper]].
- [[read out]] GDI checks the capability bits itself. Without `RC_BIGFONT`, a stretched strike has to fit in one segment ([[fonts:3]]). Without `TC_EA_DOUBLE`, GDI makes a bold by drawing twice. Without `TC_CR_ANY`, GDI also does that for turned text on a VGA ([[fonts:8u]], [[topic:synthetic-bold]]).

## Implementation

The answers come from the display mode chosen when the machine starts (`src/win16/display-modes.ts`). The four recorded modes match their fixtures.

Two 256-colour modes are marked `modelled`: their resolution comes from `SETUP.INF`, and their capability bits are copied from the recorded drivers. No record supports those two modes. An index the table does not name returns 0. See [[topic:display-drivers]].
