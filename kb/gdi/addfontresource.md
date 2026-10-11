---
kind: function
module: GDI
name: AddFontResource
ordinal: 119
summary: Adds a font file — a raster or vector .FON, or a TrueType .FOT stub — to GDI's font table, and answers how many fonts it has.
versions:
  '3.1': exact
probes: [fontres, fontver, fontboot]
source: src/win16/gdi/AddFontResource.ts
topics: [font-resources, font-enumeration]
---

## Observed behaviour

- [[measured]] **The answer** is the number of fonts the file's `FONTDIR` lists: 1 for `EGA80WOA.FON` and 6 for `SERIFE.FON`. A file already added is counted once more and answers the same: [[probe:fontres]].
- [[measured]] **A second `.FOT` for a face already installed** answers 1 and adds no family. TrueType fonts are known by their full names.
- [[measured]] **These answer 0:** a missing file, a text file, a `.TTF` itself, and a library with a data segment.
- [[measured]] **A name alone** is found as `LoadLibrary` finds it. A library's handle, with a selector of nought, adds that library's file.
- [[measured]] **The fonts appear at once.** `EnumFonts` hands out the new Terminal, and a raster file added again after it was removed is put after every font already there.
- [[measured]] **No window is sent `WM_FONTCHANGE`.** The program that adds a font sends it.
- [[measured]] **The version.** A `FONTDIR` entry of version 200h, 100h, 0 or 1FFh is taken on any display; 250h and 300h on the VGA, whose `RASTERCAPS` has `RC_BIGFONT`, and not on the Hercules; 301h on neither: [[probe:fontver]].
- [[measured]] **With TrueType off** (`[TrueType]` `TTEnable=0`) a `.FOT` answers 0: [[probe:fontboot]].
- [[measured]] **A file removed while a font of it is cached**, added again, answers its count and its faces are where they were: [[probe:fontdef]].

## Inside Windows

[[read out]] The details are in [[topic:font-resources]]:

- the file is loaded as a library with no data segment;
- its `FONTDIR` is read, and its first entry decides raster or TrueType;
- a raster file is matched by its module, a stub by its full name;
- an entry's version must be 200h or 100h or no more than GDI's limit, 300h with `RC_BIGFONT` and 200h without;
- the faces are appended to the face table, or the stub takes the first empty TrueType slot, where TrueType is enabled.

`GDI.EXE` seg2 `0e25`.

## Implementation

Both engines keep GDI's font table: `FontManager.addResource` in `src/win16/font-manager.ts`, and `crates/winbox-win16/src/fonts/added.rs`. [[probe:fontres]] agrees on 57 of 57 records in each, [[probe:fontver]] on 24 of 24 on each display, and [[probe:fontboot]] on 32 of 32 in each preset.
