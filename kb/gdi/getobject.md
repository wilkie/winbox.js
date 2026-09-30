---
kind: function
module: GDI
name: GetObject
ordinal: 82
summary: Copies an object's description into a buffer, as far as it has room; for a brush, its LOGBRUSH as it was made.
versions:
  '3.1': exact
probes: [brushobj]
source: src/win16/gdi/GetObject.ts
topics: [standard-controls]
---

## Observed behaviour

[[measured]] [[probe:brushobj]] asks `GetObject` of brushes with room for 8 bytes and for 4. The buffer is filled with EEh first.

- **A solid brush's `LOGBRUSH`** is style 0 and the colour as it was asked for, with hatch 0, whether the display has that colour or dithers it: 123456h stays 123456h.
- **A hatched brush's** is style 2, its colour, and the hatch style, 4 for `HS_CROSS`.
- **The stock brushes** are solid, white FFFFFFh and light grey C0C0C0h. The null brush is style 1, `BS_HOLLOW`.
- With room for 4, 4 bytes are written, and the answer is 4. With room for 8, the answer is 8.

## Why it matters

FIBS/W reads a solid brush's colour back from its `LOGBRUSH` to set the background of its dialogs' text. winbox.js told nothing of a brush made by `CreateSolidBrush`, and the text stood on whatever was in the buffer: dark red.
