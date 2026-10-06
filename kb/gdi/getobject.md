---
kind: function
module: GDI
name: GetObject
ordinal: 82
summary: Copies an object's description into a buffer, as far as it has room — a brush's LOGBRUSH as it was made, a font's LOGFONT to its face's nought, a bitmap's first ten bytes padded to the room.
versions:
  '3.1': exact
probes: [brushobj, stockdel]
source: src/win16/gdi/GetObject.ts
topics: [standard-controls]
---

## Observed behaviour

[[measured]] [[probe:brushobj]] asks `GetObject` of brushes with room for 8 bytes and for 4. The buffer is filled with EEh first.

- **A solid brush's `LOGBRUSH`** is style 0 and the colour as it was asked for, with hatch 0, whether the display has that colour or dithers it: 123456h stays 123456h.
- **A hatched brush's** is style 2, its colour, and the hatch style, 4 for `HS_CROSS`.
- **The stock brushes** are solid, white FFFFFFh and light grey C0C0C0h. The null brush is style 1, `BS_HOLLOW`.
- With room for 4, 4 bytes are written, and the answer is 4. With room for 8, the answer is 8.

[[measured]] [[probe:stockdel]] asks it of the other stock objects, and of bitmaps and fonts with more room than they need. It was recorded on four displays.

- **The stock pens** have their `LOGPEN`s, 10 bytes, nought wide. `WHITE_PEN` is solid FFFFFFh, `BLACK_PEN` solid nought, and `NULL_PEN` is style 5, `PS_NULL`, white FFFFFFh, as index 9 is ([[probe:gdinum]]).
- **`DEFAULT_PALETTE`** is its count of entries, a word: 20.
- **A bitmap** answers the room it is given, whatever that is: 6, 14, 16 or 20. The first ten bytes of its `BITMAP` are written, up to the planes and the bits a pixel, and noughts fill the rest, so `bmBits` is nought. [[read out]] `GDI.EXE` 4:0571 copies at most ten bytes from the bitmap's header and fills the rest of the room with noughts.
- **A font** answers its `LOGFONT` only as far as the face's terminating nought: 18 bytes and the name's length and one. A font made with the face Helv answers 23 with room for 50, and one with no face 19. [[read out]] `GDI.EXE` 4:04F3 measures the face kept in the object and adds 12h. The `LOGFONT` is the one kept, which [[fn:GDI.CreateFontIndirect]] has already rewritten: Helv asked for with pitch nought tells of `VARIABLE_PITCH` (`GDI.EXE` 3:0064).
- **The stock fonts** have `LOGFONT`s too:

| font | height | width | weight | charset | out, clip, quality | pitch and family | face |
|---|---|---|---|---|---|---|---|
| `OEM_FIXED_FONT` | 12 | 8 | 0 | FFh | 0, 2, 2 | 1 | Terminal |
| `ANSI_FIXED_FONT` | 12 | 9 | 0 | 0 | 0, 2, 2 | 1 | Courier |
| `ANSI_VAR_FONT` | 12 | 9 | 0 | 0 | 0, 2, 2 | 2 | Helv |
| `SYSTEM_FONT` | 16 (EGA, Hercules 12) | 7 | 700 | 0 | 1, 2, 2 | 22h | System |
| `DEVICE_DEFAULT_FONT` | 0 | 0 | 0 | 0 | 0, 0, 0 | 1 | (none) |
| `SYSTEM_FIXED_FONT` | 15 (EGA, Hercules 10) | 8 | 400 (EGA, Hercules 700) | 0 | 1, 2, 2 | 31h | Fixedsys |

The first four, and `DEVICE_DEFAULT_FONT`, are the same on every display, even where they do not match the display's fonts: the EGA's Terminal is eight rows. [[inferred]] The system font and the system's fixed font are taken from the header of the display's font file, `VGASYS.FON` and `VGAFIX.FON` or `EGASYS.FON` and `EGAFIX.FON`. Each value is the header's pixel height, average width, weight and character set, and its face. The pitch is turned to a `LOGFONT`'s, 2 for variable and 1 for fixed, from the header's low bit, which is set for variable. Every recorded value fits this. [[read out]] The code that makes them at start-up is `GDI.EXE` 2:02C5 to 2:0335.

## Why it matters

FIBS/W reads a solid brush's colour back from its `LOGBRUSH` to set the background of its dialogs' text. winbox.js told nothing of a brush made by `CreateSolidBrush`, and the text stood on whatever was in the buffer: dark red.
