---
kind: topic
name: Scan conversion
summary: How Windows 3.1's TrueType scan converter turns a fitted outline into pixels — a centre-sampled fill from an integer edge walk over a polyline, then dropout control with stub exclusion and a box clamp.
probes: [glyphs, bands, dropsize, dropdown, scanleak]
---

The scan converter gets the fitted outline in sixty-fourths of a pixel. It flattens the curves into chords, walks every edge into lists of crossings, fills between them, and then rescues strokes too thin to cover a pixel centre. Most of what follows was measured first and later found in `GDI.EXE` segment 42. Earlier guesses that the binary contradicted have been dropped. See [[topic:truetype-scaling]] for what reaches the scan converter.

## The fill

- [[measured]] Pixels are filled by non-zero winding, sampled at the exact centre of each pixel. Sampling across at 0.45 or 0.55 of a pixel gives 47 or 43 wrong pixels against 8 at 0.5. Moving the scanline a sixty-fourth either way costs seventy wrong pixels.
- [[measured]] Outline points are **rounded** onto the sixty-fourth grid before any crossing is found. On the fabricated fonts rounding scores 3,904 exact cells, truncating 3,818 and ceiling 3,838.
- [[read out]] The edge that opens a run rounds as `(x + 31) >> 6`, and the edge that closes it as `(x + 32) >> 6`. They differ only when an edge lies exactly on a pixel centre, and then a run that ends there is one pixel longer (segment 42, `0x1342` block). [[measured]] Adding this took the recorded letters from 733 to 744 of 846.
- [[read out]] The lists are filled with a winding count that sets bits where the count leaves nought and clears them where it returns (segment 42 `0x059b`). [[refused]] Treating the loop as a search, with each `on` looking for any equal `off`, costs 3,273 of 24,696 fabricated cells, so the lists are paired by index.

## The edge walk that ships

- [[read out]] Lines are walked with a determinant rather than solved. Eight steppers, four quadrants by two scan kinds, are reached only through a table at `ds:0x4a4` in the scaler's own data segment, 47. A positive determinant steps a column and a negative one steps a row. At nought the walk steps a row, as this implementation does (segment 42 `0x16d3`–`0x19a3`).
- [[read out]] **There is no conic walk.** Each curve is halved a number of times chosen from its second difference, clamped to between one and eight. It is then evaluated at equal steps, every point is rounded to a sixty-fourth, and the chords go to the line walker. Each chord's endpoint also goes through the endpoint topology. This is segment 44 (386) or 45 (286), called through the thunk at `0x19a4`. [[measured]] Implementing it took fabricated cells from 6,165 to 6,441 of 7,050 and the letters still in dispute from 68 to 33.
- [[refused]] Flattening chosen by chord length or distance is worse than a true conic walk at every threshold. At 128, 64 and 32 sixty-fourths it gives 2,347, 2,332 and 2,794 wrong pixels against 2,180. The binary's depth comes from curvature, and its rounding is fixed.
- [[read out]] At a vertex lying exactly on a sample line, the endpoint topology decides the turn from the **sign of the cross product** of the edges into and out of the vertex, together with the quadrant, rather than by comparing the three points (segment 42 `0x1342`–`0x150e`). [[measured]] Transcribing it made the fabricated glyphs 24,696 of 24,696, up from 24,689.
- [[read out]] Segment 43 has an element walk of its own, but it is the smart-dropout path. It is reached from segment 8 and from a table of five callbacks, while the scaler in segment 36 calls only segment 42. No installed face asks for smart dropout, so segment 43 never runs here.

## Dropout control

- [[measured]] Each font's `prep` asks for dropout control with `SCANCTRL`: Arial `0x111` (17 pixels per em and below), Times New Roman `0x17c` (124 and below) and Courier New `0x12c` (44 and below). All ask for `SCANTYPE` 1, simple dropout control with stubs excluded.
- [[read out]] GDI builds the scan kind as `SCANCTRL | (SCANTYPE << 16)`, or nought when control is off (segment 36 `0x2374`). The caller then skips the dropout pass completely (segment 42 `0x0580`). Bit 0 of the high word gates the stub check, and the kind is masked to that bit on entry, so the binary has no smart placement at all.
- [[read out]] A dropout is a **zero-length run**, where an `on` equals an `off` (segment 42 `0x0a61`). Rows and columns both get rescues from lists the one walk fills. [[measured]] The fabricated fonts have 134 thin shelves that miss every scanline beside a post, and Windows inks all 134.
- [[read out]] A row rescue takes the pixel one to the left of the `on` pixel, `floor(to − 0.5)`, and a column rescue takes the row below. The rescue is skipped when the other candidate pixel is already lit (`0x0c8a`, `0x0cf3`). [[measured]] That check is worth 34 letters.
- [[read out]] The stub check calls `0x0e28` and `0x0eaa`, and each makes three calls to the counter at `0x0db4`. The stroke must show at least two crossings on each side or the pixel is refused. The counter only tests whether an `on` and an `off` are present, so it returns 0, 1 or 2 rather than a tally. [[measured]] The rescue from a column reads its neighbours asymmetrically. Written that way it scores 747 letters, and written symmetrically 691.
- [[read out]] The box is a parameter of the scan converter, and it limits where a rescue can land. [[measured]] A row rescue is clamped into it, from `ceil(xMin − 0.5)` to `max(boxLeft + 1, floor(xMax + 0.5))`, and that took fabricated wrong pixels from 4,597 to 3,087. Clamping column rescues as well took the letters from 761 to 763. The box may collapse in `y`, and a column rescue outside the band is then not drawn, which was worth 99 cells and 704 pixels. It may not collapse in `x`.

## Banding

[[measured]] Banding does not matter here. `RASTERCAPS` for VGA has `RC_BANDING` clear, and [[probe:bands]] drew 38 rescued strokes up to 114 scanlines tall without one hole. At sixty to a hundred and eighty pixels the stock faces agree on 142 of 144 records per face, and the four that differ are a buffer limit, not a band. The box is still needed.

## Measured, not yet found in the binary

- [[measured]] If a glyph's box would collapse in `x`, the stub check is skipped and each column is drawn as one run spanning the box. This took `cour-stubs` and `cour-gaps` to 258 of 258, and neither rule has been found in segments 42 or 43.
- [[measured]] A run that covers no sample column is rescued only below 48 pixels per em ([[probe:dropsize]]), unless the box has collapsed in `x`. The limit applies only on square pixels. On an EGA nothing stops. Why a stretch removes it is not known.
- [[measured]] On an EGA, the first size a face is realized at is not rescued like later ones, and the result is then kept for that size. [[probe:dropdown]] and [[probe:scanleak]] show this, and the implementation does not model it.

## Tried and dropped

- [[refused]] Rounding each crossing to sixty-fourths costs 26 of 846 glyphs. Using `FixedDiv` on crossings gives 729 letters against 763. The simple path never computes a subpixel crossing.
- [[refused]] Treating a pixel as a disc of any radius adds wrong pixels all around the glyph: 28,322 against 388 at radius 0.7071.
- [[refused]] A continuity rule made up during this work was removed, which took the letters from 747 to 760. So was a half-pixel stub width, which the upright bars contradict: 390 of 390 are rescued at any width. Deleting the sweep down columns was reversed once `cour-shelves` showed the bars had been a degenerate glyph.

[[measured]] With the endpoint topology transcribed, every fabricated glyph is exact: 24,696 of 24,696, and all six instruments. The full derivation is in [[fonts:6]], and what was read out of `GDI.EXE` is in [[fonts:8]], [[fonts:8e]] and [[fonts:8g]].
