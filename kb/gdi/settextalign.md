---
kind: function
module: GDI
name: SetTextAlign
ordinal: 346
summary: Sets which point of a string's box the coordinates of TextOut and ExtTextOut name.
versions:
  '3.1': unrecorded
probes: [textalin, rotstyle]
topics: [turned-text]
---

## Observed behaviour

- [[measured]] The alignment moves the reference point: left, centre or right of the advance, and top, baseline or bottom of the cell. 36 of 36 on a VGA and on an EGA on the first implementation. See [[fonts:8p]].
- [[measured]] Turned, the alignment turns with the text and is a carry of its own, apart from the ascent's. See [[topic:turned-text]].

## Implementation

The alignment's effect is recorded, through the field this sets; the call itself — and the previous alignment it returns — is not.
