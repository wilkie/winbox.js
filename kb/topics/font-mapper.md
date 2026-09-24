---
kind: topic
name: The font mapper
summary: How Windows 3.1's GDI turns a LOGFONT into one installed face at one size — the rewrites, the lookups that answer before any scoring, the scored competition, and how a bitmap strike is stretched.
probes: [font, styles, widths, rotsize, tiepick, tiewide]
---

A program describes the font it wants, and GDI answers with the nearest thing installed. That answer comes from four stages, run in order: `CreateFontIndirect` rewrites the request, a set of lookups answers many requests outright, a scored competition decides the rest, and the winning strike is stretched to size. Every stage below has been read out of `GDI.EXE` segment 3 and holds against every recorded request: the `font` sweep is 5,057 of 5,057 on both the VGA and the EGA, and the face chosen agrees on all 996 requests of each.

## Three kinds of font

- [[read out]] A bitmap strike (`.FON`) comes in a fixed set of sizes. A plotter face (`.FON`) is one stroke design drawn at any size, and the low bit of `dfType` marks it. A TrueType face (`.TTF`, installed through a [[format:fot]] stub) is one outline per style. Nearly every rule below applies to only one or two of the three. See [[fonts:1]].
- [[measured]] A TrueType family is four separate files, and a request for italic opens the italic file instead of slanting the regular one. Arial's italic reports an overhang of zero, and at twenty-four pixels it is narrower than the regular, 101 against 106.

## What `CreateFontIndirect` rewrites

- [[read out]] Before anything else sees the request, `GDI.EXE` seg3 `0042` compares the face name's atom with five well-known names. `Symbol`, `ZapfDingbats` and `Zapf Dingbats` set `lfCharSet` to `SYMBOL_CHARSET`, `Tms Rmn` sets it to `ANSI_CHARSET`, and `Helv` forces `VARIABLE_PITCH`. So Symbol requested in the ANSI set reaches the mapper as a symbol-set request. `Terminal` and `Wingdings` are not on the list and get no such excuse. See [[fn:GDI.CreateFontIndirect]].
- [[read out]] The two atoms that every later search matches against are made at `0bc0`: one for the face name, and one for the name `WIN.INI`'s `[FontSubstitutes]` gives it. Between the two steps, a request for `System` that also asks for `FIXED_PITCH` becomes `FixedSys`. The top four bits of `lfClipPrecision` are moved into a private flags byte at `0b1a`.
- [[measured]] `GetTextFace` repeats the name the program asked for only when `[FontSubstitutes]` redirected it. A request for `Helv` reports `Helv`. A request for `ms sans serif` reports `MS Sans Serif`.

## Answered before any competition

`RealizeFont` calls the routine at seg3 `0e95` before the mapper runs. The mapper at `0550` runs only when that routine returns nought.

- [[read out]] **An exact strike** (`0ef6`). A raster entry whose name, `dfPixHeight`, `dfAvgWidth`, `dfWeight`, `dfCharSet` and both resolutions all equal the request is taken without any scoring. The request must also ask for no italic, underline or strikeout and no escapement or orientation. This arm runs only while TrueType is enabled.
- [[read out]] **The TrueType directory** (`1145`). An outline entry is taken when its name matches and its character set, italic flag and weight all equal the request's. An `lfWeight` of nought counts as 400, and `DEFAULT_CHARSET` matches any set. Symbol has no bold file and no italic file, so bold or italic Symbol is never found here and goes to the competition.
- [[read out]] **The floor below twelve pixels** (`13f3`, `cmp ax,0xb`). The request must name an ANSI, variable-pitch TrueType face, must be upright, and must ask for a height of eleven pixels or fewer (or a negative height of ten or fewer). Such a request first tries the small lookup at `126a`. The request must also be in the ANSI or default set. That lookup wants an exact cell in `MS Serif` and then in `Small Fonts`, or only in `Small Fonts` when the request's family is `FF_SWISS`. It checks the name, the cell and the device's resolutions, and nothing else.
- [[measured]] For that reason Arial at 3, 5, 6 and 8 pixels answers with Small Fonts, at 10 and 11 with MS Serif, and at 1, 2, 7 and 9 with Arial itself. At nine, Arial comes back with a cell of seven. Courier New is fixed pitch and Symbol is in the symbol set, so neither ever falls back. See [[fonts:3]].
- [[read out]] **Defaults** (`12c8`). When no name matched and the height is twelve or more, the pitch and family choose one TrueType atom, which is looked up at the weight and slant requested. A name that is not installed anywhere, such as `Nonesuch`, gets Times New Roman this way.
- [[measured]] A request that names no face is always answered by the competition. On a VGA, `FIXED_PITCH` gets Courier, `FF_ROMAN` gets MS Serif, and `FF_SWISS` or no family gets MS Sans Serif.

## The competition

- [[read out]] The mapper walks the raster and vector table first, then the TrueType directory, and scores every entry with the routine at seg3 `17b4`. The loop keeps the lowest score and stops early on a score of nought. The outline pass replaces the raster pass's answer only when it scores strictly lower, so a tie goes to the strike. That is why a VGA answers a request with no face name with MS Sans Serif's exact sixteen-row strike.
- [[read out]] The weights are twenty-eight words at `0x39c` in data segment 48, each multiplied by 1024. A device can supply its own table. The large terms are:

  | Mismatch                                 | Cost   |
  | ---------------------------------------- | ------ |
  | Character set                            | 65,000 |
  | Name matches neither atom                | 10,000 |
  | Name matches only the substitute atom    | 500    |
  | Fixed pitch requested, variable received | 15,000 |
  | Variable pitch requested, fixed received | 350    |
  | Family                                   | 9,000  |
  | Height, per pixel either way             | 150    |
  | Extra charge for the tall side           | 600    |

  Italic, underline and strikeout mismatches cost 4, 3 and 3. The weight costs `3 * MulDiv(1, |lfWeight - dfWeight|, 10)`.

