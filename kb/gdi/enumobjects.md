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
source: crates/winbox-win16/src/gdi/calls/enum_objects.rs
---

## Observed behaviour

[[probe:enumobj]] enumerates the pens and the brushes of the screen, then each again with a callback that answers nought at the third. It was recorded on the VGA, the EGA, the Super VGA, the Hercules and the 256-colour display, and WinBox agrees with all 20 records.

- [[measured]] Pens: each style from solid, 0, to dash-dot-dot, 4, and in each style the display's colours from its last to its first. The width is nought. That is 80 pens on the sixteen-colour displays and 10 on the Hercules.
- [[measured]] The colours are the display's own, as its bitmaps index them: white first and black last, with the EGA's `404040` where the others have `C0C0C0`. The Super VGA, in its sixteen-colour mode, gives the VGA's.
- [[measured]] Brushes: first 125 solid ones, the same on every display. Red steps slowest and blue fastest, each through `FF`, `C0`, `80`, `40` and `00`: white, then `FFFFC0`, and so on to black. Then the hatched brushes, from hatch 5, diagonal cross, down to 0, horizontal, each in the display's colours from last to first. That is 221 brushes on the sixteen-colour displays and 137 on the Hercules.
- [[measured]] On the 256-colour display: 100 pens, the five styles in each of the driver's twenty colours, and twenty solid brushes, no hatched one. The colours FF0000h's red first -- the last seven of the twenty -- then black and the first thirteen, as the driver's own `EnumObj` hands them ([[fn:GDI.DMEnumObj]]).
- [[measured]] The answer is the callback's last: 1 when the callback always answers 1. A callback answering nought stops the walk, and `EnumObjects` answers nought.

## Inside Windows

[[read out]] `SVGA256.DRV` seg4 `0086`, the driver's `EnumObj`: pens of styles nought to four (`00cc`-`00e3`) and brushes of style nought (`00ea`), each colour from the table at 22h of its data segment, the seven from 13 on, then the thirteen from nought (`00fa`-`0149`).

## Implementation

`crates/winbox-win16/src/gdi/calls/enum_objects.rs`: the sixteen-colour displays' and the Hercules's as measured; on the 256-colour display the driver's twenty colours in its order (`enumeratedColours`, `enumerated_colours`).

## Not yet measured

A memory device context, a printer, and an object type other than a pen or brush. WinBox answers nought for an object type it does not know.
