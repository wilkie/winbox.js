---
kind: topic
name: Font enumeration
summary: How Windows 3.1's EnumFontFamilies hands out the fonts a device has — GDI's two font tables and their order, one font per family or every font of one, and what each font is said to be — read out of GDI.EXE and measured on four displays.
probes: [enumfam, enumregs]
---

A program learns which fonts there are with `EnumFontFamilies`. Character Map fills its font list this way. Each call back to the program hands it a font, as an `ENUMLOGFONT` and a `NEWTEXTMETRIC`, and its type. The code is `GDI.EXE` segment 5, from `01a7`.

## Two tables

- [[read out]] GDI keeps two tables of fonts.
  - **Raster and vector fonts.** Each size of each face is an entry, in the order it was added (seg2 `0beb`).
  - **TrueType fonts.** Each `.FOT` stub is an entry, in the order it was added (seg2 `0f2c`).
- [[read out]] **The order fonts are added in.** GDI adds its three boot fonts first, and always in the same order: `fonts.fon`, then `fixedfon.fon`, then `oemfonts.fon` (seg2 `0527`). `SYSTEM.INI` only names the files. Then USER adds each line of `WIN.INI` `[fonts]` in the order written. A `.FON` adds its sizes in its own order, which is why MS Serif's 6 and 7 point sizes come after its 24.
- [[measured]] The EGA's `SYSTEM.INI` lists the boot fonts the other way round, and its System font still comes first. winbox.js followed `SYSTEM.INI` before, and the EGA's font directory began with Terminal.
- [[read out]] A face called Symbol or ZapfDingbats is added as the symbol character set, whatever its header says (seg2 `0df4`). The EGA's Symbol strikes say ANSI.

## Every family

- [[read out]] With no name, one font stands for each family (seg5 `02b3`).
  - **Raster and vector fonts** come first, in table order, each family as its first entry.
  - **A raster family with a TrueType namesake is left out** (seg5 `0455`). The raster Symbol goes, because a TrueType Symbol is installed.
  - **The TrueType families** follow, each as its first stub: Arial is its regular because `ARIAL.FOT` comes first.
- [[measured]] [[probe:enumfam]] lists 15 families, in the same order on all four displays:
  - System, Fixedsys and Terminal;
  - MS Sans Serif, Courier and MS Serif;
  - Roman, Script and Modern;
  - Small Fonts;
  - Arial, Courier New, Times New Roman, Wingdings and Symbol.

## One family by name

- [[read out]] With a name, every entry of that family comes: first the raster sizes in table order, then the TrueType stubs in theirs.
  - Courier New gives Regular, Bold, Italic, Bold Italic, because `COURBI.FOT` is last in `[fonts]`.
  - Symbol gives its raster sizes, then the TrueType one.
  - `lfFaceName` is the name as the caller spelled it.
- [[measured]] A name that is no font's answers 1 without a call. The name is looked for as an atom, and there is none (seg1 `214a`).

## What a raster or vector font is said to be

- [[read out]] **The font:** everything comes from its header (seg5 `0000`).
  - `lfHeight` is the pixel height and `lfWidth` the average width.
  - Precision is 1 for a raster font and 3 for a vector one; clipping is 2 and quality 1.
  - `lfPitchAndFamily` is the family with `FIXED_PITCH` or `VARIABLE_PITCH`. The header's low bit is set for variable, so System's 21h becomes 22h.
- [[read out]] **The metrics** are the header's:
  - the descent is the height less the ascent;
  - the default and break characters are counted from the first character;
  - `tmPitchAndFamily` is the header's, with the font's type in bits 1 and 2;
  - the digitized aspect is the header's two resolutions, **vertical first**. Roman's 2 and 3 come back as 2:3, and the EGA's fonts as 72:96.
- [[read out]] **The type** is 1 for a raster font and 0 for a vector one.

## What a TrueType font is said to be

