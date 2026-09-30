---
kind: function
module: GDI
name: SetROP2
ordinal: 4
summary: Sets the drawing mode, how the pen and the brush mix with the pixels already there, and answers the mode before.
versions:
  '3.1': exact
probes: [mixmode, metafile]
source: src/win16/gdi/SetROP2.ts
topics: [ellipses]
---

## Observed behaviour

- [[documented]] A mode is one of the sixteen ways of combining two values bit by bit, from `R2_BLACK`, 1, to `R2_WHITE`, 16. The mode's value less one is its table: bit `2p + d` is the result for a pen bit `p` over a pixel bit `d`.
- [[measured]] A device context starts in `R2_COPYPEN`, 13. [[probe:mixmode]] sets each of the sixteen modes in turn on four displays. `SetROP2` answers the mode before, and [[fn:GDI.GetROP2]] answers the new one.
- [[measured]] Under each mode, [[fn:GDI.RoundRect]] and [[fn:GDI.Ellipse]] mix the brush with the pixels first, then the pen. The pixels are palette indices, and the modes work on the index's bits. With a pen one pixel wide, the outline's left and top pixels are also under the fill, so both mix there. See [[topic:ellipses]].
- [[measured]] Calculator shows a key pressed by drawing it again over itself with `R2_NOT`, then once more to restore it. Drawn once, the key's left and top edges stay black, and its right and bottom turn white. Drawn twice, it is exactly as it was.

## Nuances

- [[measured]] [[probe:metafile]] plays a metafile a second time into a device context the first playing left in `R2_NOT`. Windows does not put a device context back after [[fn:GDI.PlayMetafile]]. So every shape of the second playing is drawn inverting what is there:
  - [[fn:GDI.SetPixel]] inverts its pixel, whatever its colour: red on white comes out black.
  - [[fn:GDI.Rectangle]] inverts its frame once and its inside once. Its fill stays inside its frame, where an ellipse's and a rounded rectangle's run under the pen at the left and top.
  - [[fn:GDI.Polygon]] fills under its outline too, so under `R2_NOT` its top edge is inverted twice and shows as it was.
  - [[fn:GDI.Arc]] inverts its curve.
- winbox.js drew all four in the copy mode whatever the mode, and filled a rectangle under its frame. `SetPixel`, `Rectangle`, `Polygon`, `PolyPolygon` and the arcs now draw under the mode.
- Not yet measured: text, which winbox.js draws in the copy mode.

## Implementation

The mode is kept on the surface. `ropOfMode` turns it into the raster operation a `PatBlt` would carry out, with the pen or brush as the pattern, and the curve painter in `src/win16/gdi/Ellipse.ts` applies it to the brush's rows and the pen's runs. Before this, `SetROP2` and `GetROP2` were stubs, and Calculator's pressed keys stayed black.
