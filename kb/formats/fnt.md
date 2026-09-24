---
kind: format
name: .FNT font resources and .FON libraries
summary: The bitmap and stroke fonts of Windows 3.x, one FONT resource per strike inside an NE library — the fields winbox.js reads, and what Windows 3.1's own .FON files hold.
---

A `.FON` file is an [[format:ne]] library with no code whose resources are fonts. Each `FONT` resource is one complete `.FNT`: a header, a character table, and then either bitmaps or strokes. A `FONTDIR` resource beside them repeats each font's header so GDI can enumerate the file without reading every font. The same header is what a [[format:fot]] carries for a TrueType face. Which of these strikes answers a request is the [[topic:font-mapper]]'s business; the long form is [[fonts:1]], [[fonts:3]] and [[fonts:4]].

## The resources

- [[documented]] `FONTDIR` is resource type `0x8007` and each `FONT` is `0x8008`. The directory is a word count, then for each font a word ordinal and a directory entry: the first 113 bytes of the header below, with a reserved dword where the bits pointer would be, followed by the device and face names.
- [[measured]] In each of the 34 `.FON` files installed on the VGA and EGA drives (16 and 18), the resource table holds one `FONTDIR`, one `FONT` per strike, and one resource of type `0x8010`; the directory's count equals the number of `FONT` resources. The non-resident name is `FONTRES`, then the aspect and two resolutions the file is cut for — `100,96,96` for the VGA sets, `133,96,72` for the EGA's, `200,96,48` for the CGA Terminal files — or `CONTINUOUSSCALING` for the three plotter files, then a description such as `MS Serif 8,10,12,14,18,24 (VGA res)`.
- [[measured]] winbox.js reads every `FONT` resource in resource-table order (`src/raster/bitmap-font.ts`, `BitmapFont.load`), and that order is the one the mapper breaks ties with: see the `SMALLE.FON` finding below and [[fonts:8a]].

## The header

Offsets are from the start of the `FONT` resource. A version 2.0 header ends at `0x76`; version 3.0 adds flags, spacing and a colour pointer and ends at `0x94`.

| Offset | Size | Field               | Meaning                                                                               |
| ------ | ---- | ------------------- | ------------------------------------------------------------------------------------- |
| `0x00` | 2    | `dfVersion`         | `0x0100`, `0x0200` or `0x0300`                                                        |
| `0x02` | 4    | `dfSize`            | the resource's length in bytes                                                        |
| `0x06` | 60   | `dfCopyright`       | a text string                                                                         |
| `0x42` | 2    | `dfType`            | bit 0 set for a stroke (vector) font, clear for a bitmap                              |
| `0x44` | 2    | `dfPoints`          | the nominal point size                                                                |
| `0x46` | 2    | `dfVertRes`         | the vertical resolution it was designed for, and at `0x48` the horizontal             |
| `0x4a` | 2    | `dfAscent`          | rows above the baseline                                                               |
| `0x4c` | 2    | `dfInternalLeading` | and `dfExternalLeading` at `0x4e`                                                     |
| `0x50` | 3    | `dfItalic`          | then `dfUnderline` and `dfStrikeOut`, a byte each                                     |
| `0x53` | 2    | `dfWeight`          | 400 regular, 700 bold                                                                 |
| `0x55` | 1    | `dfCharSet`         | 0 ANSI, 2 symbol, 255 OEM                                                             |
| `0x56` | 2    | `dfPixWidth`        | the cell width of a fixed-pitch font, nought for a variable one                       |
| `0x58` | 2    | `dfPixHeight`       | the cell height in rows                                                               |
| `0x5a` | 1    | `dfPitchAndFamily`  | pitch in the low bits, family in the high nibble                                      |
| `0x5b` | 2    | `dfAvgWidth`        | and `dfMaxWidth` at `0x5d`                                                            |
| `0x5f` | 4    | `dfFirstChar`       | then `dfLastChar`, `dfDefaultChar`, `dfBreakChar`; the last two relative to the first |
| `0x63` | 2    | `dfWidthBytes`      | bytes per row of a single strike bitmap                                               |
| `0x65` | 4    | `dfDevice`          | offset to the device name, nought if none; `dfFace` at `0x69`                         |
| `0x71` | 4    | `dfBitsOffset`      | where the glyph data starts; `dfBitsPointer` at `0x6d` is filled at load              |

The layout is [[documented]]. The offsets are also [[read out]] of GDI: the mapper's scoring frame lands on `dfPixHeight` at `0x58`, the leadings, `dfAvgWidth` at `0x5b`, `dfWeight` and `dfItalic`, and the raster candidate's pointer on `dfType` at `0x42` (`seg3:068d`–`06b0`, [[fonts:3]]); `GetTextMetrics`' filler at `seg3:0x0222` reads the same fields relative to `dfType` ([[fonts:8a]]).

