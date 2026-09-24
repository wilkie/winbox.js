---
kind: topic
name: Synthetic italic
summary: How Windows 3.1 makes an italic it has no file for — a strike leant row by row, an outline sheared by a whole number of pixels per em — and what the slant does to the box, the advance and the metrics.
probes: [glyphs, font, hinting, stack, simext, rotstyle]
---

A request for italic that no file answers is **slanted** by Windows. What gets slanted depends on the kind of font: a bitmap strike has its rows shifted, and a TrueType outline is sheared before it is scan-converted, with no hinting program run and with the lean rounded to a whole number of pixels per em.

## When it happens

- [[measured]] The mapper tries to find an italic file first. Asked for italic, `Terminal`, `WingDings` and an empty name all come back as Arial's italic file with an overhang of nought, where upright they come back as MS Sans Serif. See [[fonts:2]] and [[topic:font-mapper]].
- [[measured]] A TrueType family's italic is a separate font. Arial's italic is narrower than its regular at twenty-four pixels, 101 against 106. No shear of the regular can do that.
- [[read out]] The lookups that answer by name want the slant to equal the request's (`0f58`, `0f6a`, `11ac`, `11c0`). Symbol has no italic file, so it cannot be answered this way and is slanted. See [[fonts:3]].
- [[read out]] If the mapper has to slant a strike, it charges the strike one more unit of penalty (`1f82` sets `0x200`, `2044` charges `w[0x5c]`, which is 1). See [[fonts:8u]].
- [[measured]] `tmItalic` depends on the family the request settled on, not on the strike that was slanted. Eight-pixel Arial in italic lands on Small Fonts and answers 255. Small Fonts asked for by name is the same strike with the same slant and answers 1.

## A strike leans row by row

- [[measured]] The top row moves right by `floor((cell - 1) / 2)`, which is exactly the overhang Windows reports. Counting down from the top, the rows go in pairs, each pair one pixel less than the pair above, until the lean reaches nothing at the bottom. So row `j` leans `overhang - (j >> 1)`, and no row ever moves left. This held on 2,016 cells, eight sizes of seven faces, recorded by [[probe:glyphs]].
- [[refused]] Anchoring the lean at the baseline swings descenders to the left, and no angle fixes that. Pairing the rows from the bottom is right only where the cell has an even number of rows. It failed Fixedsys at every size.
- [[measured]] A stroke design leans in a different way. It moves its coordinates rather than its rows, by `floor(cell / 2)` at the top. See [[fonts:4]].

## An outline is sheared, by whole pixels

- [[measured]] The lean is `floor(ppem / 3)` pixels over one em. That is 4/12 at twelve per em, 5/16 at sixteen and 6/20 at twenty, and exactly a third only where three divides the size. Fitted one size at a time over about two hundred (size, height) pairs, it has no constant term. See [[fonts:3]].
- [[refused]] A fixed slope of three tenths. It was the sharpest minimum in a sweep over constants, but the sweep was over the wrong family of curves. Replacing it with the whole-pixel lean took `symbol-slant` and `symbol-shapes` to 288 of 288.
- [[measured]] Each point's scaled coordinate and its shear term are rounded to a sixty-fourth separately and then added. Once the outline was sheared this way, every slant instrument became exact: `slant-angle`, `slant-baked` and `slant-width` at 288 of 288. Rounding the shear term down cost four records, so it was refused.
- [[refused]] Several earlier sections concluded that the outline is not sheared at all. They tested a fixed slope and a shift of the finished bitmap's rows. Shifting rows had at best 1,665 wrong pixels, against about 460 for the shear it replaced. Those sections are superseded.
- [[measured]] The glyph is drawn from the raw outline, and no program runs. It is placed by its side bearing rounded to a **whole pixel**, where an upright glyph is placed to the sixty-fourth. That was worth fifteen records. A bearing of exactly half a pixel rounds down.
- [[inferred]] Why the bearing is carried in whole pixels is not read out of the binary. FONTS.md's guess is that GDI places the transformed glyph by the integer metrics it keeps for it.
- [[refused]] Hinting before shearing (440 wrong pixels against 404), and leaning from the bottom of the cell. At sixteen per em, `g` needs any such constant below 0.33 px and `1` needs it above 1.31 px.

