---
kind: function
module: GDI
name: ExtTextOut
ordinal: 351
summary: Draws a string with an optional opaque or clipping rectangle and an optional array of character distances.
versions:
  '3.1': exact
probes: [extout, rotstyle, clipedge, groundrn, smeargnd, lbtext]
topics: [turned-text, text-ground-and-rules]
---

## Observed behaviour

- [[measured]] `ETO_OPAQUE` paints the glyphs' own boxes and not the run's rectangle. See [[fonts:8t]].
- [[measured]] An array of distances replaces the advances. The ground under it differs by kind of face: a strike's runs the pens the array makes plus the last glyph's own advance, while an outline face's takes the array's own sum. See [[fonts:8o]].
- [[measured]] Turned, the array's distances are walked along the turned baseline, and `ETO_CLIPPED` does nothing. See [[topic:turned-text]].
- [[read out]] For TrueType text GDI itself hands the display driver a width array, one word a character; see [[topic:synthetic-bold]].
- [[read out]] Without an array a strike goes to the driver with none, and `VGA.DRV`'s `StrBlt` lays a smeared font out by adding its bold pixel to the character extra (seg2 `0970`): each glyph a column wider, the overhang once, past the run, whatever the options. [[measured]] [[probe:lbtext]]: MS Sans Serif asked bold, italic, and both, at 13 rows, drawn with `ETO_OPAQUE` and a rectangle, with `ETO_CLIPPED`, and with neither, lies where `TextOut` lays it, in a window's DC and in an owner-drawn list box's rows.

## Nuances

- Both engines draw a run with options or an array a character at a time. Without an array each character had moved the pen by its own measure, a bold's overhang and a slant's included, so a smeared strike's characters stood a column further apart with `ETO_OPAQUE` than `TextOut` draws them, and an italic one's further still. The Font dialog's faces and sizes, drawn so by COMMDLG, showed it ([[probe:chfont3]], 90 of its 201 records). Each now moves it by its measure less the run's overhang.

## Implementation

Every recording of this call is replayed through it: the rectangle and the distances are placed in guest memory as a `RECT` and an array of words, as the probes passed them, and all of them agree. Until this knowledge base was built it returned `undefined` instead of 1 or 0: it imported its constants from a module that does not export them.
