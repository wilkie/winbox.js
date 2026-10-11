---
kind: topic
name: Font resources
summary: How Windows 3.1's GDI adds a font file to its font table and takes it away — AddFontResource and RemoveFontResource, the tables and counts behind them, the cache that keeps a removed file, the versions it takes, what WIN.INI's [fonts] and [TrueType] make of the tables at start-up, what enumeration and the mapper then see — and how Control Panel's Fonts installs and removes a font around them; read out of GDI.EXE, USER.EXE and MAIN.CPL and recorded.
probes: [fontres, fontdef, fontver, fontboot]
---

A font is a file: a raster or vector `.FON`, or for a TrueType face a small `.FOT` stub that names its `.TTF` ([[format:fot]]). GDI knows only the files added to its font table. [[fn:GDI.AddFontResource]] adds one and [[fn:GDI.RemoveFontResource]] takes it away. At start-up GDI adds its three boot fonts itself, and USER adds every line of `WIN.INI` `[fonts]` ([[topic:font-enumeration]]). Control Panel's Fonts installs and removes fonts around these two calls. The code is `GDI.EXE` segment 2 from `0e25` and segment 6 from `0507`.

## AddFontResource

- [[read out]] **The argument** is a file's name, or a module's handle in a far pointer whose selector is nought (seg2 `0e46`).
  - A handle of nought fails.
  - So does a name of 256 characters or more (seg2 `0e70`, `0e79`).
  - The check answers 0 through `HandleParamError`.
- [[read out]] **The file is loaded as a library.** GDI sets `SEM_NOOPENFILEERRORBOX`, calls `LoadLibrary` and puts the error mode back (seg2 `0b96`).
  - A missing file fails, and so does a file that is no `NE` module.
  - A module with a data segment fails too, and is let go (seg2 `0bb9`). No font file has a data segment.
- [[read out]] **The `FONTDIR`** is found with `FindResource(h, "fontdir", RT_FONTDIR)`. A library without one fails (seg2 `0c48`).
- [[read out]] **TrueType or not is decided by the first entry alone.** If its `dfType & 3` is 3, the file is a TrueType stub.
- [[read out]] **Already added?**
  - A raster or vector file is matched by its module (seg2 `0c17`).
  - A stub is matched by the full name its font carries, the string after the face name (seg2 `0b0b`). So another `.FOT` written for the same face counts as the same font.
  - A match is counted once more and nothing else is added (seg2 `0c22`).
  - A raster file whose adds were all taken away while a font of it was cached is still in the table, its module still loaded: it is matched too, and its faces are back where they were (below).
- [[read out]] **A raster or vector file's fonts are appended to the face table**, each with its face's atom (seg2 `0ce4`).
  - The library stays loaded.
  - A face called Symbol or ZapfDingbats becomes the symbol set (seg2 `0df4`).
- [[read out]] **The version.** Each entry's `dfVersion` must be 200h or 100h, or no more than GDI's limit, or the whole add fails (seg2 `0d9d`). The limit is GDI's `DS:10h`, set as the first device context is made: 300h where the display's `RASTERCAPS` has `RC_BIGFONT` (400h), else 200h (seg1 `047a`).
- [[read out]] **A stub is put in the TrueType table** (seg2 `0f2c`).
  - It needs TrueType enabled: `WIN.INI` `[TrueType]` `TTEnable`, read at start-up (seg2 `0f38`).
  - It takes the first slot a removed font left empty, else a new slot at the end.
  - Its `.TTF`'s name is the stub's resource 1 of type 204. The `.TTF` is not opened, so a missing one does not fail the add.
  - The stub is let go as soon as it is read.
- [[read out]] **The answer** is the `FONTDIR`'s count: how many fonts the file has, or 0 on failure. Added again, a raster file answers its count and a stub answers 1.
- [[read out]] GDI sends no message. `WM_FONTCHANGE` is the adding program's to send (see Control Panel's Fonts below).

## RemoveFontResource

- [[read out]] **The argument** is checked as `AddFontResource`'s is.
- [[read out]] **A loaded module first.** `GetModuleHandle` of the name finds a raster or vector file, by its file's name or its module's (seg6 `03b5`). One add is taken away, where it has one: a file with none left answers 0 (`03d0`).
- [[read out]] **Otherwise the file is loaded** and a stub is matched by its font's full name (seg6 `03f3`). A raster file found only this way answers 0.
- [[read out]] **With its last add gone** (seg6 `0179`):
  - a stub's slot is emptied and its module let go at once;
  - a raster file with no font of it in GDI's cache goes: its faces leave the face table, the module is freed, and the table's last entry is moved into its place;
  - a raster file with a font of it cached stays, its module loaded and its faces in the face table, until the last of those fonts leaves the cache (below). The call answers 1 all the same.
