---
kind: function
module: GDI
name: RemoveFontResource
ordinal: 136
summary: Takes one add of a font file away from GDI's font table; the file's fonts go with its last.
versions:
  '3.1': exact
probes: [fontres]
source: src/win16/gdi/AddFontResource.ts
topics: [font-resources]
---

## Observed behaviour

- [[measured]] **Adds are counted.** A file added twice answers 1 to each of two removes and 0 to a third. Its fonts stay until the second: [[probe:fontres]].
- [[measured]] **An installed raster file can be removed**, such as `SERIFE.FON` named by its bare name. Its faces leave `EnumFonts` and the mapper: MS Serif at 13 then maps to `SMALLE.FON`'s 11.
- [[measured]] **An installed `.FOT` can be removed.** Wingdings leaves `EnumFontFamilies`, and a request for it maps to Times New Roman.
- [[measured]] **Removing a `.FOT` written for an installed face** takes away only the add it made, and the face stays.
- [[measured]] **These answer 0:** a file never added, a missing file and a text file.

## Inside Windows

[[read out]] The details are in [[topic:font-resources]]:

- a raster file is found as `GetModuleHandle` finds its module;
- otherwise the file is loaded and a stub is matched by its full name;
- with the last add gone, the file goes, unless fonts realised from it are still in GDI's cache, in which case it waits for them.

`GDI.EXE` seg6 `0507`.

## Implementation

`FontManager.removeResource` in `src/win16/font-manager.ts`, and `crates/winbox-win16/src/fonts/added.rs`. Neither waits for fonts realised from the file.