- [[read out]] **The em** is 24 points at the device's resolution: 32 pixels on the VGA; on the EGA and Hercules, 24 tall and 32 across (seg5 `07f5`).
- [[measured]] **The metrics** are the stub's directory entry, in font units, scaled to the em. No font is realised.
  - The ascent is `dfAscent` scaled and rounded.
  - The descent is the rest of the cell (`dfPixHeight` less `dfAscent`), scaled and rounded on its own.
  - The height is the two added, and the internal leading is the height less the em.
  - The widths are scaled across.
  - All 76 TrueType records on four displays fit.
- [[refused]] 2 variants:
  - Rounding the whole cell at once misses 30 of the 76.
  - The metrics of the font realised at that size miss the EGA's ascent. `VDMX`, which settles the realised font, gives Arial 21 above and 6 below at 24 pixels, where the enumeration says 22 and 5.
- [[read out]] **The other fields:**
  - `lfPitchAndFamily` is the stub's family with `VARIABLE_PITCH`, and `tmPitchAndFamily` the stub's with 6 in.
  - The first, last, default and break characters are 30, 255, 31 and 32.
  - The digitized aspect is the device's resolutions, vertical first.
  - The full name and style are the stub's own strings, which follow its directory entry.
  - `ntmFlags` is the high byte of the stub's `dfType`: 40h regular, 20h bold, 21h bold italic, 1 italic. `ntmSizeEM`, `ntmCellHeight` and `ntmAvgWidth` are its em, cell and average width in font units.
  - The type is 4.

## EnumFonts

- [[read out]] `EnumFonts`, the older call, is the same walk (seg5 `05a7`). Its callback is given a `LOGFONT` and a `TEXTMETRIC`, and a TrueType font gets no full name or style. A TrueType style that duplicates another's, or is none of regular, bold and italic, is listed under its full name; the installed fonts have none.
- [[measured]] [[probe:enumfam]] finds `EnumFonts` handing out every face, and each face's fonts by name, exactly as `EnumFontFamilies` does, on four displays. Write fills its font list this way.

## How the procedure is called

[[probe:enumregs]] enumerates with a procedure of its own making: a few bytes of code in a block, run through [[fn:KERNEL.AllocDSToCSAlias]]'s code selector, with no prologue to change the registers. It keeps what it finds and stops at the first call. [[measured]]
- **A font of GDI's own table**, raster or vector: the `TEXTMETRIC` is 24 bytes up the stack from the stack pointer as the procedure is entered, and the `LOGFONT` 66. AX is the `TEXTMETRIC`'s offset, DS is GDI's own data segment, and ES is the stack's.
- **A TrueType font:** the `TEXTMETRIC` is 390 bytes up, and the `LOGFONT` 242. AX, DS and ES are all the stack's segment.
- `EnumFonts` and `EnumFontFamilies` are the same in both cases.
- [[fn:GDI.EnumObjects]] passes a pen 40 bytes up and a brush 38. AX and DS are both GDI's data segment, and ES is the stack's.

A program's exported procedure takes its data segment from AX ([[topic:dynamic-link-libraries]]). So a procedure given without `MakeProcInstance` finds its own data for a TrueType font, and not for a font of GDI's own table or for an object.

## The answer

- [[read out]] The answer is the last callback's (seg5 `03fe`). A callback that answers nought stops everything at once. [[measured]] The stop after one call answers 0.

## Not yet done

- The mapping mode, whose units GDI turns the sizes into.
- A device's own fonts. None of the screen drivers has any.
- A raster font whose aspect does not match the device context's, and the compatibility flags.
- Whether `GetTextMetrics` of a realised TrueType font answers 30 and 31 for the first and default characters, as the enumeration does. winbox.js answers 32 and 128, which nothing has measured.

## In winbox.js

- `src/win16/gdi/EnumFontFamilies.ts` walks the two tables.
- `FontManager.listedEntries` and `trueTypeDirectory` in `src/win16/font-manager.ts` hold them.
- `readFontResource` in `src/raster/font-resource.ts` reads a stub's directory entry and names.
- `fontDirectoryOrder` in `src/win16/font-directory.ts` puts the boot fonts in GDI's order.
