---
kind: format
name: .FOT font resource stub
summary: The small NE library CreateScalableFontResource writes for a TrueType file, which AddFontResource installs — every byte of it.
probes: [fotmake]
---

A `.FOT` file is a stub NE library of about 1,310 bytes: header and resources, no segments, no imports, no code. [[fn:GDI.CreateScalableFontResource]] writes one for a `.TTF`, and [[probe:fotmake]] records five of them, which winbox.js rebuilds byte for byte (213 of 213 records). The full decode is in [[fonts:8c]].

## The file

| Offset  | What               | Value                                                                                                                         |
| ------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `0x00`  | DOS stub           | Microsoft's, with the message _This is a TrueType font, not a program._ and the signature `Kiesa` at `0x7a`                   |
| `0x3c`  | `e_lfanew`         | `0x80`                                                                                                                        |
| `0x80`  | NE header          | linker 5.16, flags `0x8000` (library), no segments or module references, Windows, expected version `0x0300`, resource shift 4 |
| `0x200` | one byte, `0xc3`   | the same in every recording; not explained                                                                                    |
| `0x400` | resource 204, id 1 | the `.TTF`'s path, NUL-padded to 128 bytes                                                                                    |
| `0x480` | resource `FONTDIR` | a count of 1, a font ordinal of **nought**, and one `FONTDIRENTRY`                                                            |

[[measured]] The NE header's offsets chain from three strings: the resident name (the `.TTF`'s base name) takes its length plus six bytes, the imported name (the file name) its length plus one with a length byte of the same, the entry table two bytes, and the non-resident name `FONTRES:<face>`, whose length byte is its length plus four, starts four bytes past the entry table. The file ends sixteen zero bytes after the directory's last string.

## The font directory entry

Every measurement is in the font's own design units.

| Field                          | Source                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| `dfVersion`                    | `0x0200`                                                                                   |
| `dfCopyright`                  | `Windows! Windows! Windows!`, then `10 03 01 01` after its terminator in every recording   |
| `dfType`                       | `0x4083`, as recorded; only `fHidden = 1` was recorded, so its `0x4000` may be that flag   |
| `dfPoints`                     | `head.unitsPerEm`                                                                          |
| `dfVertRes`, `dfHorizRes`      | 72, 72                                                                                     |
| `dfAscent`                     | `hhea.ascender` — not the bounding box's                                                   |
| `dfInternalLeading`            | `dfPixHeight - unitsPerEm`                                                                 |
| `dfExternalLeading`            | `hhea.lineGap`                                                                             |
| `dfWeight`                     | `OS/2.usWeightClass`                                                                       |
| `dfCharSet`                    | 2 where PANOSE's family kind is 5, else 0                                                  |
| `dfPixHeight`                  | `hhea.ascender - hhea.descender`                                                           |
| `dfPitchAndFamily`             | from PANOSE, below                                                                         |
| `dfAvgWidth`                   | `OS/2.xAvgCharWidth`                                                                       |
| `dfMaxWidth`                   | `head.xMax - head.xMin` — the bounding box, not the widest advance                         |
| `dfFirstChar` to `dfBreakChar` | 30, 255, 1, 2                                                                              |
| `dfFace`                       | 118, the offset to the face name                                                           |
| `dfReserved`                   | `head.lowestRecPPEM` in the low word, `OS/2.usFirstCharIndex`'s high byte in the high word |

Then four strings: an empty device name, the face (the `name` table's full name), the family and the style.

## The family comes from PANOSE

[[measured]] In the order the cases take precedence: a family kind of 3 is `FF_SCRIPT` and 4 is `FF_DECORATIVE`; a proportion of 9 (monospaced) is `FF_MODERN` and clears the variable-pitch bit; otherwise a serif style of 0 is `FF_DONTCARE`, 2 through 10 `FF_ROMAN`, and 11 and above `FF_SWISS`. `OS/2`'s `sFamilyClass` plays no part.

[[inferred]] The four bytes after the copyright string and the `0xc3` at `0x200` are most likely left over in the buffers they were built in. Only regular faces were recorded; a bold or italic file may name its face differently.
