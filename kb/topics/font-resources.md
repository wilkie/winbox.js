---
kind: topic
name: Font resources
summary: How Windows 3.1's GDI adds a font file to its font table and takes it away — AddFontResource and RemoveFontResource, the tables and counts behind them, what enumeration and the mapper then see — and how Control Panel's Fonts installs and removes a font around them; read out of GDI.EXE and MAIN.CPL and recorded.
probes: [fontres]
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
- [[read out]] **A raster or vector file's fonts are appended to the face table**, each with its face's atom (seg2 `0ce4`).
  - An entry whose `dfVersion` is above `0x200` fails the whole add (seg2 `0d9d`). `0x300` is taken too when the display has `RC_BIGFONT`.
  - The library stays loaded.
  - A face called Symbol or ZapfDingbats becomes the symbol set (seg2 `0df4`).
- [[read out]] **A stub is put in the TrueType table** (seg2 `0f2c`).
  - It needs TrueType enabled: `WIN.INI` `[TrueType]` `TTEnable`, read at start-up.
  - It takes the first slot a removed font left empty, else a new slot at the end.
  - Its `.TTF`'s name is the stub's resource 1 of type 204. The `.TTF` is not opened, so a missing one does not fail the add.
  - The stub is let go as soon as it is read.
- [[read out]] **The answer** is the `FONTDIR`'s count: how many fonts the file has, or 0 on failure. Added again, a raster file answers its count and a stub answers 1.
- [[read out]] GDI sends no message. `WM_FONTCHANGE` is the adding program's to send (see Control Panel's Fonts below).

## RemoveFontResource

- [[read out]] **The argument** is checked as `AddFontResource`'s is.
- [[read out]] **A loaded module first.** `GetModuleHandle` of the name finds a raster or vector file, by its file's name or its module's (seg6 `03b5`). One add is taken away.
- [[read out]] **Otherwise the file is loaded** and a stub is matched by its font's full name (seg6 `03f3`). A raster file found only this way answers 0.
- [[read out]] **With its last add gone, the file goes** (seg6 `0179`):
  - a raster file's faces leave the face table;
  - a stub's slot is emptied;
  - the module is freed.
- [[read out]] **A file whose fonts are realised is kept** until the last of them leaves GDI's cache, and the call still answers 1.
  - A raster file's faces are hidden from enumeration and the mapper at once, because their file's count is nought (seg3 `05e5`, seg5 `02ac`).
  - A stub's face stays visible until its slot is emptied.
- [[read out]] **The answer** is 1 when an add was taken away. It is 0 for a file never added, already gone, or not found.

## The tables

- [[read out]] **The font table:** a file an entry of 12 bytes (local handle `[0x368]`, count `[0x378]`).

  | Offset | What |
  |---|---|
  | `+0` | the module, or `FFFE` for a stub |
  | `+2` | fonts realised from it |
  | `+4` | its adds |
  | `+6`, `+8` | its first and last face, or a stub's slot |
  | `+0A` | 1 raster or vector, 2 TrueType |

- [[read out]] **The face table:** a font an entry of 34h bytes, at most 1335 (global handle `[0x36c]`, count `[0x37a]`).
  - It holds the module, the font's ordinal and resource, the face's atom at `+10`, and the `FONTDIRENTRY` from `dfType` on at `+12`.
- [[read out]] **The TrueType table:** a stub a slot of 2Eh bytes (selector `[0x640]`).
  - Each slot holds the directory entry's metrics.
  - It also holds four atoms: the face at `+26`, the full name at `+28`, the style at `+2A` and the `.TTF` at `+2C`.

## What the recording shows

[[measured]] [[probe:fontres]] runs each step on the VGA, and both engines agree with all 57 records.

| Step | Recorded |
|---|---|
| `EGA80WOA.FON`, not installed, added | 1. Terminal has two fonts. Its family list does not change. |
| The same file added again | 1 |
| Removed three times | 1, 1, 0. Terminal is back to one font after the second. |
| `CGA40WOA.FON` by its bare name | Added and removed by it, through the search `LoadLibrary` makes. |
| `CGA80WOA.FON` by its handle from `LoadLibrary` | 1, and removed by the handle. |
| A `.FOT` that `CreateScalableFontResource` wrote for `WINGDING.TTF`, under another name | 1, and no new family. Removing it answers 1 and Wingdings stays. |
| `WINGDING.FOT` removed | Wingdings leaves `EnumFontFamilies`. Removed again, 0. |
| `CreateFont` of "Wingdings" at 20 with Wingdings removed | Times New Roman |
| `WINGDING.FOT` added again | Same place in the family list, its old slot. `CreateFont` of "Wingdings" then maps to MS Sans Serif: ANSI asked for, and Wingdings is the symbol set. |
| `SERIFE.FON` removed | MS Serif's family moves after Small Fonts, because only `SMALLE.FON`'s two MS Serif strikes (10 and 11) are left. A 13 maps to the 11. |
| `SERIFE.FON` added again | 6. Its strikes come after `SMALLE.FON`'s: appended. |
| A missing file, `WIN.INI`, `ARIAL.TTF` itself, `VER.DLL` (a data segment), `SOUND.DRV` (loaded, with data) | 0, and Terminal's count is unchanged after each |
| A window's `WM_FONTCHANGE` through all of this | 0 |

[[measured]] A first recording also added `""`. It answered 0, and `C:\WINDOWS\` was written over the program's own data. That step is not kept in the probe.

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
  - The boot fonts and `[fonts]` are added at start-up as USER adds them.
- `fontFile` (`src/win16/font-file.ts`) reads what `AddFontResource` reads of a file.
- The calls are `src/win16/gdi/AddFontResource.ts` and `crates/winbox-win16/src/gdi/text/added.rs`.
- [[measured]] [[probe:fontres]]: 57 of 57 in both engines.
- [[measured]] Control Panel's Fonts installs `DOSAPP.FON` and removes it, and removes Wingdings and installs it again from `WINGDING.TTF`, in both engines' sessions.

## Not yet done

- **Fonts realised from a removed file.** GDI waits for them to leave its cache before the file goes; winbox.js lets it go at once. A TrueType face that is still realised stays visible to enumeration on Windows; in winbox.js it goes.
- **TrueType switched off.** `TTEnable` is not read: a stub is added even with TrueType off.
- **`dfVersion` 0x300.** It is refused whatever the display.
- **Fonts never in the table.** `.FON` files in the system directory that the profiles do not name are still loaded so that a face named in a request is found. They are not enumerated. GDI does not have them at all ([[topic:font-enumeration]]).
- **The `[fonts]` line's value.** It is read only from the system directory at start-up. A path elsewhere is not followed, and a value with no extension is not given `.FON`, which USER does (`USER.EXE` seg3 `1b9a`).
- **An empty name** writes over the caller's data on Windows. winbox.js answers 0 and writes nothing.
