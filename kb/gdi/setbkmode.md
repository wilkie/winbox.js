---
kind: function
module: GDI
name: SetBkMode
ordinal: 2
summary: Sets whether text and hatched brushes paint the background colour behind themselves.
versions:
  '3.1': stub
probes: [textbk, smeargnd]
topics: [text-ground-and-rules]
---

## Observed behaviour

- [[measured]] `OPAQUE` paints the ground in the background colour; `TRANSPARENT` paints nothing behind the glyphs. A fresh device context is `OPAQUE`. See [[topic:text-ground-and-rules]].

## Implementation

winbox.js implements the mode, and the recordings of it agree, but its implementation sits at ordinal 487 of its GDI table, an ordinal Windows 3.1 does not export: it was appended to the table when the mode was added (see [[fonts:8o]]), and a program imports by ordinal. A program calling `SetBkMode` therefore reaches this ordinal, 2, which is a stub. Moving the implementation here would make it Exact.
