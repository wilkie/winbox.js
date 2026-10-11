---
kind: function
module: GDI
name: RemoveFontResource
ordinal: 136
summary: Takes one add of a font file away from GDI's font table; the file's fonts go with its last.
versions:
  '3.1': exact
probes: [fontres, fontdef]
source: src/win16/gdi/AddFontResource.ts
topics: [font-resources]
---

## Observed behaviour

- [[measured]] **Adds are counted.** A file added twice answers 1 to each of two removes and 0 to a third. Its fonts stay until the second: [[probe:fontres]].
- [[measured]] **An installed raster file can be removed**, such as `SERIFE.FON` named by its bare name. Its faces leave `EnumFonts` and the mapper: MS Serif at 13 then maps to `SMALLE.FON`'s 11.
- [[measured]] **An installed `.FOT` can be removed.** Wingdings leaves `EnumFontFamilies`, and a request for it maps to Times New Roman.
- [[measured]] **Removing a `.FOT` written for an installed face** takes away only the add it made, and the face stays.
- [[measured]] **These answer 0:** a file never added, a missing file and a text file.
- [[measured]] **A raster file a realised font is cached from stays.** `SERIFE.FON` removed while MS Serif at 13 is realised in a window's DC: its faces leave `EnumFonts` and the mapper at once, but the DC keeps its font, a font made again of the same `LOGFONT` is that font, removing it again answers 0, and adding it again puts its faces back where they were. Once the font is deleted -- or taken out of a DC of two units to a pixel -- the file goes: [[probe:fontdef]].
- [[measured]] **A `.FOT` goes at once.** Wingdings removed while realised leaves the family list; the DC still holding it answers an empty `GetTextFace`.

## Inside Windows

[[read out]] The details are in [[topic:font-resources]]:

- a raster file is found as `GetModuleHandle` finds its module;
- otherwise the file is loaded and a stub is matched by its full name;
- a raster file with no adds left answers 0;
- with the last add gone, the file goes, unless fonts realised from it are still in GDI's cache, in which case it waits for them, its faces hidden.

`GDI.EXE` seg6 `0507`.

## Implementation

`FontManager.removeResource` in `src/win16/font-manager.ts`, and `crates/winbox-win16/src/fonts/added.rs`. Both keep a removed raster file's strikes out of the table while a font realised from it is cached, which in winbox.js is from the font's making to its deletion. [[probe:fontdef]] agrees on 44 of 44 records in each.
