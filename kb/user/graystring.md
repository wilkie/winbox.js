---
kind: function
module: USER
name: GrayString
ordinal: 185
summary: Draws text, or whatever a program's procedure draws, greyed through a brush on every other pixel, as disabled text is shown.
versions:
  '3.1': exact
probes: [tabtext]
source: src/win16/user/gray-string.ts
topics: [standard-controls]
---

## Observed behaviour

[[probe:tabtext]] greys "Grey" on the VGA's screen over white and reads it back. [[measured]]

- The text is drawn in the device context's font on a monochrome bitmap. It is the whole of the text when the count is nought, and the bitmap is the text's own extent when its size is nought. Of its glyphs' pixels, only those where across and down, counted from its corner, add up to an even number are painted, in the brush: dark grey dots for the gray stock brush, black for the black one. Nothing else is touched.
- A count of 3 and a size of 20 by 8 draw "Gre", cut to 20 by 8.
- Given an output procedure, it draws instead of the text. It is called with the monochrome bitmap's device context, not the one given, with the data and the count as they were passed. What it draws is greyed the same way.
- It answers TRUE.

winbox.js agrees with all 69 records of these cases. It was a stub.

## Nuances

- Not recorded: an output procedure that answers FALSE, and a size of nought with an output procedure, which winbox.js draws nothing for.