- [[read out]] An outline pays nothing for size. The test at `1ba6` skips every size, width and aspect term for a scalable candidate. The only size charge is 750 when the height is within two pixels of nought, which is why Arial requested at one pixel answers two.
- [[read out]] For a scalable candidate, the name is compared with two names from the `.FOT` stub: the family name and the TrueType full name (`1862`, `1879`). `Arial Bold` at nine pixels is therefore Arial's bold file, reported under that name.
- [[measured]] A square pixel is free, and an off-square pixel is not. The off-square term costs 30 per hundredth of `MulDiv(100, ASPECTY, ASPECTX)` away from the strike's shape: 126 on an EGA, against 133 for the logical resolution and 79 for the raw aspect. So every EGA strike pays 210, and an outline wins wherever the name does not decide. See [[topic:non-square-pixels]].
- [[measured]] Where two strikes are both exact, their weight separates them, and after that their order in the directory does. The directory order is the order of the font files' resources, and MS Serif's ten- and eleven-row strikes sit at the end of `SMALLE.FON`, after Small Fonts' own.

## Weight, slant and heavier strikes

- [[read out]] If the request is heavier than `dfWeight + 150`, the candidate is scored as 120 heavier and is marked for a smeared bold (`1ee8`, bit `0x0100`). A slant that has to be synthesised costs 1 and sets bit `0x0200`. See [[topic:synthetic-bold]] and [[topic:synthetic-italic]].
- [[measured]] Weights 560 to 600 get the regular face smeared, and weights above 600 get the bold file drawn plainly: 720 of 720 at the hundreds, and 336 of 336 at the tens. See [[fonts:8a]].
- [[measured]] A face's own strike answers only in the weight class and the slant requested. `ARIALB.FON` on an EGA has regular strikes at eleven and thirteen rows and bold strikes at twelve and fourteen. Regular Arial at twelve pixels therefore answers with the outline, not with the heavier strike smeared or plain.

## Symbol, the face installed twice

- [[measured]] Symbol is the only name installed both as a `.FON` and as a `.TTF`. The strike wins only at thirteen and sixteen pixels, the two sizes `SYMBOLE.FON` holds below the floor. At eight pixels Symbol answers with a seven-row cell drawn from the outline, not with Small Fonts, because an ANSI strike is not an answer to a symbol request.
- [[measured]] Bold or italic Symbol goes to the competition, where the strike and the outline both pay nothing for the character set. On a VGA they tie and the strike is kept. On an EGA the strike pays 210 for its shape and the outline wins.
- [[measured]] An outline's pitch and family are not taken from the `.TTF`. They come from the `FONTDIR` entry of its `.FOT`: `0x17` (`FF_ROMAN`) for Symbol and `0x07` (`FF_DONTCARE`) for Wingdings. The installer derives that byte from PANOSE. See [[fonts:8c]].
- [[measured]] A turned request skips the exact-strike arm and the small lookup. Symbol at sixteen pixels turned is therefore its outline, and Arial at eight pixels turned is Arial. See [[topic:turned-text]] and [[fonts:8u]].

## A strike's size

- [[read out]] A strike is scored once, and the number of times it must be repeated to reach the height is part of its score (`1bcb`). The multiple is `(wanted + cell / 4) / cell`, capped at eight. A strike is refused outright when the multiple plus two is not less than its own height. Each multiple costs 20. Each pixel of error costs 150, plus a flat 600 on the tall side. So being one pixel too tall costs as much as being five pixels too short.
- [[measured]] With these rules the height is exact for all 302 heights of six faces from 1 to 120 pixels. Twenty-eight pixels of System answers thirty-two. Fixedsys steps at `15m - 3`, and System at `16m - 4`.
- [[read out]] The width multiple is at most five (`1d8c`). Four hundredths are charged for each hundredth between the two multiples (`1e66`). Asked for 60 pixels, Small Fonts therefore answers with its eleven-row strike five times, not its ten-row strike six times.
- [[measured]] If every strike in a family is refused, the family has no answer. On an EGA, Fixedsys and Small Fonts at 78 pixels or more answer Arial: 41 of 41.
- [[read out]] At `PROOF_QUALITY` no strike is stretched: `17b4` returns `0x7fffffff` for any strike that would have to be.
- [[measured]] A display without `RC_BIGFONT` (the Hercules) must fit the realised font in one 64 KB segment. The horizontal multiple is reduced until it fits (62 of 62). Once it reaches one, the vertical multiple is reduced instead, and this happens after scoring, not during it. Displays with the bit keep the width multiple as `min(V, 5)`. See [[fonts:3]].

## An outline's size

[[measured]] At a cell of 255 or more, a request that several sizes grid-fit to the same cell gets the largest of them whose unhinted extent, rounded once, still fits the cell. Below that it gets the first. This holds for all 587 recorded ties. The largest size a table lists is never the answer, and whether that rule belongs to the row or to the size is not yet explained. See [[fonts:8r]] and [[topic:truetype-scaling]].

The full derivation, with every refused reading and its count, is in [[fonts:3]].