## Stub control is off for a slanted glyph

- [[measured]] A slanted cell inks exactly the rows its upright cell inks, 88 of 88. The same parallelogram, written into the outline and drawn upright, loses its tip row in 18 of them, because stub control refuses to rescue it. See [[topic:scan-conversion]].
- [[measured]] The exemption applies in both dropout passes. The vertical pass needs it too, because a sub-pixel dot slanted can come back as two pixels, and upright it never does: none of 102 upright dot cells came back as two, against ten of 92 slanted ones. Exempting both passes was worth twelve records of the corpus.

## The box

- [[measured]] The box a slanted glyph is scan-converted in is left behind on the calling program's stack, since a DLL runs on its caller's, and [[probe:stack]] read it out. The box's left edge is `round(x * ppem / 32) + round(m * y / 32)` with `m = floor(ppem / 3)`, then `(v + 31) >> 6`. Its right edge is built the same way, with 32 in place of 31, and is never less than the left edge plus one. This matched 948 of 948 boxes, from eight instruments at sixteen sizes. Folding the two roundings into one matches 945.
- [[refused]] Building the box from the sheared corners of the bounding box. That costs five records wherever a glyph's leftmost point is not also its lowest point, so the box is taken as the minimum over the sheared points.
- [[measured]] A synthesised bold leaves the box unchanged, byte for byte. See [[topic:synthetic-bold]].

## What it costs a measurement

- [[measured]] A slanted glyph's advance is the scaler's unhinted one. The two phantom points are each scaled and rounded to a sixty-fourth, and the advance is their difference, rounded to a pixel. This matched 6,014 of 6,014 advances in [[probe:hinting]]. The pen steps by that advance as well: sixteen of sixteen slanted pairs in [[probe:glyphs]]. See [[fonts:5]].
- [[measured]] The advance is taken at the **whole** horizontal size, not the fractional one. On an EGA, the whole size gives all twelve of Symbol's italic specimen extents, and the fractional size gives six.
- [[measured]] The size is not chosen again for the slant. Twelve-pixel Symbol stays at nine per em. Its ascent and descent are reported as the design values scaled and rounded, 9 and 2, not the table's fitted 9 and 3.
- [[read out]] `GetTextExtent` adds half the cell less one for a slant the device's `TEXTCAPS` leaves to GDI (seg1 `3cf3`–`3d08`). [[probe:simext]] measured 192 of 192 on each display, and Symbol's slants agreed from the start. See [[fn:GDI.GetTextExtent]].

## Turned, and on a pixel that is not square

- [[measured]] A turned slant is a single matrix. GDI adds a floored third of the first row to the second: `[a, b; -b + floor(a / 3), a + floor(b / 3)]`. This matched ten of ten of [[probe:rotstyle]]'s slants. Shearing by the upright lean and then turning matched nine, and composing with rounded entries matched eight. See [[fonts:8u]] and [[topic:turned-text]].
- [[read out]] The shear comes before the stretch. `6f63` adds the third, and `6fa3` then stretches the across entries of the sheared matrix. [[probe:rotstyle]] on a Hercules is 190 of 190.
- [[measured]] On an EGA, `floor(ppem / 3)` is carried across the aspect at the fractional horizontal size and rounded again. That gave 340 of 352 cells. The whole size gives 322. Un-shearing the box with half-sixty-fourths rounded down brings it to 352. Which way an exact half goes in the aspect product is not measured. See [[fonts:8d]] and [[topic:non-square-pixels]].

## Still open

- [[measured]] The last two recorded cells were Symbol slanted at a thirty-two-pixel cell. They were fixed by a spline rule that has nothing to do with the slant: the point between two off-curve controls is `(a + b + 1) >> 1` of the scaled coordinates. That rule put the glyph corpus at 6,046 of 6,046. Six slant readings were refused on the way, including the shear's rounding, the lean and the bitmap row shift. See [[fonts:9]].
- Not yet read: why a slanted glyph's bearing is carried in whole pixels, and which way an exact half goes when the lean is carried across the aspect. Both rules are measured and neither is named.

The whole derivation, including every refused alternative and its count, is in [[fonts:3]] ("Synthesised styles" and the slant sections before it), [[fonts:5]] and [[fonts:8u]].
