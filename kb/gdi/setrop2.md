---
kind: function
module: GDI
name: SetROP2
ordinal: 4
summary: Sets the drawing mode, how the pen and the brush mix with the pixels already there, and answers the mode before.
versions:
  '3.1': exact
probes: [mixmode]
source: src/win16/gdi/SetROP2.ts
topics: [ellipses]
---

## Observed behaviour

- [[documented]] A mode is one of the sixteen ways of combining two values bit by bit, from `R2_BLACK`, 1, to `R2_WHITE`, 16. The mode's value less one is its table: bit `2p + d` is the result for a pen bit `p` over a pixel bit `d`.
- [[measured]] A device context starts in `R2_COPYPEN`, 13. [[probe:mixmode]] sets each of the sixteen modes in turn on four displays. `SetROP2` answers the mode before, and [[fn:GDI.GetROP2]] answers the new one.
- [[measured]] Under each mode, [[fn:GDI.RoundRect]] and [[fn:GDI.Ellipse]] mix the brush with the pixels first, then the pen. The pixels are palette indices, and the modes work on the index's bits. With a pen one pixel wide, the outline's left and top pixels are also under the fill, so both mix there. See [[topic:ellipses]].
- [[measured]] Calculator shows a key pressed by drawing it again over itself with `R2_NOT`, then once more to restore it. Drawn once, the key's left and top edges stay black, and its right and bottom turn white. Drawn twice, it is exactly as it was.

## Nuances

- Not yet measured: the mode's effect on lines, `Rectangle`, `Polygon` and text, which winbox.js still draws in the copy mode.

## Implementation

The mode is kept on the surface. `ropOfMode` turns it into the raster operation a `PatBlt` would carry out, with the pen or brush as the pattern, and the curve painter in `src/win16/gdi/Ellipse.ts` applies it to the brush's rows and the pen's runs. Before this, `SetROP2` and `GetROP2` were stubs, and Calculator's pressed keys stayed black.