- [[read out]] **A raster file with no adds is hidden.** Enumeration and the mapper pass over a face whose file has no adds (seg3 `05e5`, seg5 `02ac`).
- [[read out]] **The answer** is 1 when an add was taken away. It is 0 for a file never added, already gone, with no adds left, or not found.

## The cache

GDI keeps the fonts it realises in a cache: a local block (`[36Ah]`), an entry of 1Ch bytes each, their count at `[37Ch]`.

| Offset       | What                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------ |
| `+0`, `+2`   | The device the font was realised for [inferred]                                            |
| `+4` to `+A` | Four words of the device context's scaling, each 1 in a context made one to one [inferred] |
| `+C`, `+E`   | The logical font's object count, which names the font object that realised it              |
| `+14`        | The realised font, a local block                                                           |
| `+16`        | The face table's entry, or 539h for a TrueType font                                        |

- [[read out]] **Realising a raster font counts it against its file**: the file's realised count, the font table's `+2`, goes up (seg3 `0dd0`). A TrueType font counts against nothing.
- [[read out]] **A font leaves the cache** through seg6 `01fa`, which takes it by its device, its object or its realised block:
  - when its font object is deleted (seg1 `1aa8`, by the object's count);
  - when it is taken out of a device context whose scaling words are not all 1, and no context has it locked (seg1 `40f1`, seg6 `044d`);
  - when its device context, or its device, goes (seg1 `09ef`).
  - A font taken out of a context made one to one stays cached.
- [[read out]] **Leaving, it counts its file down** (seg6 `0302`). With the count nought and the file's adds nought, the file goes as `RemoveFontResource` would have let it go.
- [[measured]] **A font made again of the same `LOGFONT`** is the cached one, not mapped again: the face it realised from may be one the mapper no longer sees.
- [[read out]] **A stub's removal makes its realised fonts discardable** (seg6 `0000`, `GlobalReAlloc` with `GMEM_DISCARDABLE`) and deletes its slot's four atoms. A context still holding one draws with it, but `GetTextFace` finds no name: [[measured]] it answers an empty one.

## The start-up

- [[read out]] **`[TrueType]`** is read by GDI as it starts (seg2 `110e`), with `GetProfileInt`. Its flags at `[64Ah]`:
  - `TTEnable`, 1 where it is not there, bit 0. With it nought GDI makes no TrueType table at all (seg2 `118b`): no stub can be added, [[fn:GDI.CreateScalableFontResource]] reads nothing and writes nothing (seg7 `1190`), and [[fn:GDI.GetRasterizerCaps]] answers nought.
  - `TTOnly`, bit 3. A program enumerating every font, no face named, is shown the TrueType fonts alone (seg5 `0249`). A face named is enumerated as ever. The mapper does not read it.
  - `TTIfCollisions`, bit 13, and `TTIfNoFontname` (the string at seg2 `0ec4`), bit 14, are read too. Not yet measured.
- [[read out]] **`[fonts]`** is added by USER after GDI's own boot fonts, a line at a time in the order written (`USER.EXE` seg3 `1b71`):
  - the value is read, up to 125 characters;
  - where it has no `.` anywhere in it, `.FON` is put after it (seg3 `1b9a`);
  - and it is handed to [[fn:GDI.AddFontResource]], whose `LoadLibrary` finds it: by its path where it has one, else by KERNEL's search.
  - A line whose file is not there adds nothing, and says nothing.

## What the recordings show

[[measured]] [[probe:fontres]] runs each step on the VGA, and both engines agree with all 57 records.

| Step                                                                                                       | Recorded                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EGA80WOA.FON`, not installed, added                                                                       | 1. Terminal has two fonts. Its family list does not change.                                                                                           |
| The same file added again                                                                                  | 1                                                                                                                                                     |
| Removed three times                                                                                        | 1, 1, 0. Terminal is back to one font after the second.                                                                                               |
| `CGA40WOA.FON` by its bare name                                                                            | Added and removed by it, through the search `LoadLibrary` makes.                                                                                      |
| `CGA80WOA.FON` by its handle from `LoadLibrary`                                                            | 1, and removed by the handle.                                                                                                                         |
| A `.FOT` that `CreateScalableFontResource` wrote for `WINGDING.TTF`, under another name                    | 1, and no new family. Removing it answers 1 and Wingdings stays.                                                                                      |
| `WINGDING.FOT` removed                                                                                     | Wingdings leaves `EnumFontFamilies`. Removed again, 0.                                                                                                |
| `CreateFont` of "Wingdings" at 20 with Wingdings removed                                                   | Times New Roman                                                                                                                                       |
| `WINGDING.FOT` added again                                                                                 | Same place in the family list, its old slot. `CreateFont` of "Wingdings" then maps to MS Sans Serif: ANSI asked for, and Wingdings is the symbol set. |
| `SERIFE.FON` removed                                                                                       | MS Serif's family moves after Small Fonts, because only `SMALLE.FON`'s two MS Serif strikes (10 and 11) are left. A 13 maps to the 11.                |
| `SERIFE.FON` added again                                                                                   | 6. Its strikes come after `SMALLE.FON`'s: appended.                                                                                                   |
| A missing file, `WIN.INI`, `ARIAL.TTF` itself, `VER.DLL` (a data segment), `SOUND.DRV` (loaded, with data) | 0, and Terminal's count is unchanged after each                                                                                                       |
| A window's `WM_FONTCHANGE` through all of this                                                             | 0                                                                                                                                                     |

[[measured]] A first recording also added `""`. It answered 0, and `C:\WINDOWS\` was written over the program's own data. That step is not kept in the probe.

[[measured]] [[probe:fontdef]] removes a file while a font of it is realised, on the VGA; both engines agree with all 44 records.

| Step                                                                                                  | Recorded                                                                                                                      |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| MS Serif at 13 realised in a window's DC, `SERIFE.FON` removed                                        | 1. MS Serif's family moves after Small Fonts and `EnumFonts` hands out 10 and 11, but the DC still holds MS Serif at 13.      |
| A font made again of MS Serif at 13                                                                   | MS Serif, 13: the cached font, though the mapper no longer sees the strike.                                                   |
| Removed again                                                                                         | 0                                                                                                                             |
| Added again                                                                                           | 6, and MS Serif's family is back in its own place, its strikes 13 to 35 before Small Fonts' 10 and 11: never taken out.       |
| Removed, the font taken out of the DC but not deleted, added again                                    | Its own place again: the font is still cached.                                                                                |
| Removed, the font deleted                                                                             | A font made of MS Serif at 13 maps to 11. Added again, 6, after Small Fonts: the file had gone.                               |
| Wingdings at 20 realised, `WINGDING.FOT` removed                                                      | Wingdings leaves the family list at once. The DC's `GetTextFace` is empty, its height still 20; a new request maps to Symbol. |
| MS Serif at 26 in a DC of two units to a pixel, `SERIFE.FON` removed, the font taken out, added again | After Small Fonts: taken out of a scaled DC, the font left the cache, and the file went.                                      |

[[measured]] [[probe:fontver]] copies `DOSAPP.FON` and writes another version into its first `FONTDIR` entry, on the VGA and on the Hercules; both engines agree with all 24 of each, and the TypeScript engine replays the VGA's.

| `dfVersion`         | VGA (`RC_BIGFONT`) | Hercules |
| ------------------- | ------------------ | -------- |
| 200h, 100h, 0, 1FFh | 6                  | 6        |
| 250h, 300h          | 6                  | 0        |
| 301h                | 0                  | 0        |

[[measured]] [[probe:fontboot]] is recorded three times, `WIN.INI` set before Windows starts (`record.mjs --ini`); both engines agree with all 32 records of each.

| Preset   | `WIN.INI`                                                                                                       | Recorded                                                                                                                                                                                                                                                                                                       |
| -------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fonts`  | `[fonts]` lines `C:\FONTS\TERM.FON` (a copy of `EGA80WOA.FON`), `CGA80WOA`, `EGA40WOA.FON`, `C:\FONTS\NONE.FON` | Terminal has four fonts: 12, then the three lines' 12, 8 and 12. Each added again answers 1 and is removed. Terminal at 8 in the OEM set is still the 12-row strike.                                                                                                                                           |
| `ttoff`  | `[TrueType]` `TTEnable=0`                                                                                       | `GetRasterizerCaps` answers 0, its flags 0. No TrueType family; Symbol is the raster one, after MS Serif. Arial at 20 maps to MS Sans Serif at 20, Wingdings to Symbol 19, Times New Roman at 30 to Fixedsys at 30, no face at 18 to Small Fonts. `ARIAL.FOT` added answers 0; `CreateScalableFontResource` 0. |
| `ttonly` | `[TrueType]` `TTOnly=1`                                                                                         | `EnumFontFamilies` and `EnumFonts` with no face hand out the five TrueType families alone; Terminal by name is still there. The mapper is as ever.                                                                                                                                                             |

[[measured]] With TrueType on, a face no font has maps to Times New Roman; with it off, the strikes compete: Fixedsys drawn twice for 30 and for 15, MS Sans Serif's own for 20 and 13.

## Control Panel's Fonts

Read out of `MAIN.CPL`, segment 9.

- [[read out]] **The list** is `WIN.INI` `[fonts]`'s keys. A key whose value is empty is left out (seg9 `01cd`).
- [[read out]] **Choosing a font** shows its sample (seg9 `0656`):
  1. It finds the file from the Windows directory, then `OpenFile`'s search. A value with no extension tries `.fon`.
  2. It removes the font of the previous sample.
  3. `AddFontResource` of the file's whole path gives the count.
  4. Each `FONTDIR` entry is drawn in the sample list. A TrueType one is drawn 18 points high.
  5. `VER.DLL`'s `GetFileResource` of type 204 decides the label: "This is a scalable TrueType font…", else "This is a screen or plotter font."
  6. A nought from `AddFontResource` says "There is a problem with the font file", or for TrueType switched off, that a sample is not available.
- [[read out]] **Add Fonts** is COMMDLG's Open box with a hook and a template. Its font list is filled while the box is idle.
  - A `.FON`'s description is its module's description after "FONTRES …:".
  - A `.TTF`'s description is its `name` table's full name with " (TrueType)" added.
  - For each font chosen, in this order (seg9 `18f1`):
    1. A description already in `[fonts]` is "already installed".
    2. The file is copied to the system directory with `VerInstallFile`, unless "Copy Fonts to Windows Directory" is off or the file is already there.
    3. A `.TTF` gets a `.FOT` from `CreateScalableFontResource` in the system directory, under a name made unique (seg9 `1c0c`).
    4. `AddFontResource` is called. A nought deletes what was copied or written and says it cannot install the font.
    5. `WriteProfileString("fonts", description, file)` writes the file's name alone when it is in the system directory, else its path.
  - If anything was installed, `WM_WININICHANGE` "fonts" and then `WM_FONTCHANGE` go to every window (seg4 `0283`).
- [[read out]] **Remove**, for each font chosen and confirmed (seg9 `09f9`):
  1. Its `[fonts]` line is deleted.
  2. `RemoveFontResource` is called with the value as written, and its answer is not looked at.
  3. A `.FOT` is always deleted.
  4. The font file is deleted only with "Delete Font File From Disk" ticked, and only when no module has it loaded.
  - Then the same two broadcasts follow, even when nothing was removed.
- [[read out]] **The TrueType box** writes `[TrueType]` `TTEnable` and `TTOnly`. Changing `TTEnable` asks for a restart.

## In winbox.js

- Both engines keep GDI's font table: `FontManager.addResource` and `removeResource` in `src/win16/font-manager.ts`, and `crates/winbox-win16/src/fonts/added.rs`.
  - A raster file is known by its module and a stub by its full name.
  - Strikes added are appended in the table's order.
  - A stub takes the first empty slot.
  - The boot fonts and `[fonts]` are added at start-up as USER adds them: a value with no `.` given `.FON`, a path followed, a name alone looked for in the Windows directory and then the system directory (`fontLineFile`, `font_line_file`). Nothing else is loaded.
  - `[TrueType]` `TTEnable` and `TTOnly` are read at start-up (`trueTypeSettings`, `true_type_settings`).
- The cache is kept as the fonts realised from a raster file's strike, each with the font object that made it and its `LOGFONT` (`Cached`). A font is realised as it is made, where Windows realises it as it is used. A file removed with such a font cached keeps its strikes out of the table until the object is deleted, or taken out of a scaled DC; added again, they go back where they were.
- `fontFile` (`src/win16/font-file.ts`) reads what `AddFontResource` reads of a file, and `versionLimit` gives the limit from the display's `RC_BIGFONT`.
- The calls are `src/win16/gdi/AddFontResource.ts` and `crates/winbox-win16/src/gdi/text/added.rs`.
- [[measured]] [[probe:fontres]] 57 of 57, [[probe:fontdef]] 44 of 44, [[probe:fontver]] 24 of 24 on each display, [[probe:fontboot]] 32 of 32 in each preset, in both engines.
- [[measured]] Control Panel's Fonts installs `DOSAPP.FON` and removes it, and removes Wingdings and installs it again from `WINGDING.TTF`, in both engines' sessions.

## Not yet done

- **A font made and never used** is realised and cached as it is made in winbox.js; Windows realises it when it is first used, and a font never used holds no file. A font realised for a printer or a memory DC is cached alike.
- **Which four words of a device context the cache entry keeps** are taken to be its window and viewport extents [inferred]; only a context of two units to a pixel is recorded.
- **A cache entry going with its device context or device** (seg1 `09ef`) is not followed: a context deleted lets no font go.
- **`TTIfCollisions` and `TTIfNoFontname`** are read by GDI and not by winbox.js. Not yet measured.
- **A `[fonts]` path without a drive or a root** is taken from the Windows directory [inferred]; the directory current as USER starts is not read out. A value with a `.` only in its folder is not given `.FON`, and what `LoadLibrary` then makes of a name with no extension is not measured.
- **An empty name** writes over the caller's data on Windows. winbox.js answers 0 and writes nothing.
