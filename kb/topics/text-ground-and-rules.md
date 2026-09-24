---
kind: topic
name: The text ground and rules
summary: The rectangle an opaque background paints behind text, and the underline and strikeout — where each starts, how far it runs and how thick it is.
probes: [textbk, groundbx, groundw, groundrn, rules, strikout, smeargnd]
---

Two things are drawn with text besides its glyphs: the **ground**, the background colour painted behind it in `OPAQUE` mode, and the **rules**, the underline and strikeout a font asks for. Neither follows the string's advance alone.

## The ground

- [[measured]] In `OPAQUE` mode the ground is painted in the background colour; in `TRANSPARENT` mode it is not painted at all. A fresh device context's background is white. See [[fonts:8o]].
- [[measured]] For a strike, the ground is the string's advance, at every cell: 328 records of MS Sans Serif and the System font without exception.
- [[measured]] For an outline face, the ground starts at the glyph's own left edge and runs the advance from there, united with the box the glyph is blitted into:

  ```
  left  = min(pen, pen + bearing)
  right = max(pen + bearing + advance, pen + bearing + width)
  ```

  Arial's `l` at a cell of 45 advances 8 and bears 2, and its ground is 10 wide. Only the **first** glyph's bearing enters, and one glyph alone is its own box.

- [[read out]] A synthesised bold's widths each carry a pixel, and the ground is those widths summed (`GDI.EXE` seg1 `63b9`). Where GDI draws the bold itself, the ground moves a device pixel right and a space's ground is painted at the pen first; see [[topic:synthetic-bold]].
- [[measured]] Turned, the ground is GDI's `Polygon` with no pen; see [[topic:turned-text]].

## The rules

- [[measured]] Both rules run from the pen to the end of the string's advance, solid. See [[fonts:8n]].
- [[measured]] An outline face takes each rule's place and thickness from its own tables, scaled at the size and rounded, at least one row thick: the underline from `post` (position at +8, thickness at +10), the strikeout from `OS/2` (position at +28, size at +26). The position is a distance from the baseline — down for the underline, up for the strikeout.
- [[measured]] A strike has no such tables. Its underline sits exactly one row below the baseline at every size, and its thickness is a twelfth of the cell, at least one row; its strikeout sits a third of the way up from the baseline to the top of the internal leading.
- [[measured]] A turned rule one row thick is the driver's line with both ends drawn; a thicker one is `Polygon` with a one-pixel pen. See [[topic:polygon-fill]].

[[probe:rules]] is 224 of 224, [[probe:strikout]] 540 of 540 and [[probe:groundw]] 820 of 820.
