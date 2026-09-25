---
kind: function
module: GDI
name: SetTextAlign
ordinal: 346
summary: Sets which point of a string's box the coordinates of TextOut and ExtTextOut name.
versions:
  '3.1': exact
probes: [textalin, rotstyle]
topics: [turned-text]
---

## Observed behaviour

- [[measured]] The alignment moves the reference point: left, centre or right of the advance, and top, baseline or bottom of the cell. 36 of 36 on a VGA and on an EGA on the first implementation. See [[fonts:8p]].
- [[measured]] Turned, the alignment turns with the text and is a carry of its own, apart from the ascent's. See [[topic:turned-text]].

## Implementation

The replays of [[probe:textalin]] and [[probe:rotstyle]] set the alignment through this call, as the probes did, and every record agrees. The previous alignment it returns is not recorded.
