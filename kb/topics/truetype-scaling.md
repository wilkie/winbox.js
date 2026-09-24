---
kind: topic
name: TrueType scaling and hinting
summary: How Windows 3.1 turns a TrueType glyph into pixels at a size — which table answers each metric, how the hint program is run and where it differs from a reading of the spec, and what changes under a width and above two hundred and fifty-six pixels across.
probes:
  [
    font,
    glyphs,
    hinting,
    charscal,
    widths,
    maxwidth,
    stemsize,
    stemwide,
    stemedge,
    stemstyl,
    scalemem,
    symadv,
    bands,
    dropsize,
    dropdown,
    scanleak,
    symbig,
  ]
---

A TrueType glyph reaches the page in three steps: the metrics are looked up where the font tabulates them, the outline is scaled and its hint program run, and the result is scan-converted (see [[topic:scan-conversion]]). Which size is chosen for a request is the mapper's business; see [[topic:font-mapper]]. Every rule below is measured against Windows 3.1, most of them through readouts built into fabricated fonts.

## Metrics come from tables

- [[measured]] The ascent and descent are `VDMX`'s hinted extent at the size; the height is their sum, the internal leading the height less the size, and the external leading `lineGap` scaled. Arial asked for a sixteen pixel cell settles at thirteen pixels per em and reports 13, 3, 16 and 3, all from the table. See [[fn:GDI.GetTextMetrics]].
- [[measured]] Below the smallest size `VDMX` covers, the extent is the `OS/2` ascender and descender scaled and rounded — heights one to fourteen, three families.
- [[measured]] `VDMX` holds one group per aspect ratio. A square pixel reads the catch-all group; reading the first group instead is right at three sizes in four and a pixel of internal leading out at the rest.
- [[measured]] Above the largest size `VDMX` tabulates (255 in every face 3.1 installs), the extent is computed by scaling. Once the scaled extent reaches the top of the table the table is not consulted at all; taking the larger of the two answers 253 at a cell of 280 where Windows answers 247. See [[fonts:8l]].
- [[measured]] `tmMaxCharWidth` for an upright request is the `head` box: each end scaled to a sixty-fourth, the difference rounded to a pixel — all 927 maxima recorded.

## Where an advance comes from

- [[measured]] A glyph's advance is asked of three places in order: `hdmx` where it tabulates the size, then `LTSH` — at or above the glyph's threshold the advance is the design advance **scaled, not hinted** — then the hint program. Arial's `W` at eighty-nine pixels per em hints to 89, scales to 84, and Windows reports 84. `LTSH` took `font`'s `CreateFont` records from 2,643 of 2,655 to 2,654. See [[fn:GDI.GetCharWidth]].
- [[measured]] The advance phantom is rounded to a whole pixel **before** the program runs, and the origin is added after the rounding. It moved recorded glyphs from 83 of 90 to 85 and single-character advances from 391 of 412 to 402.
- [[measured]] `hdmx` is a table baked in by the font's builder, whose rasteriser does not round the phantom. With the rounding off, this interpreter reproduces 22,051 of its 22,056 advances; it is a check on the interpreter, not on Windows' advance.
- [[read out]] Courier New carries neither table, so every one of its advances runs the program.

## Before the program runs

- [[measured]] Where `hmtx`'s side bearing and `glyf`'s `xMin` differ (Symbol and a few glyphs of the two italic Times), the outline is moved onto the bearing in font units before scaling, and the origin phantom starts at nought. Moving it after the program instead gives the same picture and the wrong advance.
- [[measured]] The whole-pixel part of that bearing is carried outside the outline, in the bitmap's position, rounded toward zero; only the remainder stays in the outline. All 549 readings at three magnifications fit this.
- [[measured]] The coordinate and the bearing are scaled separately and added: 165 of 165 exact readings, against 126 for scaling their sum once.
- [[measured]] An outline coordinate that scales to exactly half a sixty-fourth rounds upward, not outward — the last of 846 recorded glyphs, Courier New's `g` at ten. See [[fonts:7]].

## The interpreter

