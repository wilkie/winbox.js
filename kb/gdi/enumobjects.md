---
kind: function
module: GDI
name: EnumObjects
ordinal: 71
summary: Hands each pen or brush a display offers to a callback, in a fixed order, and answers the callback's last answer.
versions:
  '3.1': exact
probes: [enumobj]
topics: [palettes]
source: src/win16/gdi/EnumObjects.ts
---

## Observed behaviour

[[probe:enumobj]] enumerates the pens and the brushes of the screen, then each again with a callback that answers nought at the third. It was recorded on the VGA, the EGA, the Super VGA and the Hercules, and winbox.js agrees with all 16 records.

- [[measured]] Pens: each style from solid, 0, to dash-dot-dot, 4, and in each style the display's colours from its last to its first. The width is nought. That is 80 pens on the sixteen-colour displays and 10 on the Hercules.
- [[measured]] The colours are the display's own, as its bitmaps index them: white first and black last, with the EGA's `404040` where the others have `C0C0C0`. The Super VGA, in its sixteen-colour mode, gives the VGA's.
- [[measured]] Brushes: first 125 solid ones, the same on every display. Red steps slowest and blue fastest, each through `FF`, `C0`, `80`, `40` and `00`: white, then `FFFFC0`, and so on to black. Then the hatched brushes, from hatch 5, diagonal cross, down to 0, horizontal, each in the display's colours from last to first. That is 221 brushes on the sixteen-colour displays and 137 on the Hercules.
- [[measured]] The answer is the callback's last: 1 when the callback always answers 1. A callback answering nought stops the walk, and `EnumObjects` answers nought.

## Not yet measured

A memory device context, a printer, an object type other than a pen or brush, and a 256-colour display. winbox.js answers nought for an object type it does not know.
