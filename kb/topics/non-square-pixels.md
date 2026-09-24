---
kind: topic
name: Non-square pixels
summary: How text is turned, placed and measured on a display whose two resolutions differ — the Hercules's 96 by 72 to the inch.
probes: [rotherc, smeargnd, rotstyle, simext]
---

On a device whose horizontal and vertical resolutions differ, Windows 3.1 turns text in **physical** space and stretches it across the page afterwards. Every conversion between the two axes has its own rounding, read out of `GDI.EXE`, and each one matters to the pixel. On a square pixel all of them are the identity, and nothing here applies. For turned text on a square pixel, see [[topic:turned-text]].

## The glyph matrix

[[read out]] GDI builds the turned matrix in whole pixels as it would on a square pixel, then, where the font's `dfHorizRes` and `dfVertRes` differ, multiplies the two entries that land across the page by their ratio as `(entry * H + V / 2) / V`, the division truncating toward nought (`GDI.EXE` seg1 `6fa3`–`6fce`). The rounding is not symmetric: Arial's fourteen pixels per em is −18 across at ninety degrees and 19 at two hundred and seventy.

[[refused]] Rounding the product away from nought, truncating it, rounding it up, or leaving it fractional each fit some angles and not others.

[[read out]] A made-up slant's shear (`6f63`) is added before that stretch, so the stretch applies to the sheared matrix.

[[measured]] A turn by right angles is still hinted, at each row's own stretch — which on this pixel is not the upright pair.

## Placing the glyphs

[[read out]] seg1 `625b` makes two 8.8 ratios, 256 times H over V and V over H, each rounded. GDI's turned drawing (seg8) carries the ascent across the page by the first and each glyph's running total down the page by the second, each a truncated multiply (`02c1`, `01f0`). The ground's polygon is carried the same way.

[[read out]] The alignment is a separate carry by `MulDiv`, applied by `ExtTextOut` before that (seg1 `3484`–`34f4`): the width across by its cosine and down by `MulDiv(width, V, H)` times the sine; the alignment's own shift down the text across by `MulDiv(d, H, V)`. The width is what `GetTextExtent` returns.

[[read out]] A turned rule is three carries, each with its own `MulDiv` (seg16 `046d`–`059f`): down to the rule, along the run's length, and across its thickness.

## Measuring

[[read out]] `GetTextExtent` on a turned font scales the summed widths by the length of the baseline's step on the device: `sum * factor >> 8` (seg1 `6ab0`), the factor the square root of `a² + b²`, with `a` the sine times `256 * V / H` and `b` the cosine times 256 (seg3 `2615`). [[measured]] Truncating the root: 216 of 216. [[refused]] Rounding it: 215.

[[read out]] Where GDI draws the bold itself, its `count + 1` is added after that scaling, not before. See [[topic:synthetic-bold]].

## The recordings

[[probe:rotherc]] draws single glyphs and pairs in three faces at two cells and seven angles on a Hercules and, as the square control, on a VGA: 252 of 252 on each. [[probe:rotstyle]] on a Hercules — ground, rules, bold, alignments, `ExtTextOut` and the made-up slant — is 190 of 190. The derivation is at the end of [[fonts:8u]].