- [[inferred]] The graphics state has two lifetimes: the round state, minimum distance, cut-in, single width, auto flip and delta base and shift belong to the size and outlive `prep`; the zone pointers, reference points, loop counter and vectors reset before each glyph.
- [[measured]] The instruction set is complete for this installation: every glyph of the eleven installed TrueType files runs to the end at five sizes, 9,020 runs, none refused.
- [[inferred]] `MIAP` and `MIRP` on a twilight point place it, setting both its position and where it is remembered as starting. `MIRP` flips a control value to the sign of the distance it replaces.
- [[measured]] The minimum distance takes its sign from the outline's distance, so a distance that rounds to exactly nought is pushed to the side the outline has it on.
- [[documented]] `DIV` truncates and `MUL` rounds. Making both round cost Arial Bold's `j` a whole pixel through a control value `prep` computes.
- [[measured]] `MDRP` with the round flag breaks a half upward: 2.5 pixels at twenty per em becomes 3.
- [[measured]] The control value cut-in applies only to a `MIRP` that rounds, and the comparison is strict. Courier New's `w` serif stays on its control value at every cell from 120 to 252. Both halves are needed: 238 of 238 `stemsize` records on each display, against 223 and 208 with neither. See [[fonts:8i]].
- [[measured]] `IP` takes its proportion from design coordinates, not the quantised scaled ones, and **extrapolates** a point outside its references rather than carrying it rigidly — twelve waist readings of Times New Roman's `8` went from 12 wrong to none.
- [[inferred]] `IUP` moves only untouched points.
- [[measured]] `IUP` rounds; it takes its ratio in design units but decides which points lie between the anchors in the scaled frame, and a point outside the anchors moves with the nearer one. Recorded glyphs 826 of 846 to 844, and six readouts exact.
- [[refused]] `IUP` truncating was fitted while `IP` was wrong and loses once `IP` extrapolates (25 records, 35 pixels against 20 and 28). Interpolating wholly in design units takes recorded glyphs to 742 of 846.
- [[measured]] A `DELTAP` moves its point along the freedom vector until its projection moves by the step, not by adding the step to the coordinate — the last sixteen recorded cells, from Courier New Bold's `K`. The delta base is 9.
- [[measured]] The engine compensation is nought for both black and white distances: 28 wrong of 22,056 `hdmx` advances at nought, 232 or more at any four sixty-fourths either way.
- [[measured]] Courier New's `prep` sets `INSTCTRL` bit 0 below nine pixels per em, and Windows honours it: no glyph program runs there. Ignoring it cost 8 `CreateFont` records and 36 recorded glyphs.
- [[measured]] A glyph with no program of its own is still scan-converted with the dropout setting `prep` left: Courier New gives dropout control up above forty-four pixels per em and Arial above seventeen. `bands-cour-hairs-ega` went from 252 of 288 to 288. See [[fonts:8h]].

## Under a width

- [[read out]] GDI never forms a horizontal size. Its realiser (`GDI.EXE` seg3 `0x21fb`) builds a horizontal denominator `MulDiv(dfPoints, logPixelsY, (logPixelsX * ratio) >> 8)` from the 8.8 stretch; the `>> 8` puts it on a coarse ladder. See [[fonts:8b]].
- [[measured]] That denominator is capped at a sixteen-bit 32,768: wrong on none of 3,861 `maxwidth` records, where the uncapped form is wrong on 158.
- [[measured]] The whole horizontal size the program runs at is `MulDiv((ppem * ratio) >> 8, logPixelsX, logPixelsY)`: the stretch truncated first, then carried across the aspect. 584 of 584 EGA `charscal` rows.
- [[measured]] `LTSH`'s threshold is compared against the **vertical** size and the linear advance scaled by the horizontal one: `charscal` 124,992 of 124,992 advances, against 124,533 gating on the horizontal. `hdmx` is never asked under a stretch.
- [[measured]] Where the program runs, the advance is the hinted one at the whole horizontal size.
- [[measured]] The control values are scaled at the larger of the two sizes and read through the stretch; `MPPEM` answers the horizontal size (681 of 780 `stemwide` EGA records, against 429 for the vertical).
- [[measured]] Stretched design coordinates keep their fraction in `IP` and in `MDRP`'s design distance (1,923 to 1,941 of 1,944 stretched cells). Where the two sizes differ, `MDRP` carries each component of its measurement to pixels before projecting; `stemwide` is 780 of 780 on all three displays.
- [[refused]] Truncating the stretched design x to a whole unit fits the one `w` it was built for and costs 171 `stemstyl`, 65 `stemwide`, 35 `stemedge`, 42 `glyphs`, 20 `widths` and 55 `symbig` records.

## Fitted at half the size

- [[measured]] A face whose `head.xMax`, scaled by the horizontal size, passes 256 pixels (strictly) has its glyphs fitted at half the size — each size halved and rounded to a whole pixel per em on its own — and the result doubled. `stemedge` 220 of 220 and `stemwide` 779 of 780 on an EGA, against 180 and 737 for an unrounded half and 155 and 714 for a floor. Read in [[probe:scalemem]]: the scaler's buffer carries both sizes and a flag at `+0x1606` that turns on at that cell, with the bitmap metrics halved beside it. See [[fonts:8k]].
- [[measured]] Four fabrications moving only `head`'s box say the trigger is `xMax`, not the height or the size: half as wide never halves, half again as wide halves from the smallest cell asked.
- [[refused]] The obvious trigger, a horizontal size past 256, cost Courier New's `stemsize` 238 of 238 down to 154.
- [[measured]] An advance run through the program above the crossing is doubled in sixty-fourths and rounded once, so it can be odd; Symbol crosses at 231 pixels per em and its delta and omega are right at all fourteen sizes above it. See [[fonts:8s]].
- [[measured]] Above forty pixels per em, Symbol and Wingdings are exact too: 1,664 `symbig` records on four displays. See [[fonts:8m]].

## Dropout at large sizes and first realizations

- [[measured]] The size above which a run no sample column covers is not rescued applies only on a square pixel: 420 and 415 of 840 EGA records, against 325 and 330 for the vertical size everywhere. What a stretch does to lift it is not yet read. See [[fonts:8g]] and [[topic:scan-conversion]].
- [[measured]] On an EGA, the first size a face is realized at can be scan-converted differently from the same size realized later, and the choice is cached per face and size. Not modelled; the five cold records are left unclaimed.

The derivations are in [[fonts:5]], [[fonts:7]], [[fonts:8b]], [[fonts:8g]], [[fonts:8h]], [[fonts:8i]], [[fonts:8k]], [[fonts:8l]], [[fonts:8m]] and [[fonts:8s]].