## The character table and the glyphs

- [[documented]] The table follows the header, one entry per character from `dfFirstChar` to `dfLastChar`: a word width and an offset, a word in a 2.0 font (4 bytes an entry, table at 118) and a dword in a 3.0 font (6 bytes, table at 148). A character outside the range is drawn as the default character.
- [[documented]] A bitmap glyph is stored in columns eight pixels wide: `dfPixHeight` bytes for the first eight columns, top row first, then the next eight, most significant bit leftmost. winbox.js reads it that way (`characterEntryFor`).
- [[measured]] All 91 bitmap strikes on the two drives are version `0x0200` with `dfType` nought; the six plotter fonts are `0x0100` with `dfType` 1. [[read out]] The 386 build of `VGA.DRV`'s `StrBlt` accepts only a version 3.0 font whose `FONTINFO` begins at `0x42` (seg2 `099b`, [[fonts:8u]]); how a 2.0 file reaches it is not yet measured.

## The plotter fonts

- [[measured]] `ROMAN.FON`, `MODERN.FON` and `SCRIPT.FON` each hold one version `0x0100` font with `dfType` 1, `dfCharSet` 255, characters 32 to 255, a design 32 rows tall (Script's 37) and resolutions of 3 horizontal by 2 vertical. Their `dfPitchAndFamily` is `0x11`, `0x31` and `0x41`.
- [[inferred]] Their character table starts at 119, which no documentation to hand gives: it is the only offset whose widths reproduce the header's `dfAvgWidth` and `dfMaxWidth` for all three (`bitmap-font.ts`, `tableOffset`).
- [[measured]] An entry's offset is where its strokes **end**; the previous entry's is where they begin, and the first's begin at nought. The strokes are signed byte pairs, each a displacement the pen draws along; a `0x80` byte lifts the pen, and the pair after it is a displacement to move by without drawing. Coordinates measure downward from the top of the design. Roman's `A` is thirty bytes: a lift to (10,4), a draw to (3,25), a lift back and a draw to (17,25), a crossbar and two serifs ([[fonts:4]]).
- [[measured]] GDI adds `TMPF_VECTOR` to the pitch it reports, which the file does not carry: Roman's 17 is reported as 19 ([[fonts:4]]).

## What Windows 3.1's files hold

- [[measured]] `SMALLE.FON` holds six Small Fonts strikes and then two MS Serif strikes, ten and eleven rows; `SERIFE.FON` starts at thirteen. So MS Serif's smallest sizes come after Small Fonts' in the directory order, which is why Small Fonts wins a tie at ten pixels ([[fonts:8a]]). The EGA's `SMALLB.FON` does the same with MS Serif at eight and nine rows.
- [[measured]] MS Serif's ten row strike on the EGA (`SERIFB.FON`, 8 points) carries an average of 5 and a maximum of 11, the numbers [[fonts:8a]] records Windows reporting; the VGA's ten row MS Serif, in `SMALLE.FON`, carries 4 and 8.
- [[measured]] The EGA installs `ARIALB.FON` ("Arial 8,10 (EGA res)"): eleven and thirteen rows at weight 400, twelve and fourteen at 700. `TIMESB.FON` holds eleven and fourteen rows at 400, twelve and fourteen at 700; its fourteen row regular strike carries an average of 7 and a maximum of 13, which is what Windows reports for Times New Roman at fourteen pixels on an EGA ([[fonts:8b]]). Both use characters 0 to 255 with a default of 151. The VGA installs neither.
- [[measured]] `SYMBOLB.FON` holds Symbol strikes of 14, 16, 15, 16, 20 and 26 rows, in that order. The first two have `dfCharSet` **0**, characters 0 to 255 and a default of 151, like the Arial and Times files; the other four have `dfCharSet` 2 and characters 32 to 254. `SYMBOLE.FON`'s six are all charset 2. Those two are why a Symbol request in the ANSI set, which on a VGA pays the 65,000 charset term, has no such cases on an EGA ([[fonts:3]], [[fonts:8d]]).
- [[measured]] `COURB.FON`, described as "Courier 10,12,15 (EGA res)", has no ten point strike: its first two strikes are both 12 points and 12 rows and are byte for byte the same within `dfSize`.
- [[measured]] Terminal (`VGAOEM.FON`, `DOSAPP.FON`) is charset 255 and fixed pitch; System (`VGASYS.FON`, `EGASYS.FON`) is weight 700.
