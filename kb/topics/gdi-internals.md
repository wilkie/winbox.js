---
kind: topic
name: GDI's internal exports
summary: The map of GDI's exports that no SDK header declares — who imports each across the Windows installations and the corpus, what each does inside Windows 3.1 as read out of GDI.EXE, how they fit together by family, and what WinBox answers.
---

GDI exports 283 entries in Windows 3.1. The SDK's headers declare 192 of them as functions a program calls; the other 91 are GDI's internals. USER, the display and printer drivers, Print Manager, WinG and Control Panel call them. No program of the corpus imports any of them. This page is their map, as [[topic:kernel-internals]] is KERNEL's. Each export has its own page, linked from the tables below, with its read-out, its callers and what WinBox does.

## How the census was made

`scripts/kb/kernel-callers.mjs --module GDI` reads every `NE` file under the folders it is given, as for KERNEL. It was run over the twelve installations under `oracle/build/drive-c*` and the corpus programs, and wrote `kb/data/gdi-callers.json`: for each GDI export, the Windows files and the corpus files that import it, by ordinal or by name. A file that imports `GetProcAddress` and holds an export's name as a string of its own is listed apart, as a hint; for GDI the only hint is `ScanLR`, which is the display drivers' own export of that name, not a call of GDI's.

- 129 Windows `NE` files and 62 corpus `NE` files were read.
- **Documented** means declared as a function in Open Watcom's headers for Windows 3.x (`h/win/*.h`). `SpoolFile` is declared there (`win16.h`); the other 90 below are not.
- Of the 91 undeclared exports, 50 are imported by some file: USER takes 27, the PostScript driver 19, WinG 3, Control Panel's `MAIN.CPL` 2, and Print Manager and the enhanced mode's `WINOA386.MOD` one each. No corpus program imports any.
- Before this pass 17 of the 91 were stubs: the driver helpers but `DMEnumDFonts`, the three spooler calls, and `ShrinkGDIHeap`, `GDITaskTermination`, `FixUpBogusPublisherMetafile`, `DeviceColorMatch`, `ScanLR` and `Brute` among the rest. GDI's exports a WinBox table answers with no stub went from 247 to 270 of 283.

## How the pieces fit together

**Visible regions and device contexts for USER.** USER keeps each window's visible region in GDI's device contexts and asks GDI to clip and move them: `SelectVisRgn`, `SaveVisRgn` and its family, `SetDCOrg`, `SetDCHook`, `GetDCState`. See [[topic:device-context-internals]]. WinBox answers all of them.

**The display's life.** USER turns the display off and on around a DOS session with [[fn:GDI.Death]] and [[fn:GDI.Resurrection]], and finishes GDI's start-up with [[fn:GDI.FinalGDIInit]] once it has its own entry points. [[fn:GDI.GDITaskTermination]] and [[fn:GDI.ShrinkGDIHeap]] are what USER tells GDI as a task ends; in Windows 3.1 the first does nothing, and the second gives back GDI's free heap.

**Helpers for drivers.** A printer's driver is handed a memory bitmap where it expects its own device whenever a memory context is made compatible with its device context. It gives that work back to GDI through the `DM` helpers, 201 to 220. Each but [[fn:GDI.DMEnumDFonts]] and [[fn:GDI.DMTranspose]] goes through [[fn:GDI.Brute]], which calls the display driver's routine of the same name on the bitmap. So a printer's driver draws on bitmaps as the display's driver does: the display's pens and brushes ([[fn:GDI.DMRealizeObject]]), its block transfers, polylines and scanlines, and its raster text from a font of version 3.0 laid out as GDI loads one ([[fn:GDI.DMExtTextOut]]). WinBox has the VGA's, the Super VGA's and the EGA's routines for a memory bitmap (`driver-bitmap.ts`), drawing into the program's memory as the driver addresses it -- with no bound, as the driver has none. The PostScript driver imports 201, 202 and 208 to 212. [[fn:GDI.ScanLR]] is GDI's own call of a driver's `ScanLR`, as a flood fill would make it; [[fn:GDI.DeviceColorMatch]] matches a colour against a table a driver keeps.

**The spooler.** A printer's driver writes its output through [[fn:GDI.OpenJob]], [[fn:GDI.StartSpoolPage]], [[fn:GDI.WriteSpool]], [[fn:GDI.EndSpoolPage]] and [[fn:GDI.CloseJob]], or throws it away with [[fn:GDI.DeleteJob]] and [[fn:GDI.DeleteSpoolPage]]. It asks [[fn:GDI.QueryJob]] whether a job is valid and whether Print Manager has disk space. [[fn:GDI.SpoolFile]] hands a whole file to Print Manager. Print Manager talks to GDI through [[fn:GDI.GetSpoolJob]]. See [[topic:printing]] and [[topic:printer-drivers]].

**TrueType for drivers.** The PostScript driver realizes TrueType fonts and asks their glyphs through the `Engine` calls, 300 to 314, and `GetPhysicalFontHandle`. They are mapped elsewhere (the TrueType engine's calls), not here.

**The rest.** The priority queues ([[topic:gdi-priority-queue]]), the palette calls for USER, WinG's [[fn:GDI.GDIInit2]] and [[fn:GDI.SetObjectOwner]], and the leftovers of GDI's own debugging: [[fn:GDI.GDISeeGDIDo]], [[fn:GDI.FTrapping0]] and [[fn:GDI.__GP]].

## The map

Status is what WinBox does after this pass: implemented, or a stub that logs and pops the bytes the table declares. Callers name the importing files. The recommendation is for the exports this pass looked at: as Windows does, an exact no-op, not needed, or not applicable.

### Device contexts and visible regions

| Ord | Export                      | Callers  | WinBox      |
| --- | --------------------------- | -------- | ----------- |
| 5   | [[fn:GDI.SetRelAbs]]        | none     | implemented |
| 86  | [[fn:GDI.GetRelAbs]]        | none     | implemented |
| 73  | [[fn:GDI.ExcludeVisRect]]   | none     | implemented |
| 98  | [[fn:GDI.IntersectVisRect]] | USER.EXE | implemented |
| 102 | [[fn:GDI.OffsetVisRgn]]     | none     | implemented |
| 105 | [[fn:GDI.SelectVisRgn]]     | USER.EXE | implemented |
| 117 | [[fn:GDI.SetDCOrg]]         | USER.EXE | implemented |
| 129 | [[fn:GDI.SaveVisRgn]]       | USER.EXE | implemented |
| 130 | [[fn:GDI.RestoreVisRgn]]    | USER.EXE | implemented |
| 131 | [[fn:GDI.InquireVisRgn]]    | USER.EXE | implemented |
| 169 | [[fn:GDI.IsDCDirty]]        | none     | implemented |
| 170 | [[fn:GDI.SetDCStatus]]      | none     | implemented |
| 173 | [[fn:GDI.GetClipRgn]]       | USER.EXE | implemented |
| 179 | [[fn:GDI.GetDCState]]       | USER.EXE | implemented |
| 180 | [[fn:GDI.SetDCState]]       | USER.EXE | implemented |
| 190 | [[fn:GDI.SetDCHook]]        | USER.EXE | implemented |
| 191 | [[fn:GDI.GetDCHook]]        | none     | implemented |
| 192 | [[fn:GDI.SetHookFlags]]     | USER.EXE | implemented |
| 195 | [[fn:GDI.SelectBitmap]]     | none     | implemented |
| 400 | [[fn:GDI.FastWindowFrame]]  | USER.EXE | implemented |
| 411 | [[fn:GDI.GetCurLogFont]]    | USER.EXE | implemented |
| 465 | [[fn:GDI.RectVisible_Ehh]]  | none     | implemented |
| 466 | [[fn:GDI.RectInRegion_Ehh]] | none     | implemented |

### The display's life and tasks

| Ord | Export                        | Callers  | WinBox      | Recommendation             |
| --- | ----------------------------- | -------- | ----------- | -------------------------- |
| 121 | [[fn:GDI.Death]]              | USER.EXE | implemented | done                       |
| 122 | [[fn:GDI.Resurrection]]       | USER.EXE | implemented | done                       |
| 405 | [[fn:GDI.FinalGDIInit]]       | USER.EXE | implemented | done (c) ([[probe:ugaps]]) |
| 354 | [[fn:GDI.ShrinkGDIHeap]]      | USER.EXE | implemented | done (WinBox: no heap)     |
| 460 | [[fn:GDI.GDITaskTermination]] | USER.EXE | implemented | done (exact no-op)         |
| 376 | [[fn:GDI.ResetDC]]            | none     | implemented | done                       |

### Helpers for drivers

| Ord | Export                      | Callers     | WinBox      | Recommendation                |
| --- | --------------------------- | ----------- | ----------- | ----------------------------- |
| 201 | [[fn:GDI.DMBitBlt]]         | PSCRIPT.DRV | implemented | done (d) ([[probe:gdidmdrw]]) |
| 202 | [[fn:GDI.DMColorInfo]]      | PSCRIPT.DRV | implemented | done (d) ([[probe:gdidm]])    |
| 206 | [[fn:GDI.DMEnumDFonts]]     | none        | implemented | done                          |
| 207 | [[fn:GDI.DMEnumObj]]        | none        | implemented | done (d) ([[probe:gdidm]])    |
| 208 | [[fn:GDI.DMOutput]]         | PSCRIPT.DRV | implemented | done (d) ([[probe:gdidmdrw]]) |
| 209 | [[fn:GDI.DMPixel]]          | PSCRIPT.DRV | implemented | done (d) ([[probe:gdidm]])    |
| 210 | [[fn:GDI.DMRealizeObject]]  | PSCRIPT.DRV | implemented | done (d) ([[probe:gdidmdrw]]) |
| 211 | [[fn:GDI.DMStrBlt]]         | PSCRIPT.DRV | implemented | done (d) ([[probe:gdidmdrw]]) |
| 212 | [[fn:GDI.DMScanLR]]         | PSCRIPT.DRV | implemented | done (d) ([[probe:gdidm]])    |
| 213 | [[fn:GDI.Brute]]            | none        | implemented | done (a) ([[probe:ugaps]])    |
| 214 | [[fn:GDI.DMExtTextOut]]     | none        | implemented | done (d) ([[probe:gdidmdrw]]) |
| 215 | [[fn:GDI.DMGetCharWidth]]   | none        | implemented | done (d) ([[probe:gdidmdrw]]) |
| 216 | [[fn:GDI.DMStretchBlt]]     | none        | implemented | not applicable on the VGA     |
| 217 | [[fn:GDI.DMDibBits]]        | none        | implemented | done (d) ([[probe:gdidmdrw]]) |
| 218 | [[fn:GDI.DMStretchDIBits]]  | none        | implemented | not applicable on the VGA     |
| 219 | [[fn:GDI.DMSetDibToDev]]    | none        | implemented | done (d) ([[probe:gdidmdrw]]) |
| 220 | [[fn:GDI.DMTranspose]]      | none        | implemented | done                          |
| 135 | [[fn:GDI.ScanLR]]           | none        | implemented | done (d) ([[probe:scanscr]])  |
| 449 | [[fn:GDI.DeviceColorMatch]] | none        | implemented | done                          |

"Implemented" for the `DM` helpers means `Brute`'s choice and each export's arguments are as Windows has them. (d) is the display driver's own routine on a memory bitmap, done for the VGA, the Super VGA and the EGA -- whose drivers [[probe:gdidmdrw]] finds alike record for record but the EGA's ninth colour -- and nought, nothing drawn, on the Hercules and the 256-colour display.

### The spooler

| Ord | Export                     | Callers                | WinBox      | Recommendation |
| --- | -------------------------- | ---------------------- | ----------- | -------------- |
| 240 | [[fn:GDI.OpenJob]]         | PSCRIPT.DRV            | implemented | done           |
| 241 | [[fn:GDI.WriteSpool]]      | PSCRIPT.DRV            | implemented | done           |
| 242 | [[fn:GDI.WriteDialog]]     | none                   | implemented | done           |
| 243 | [[fn:GDI.CloseJob]]        | PSCRIPT.DRV            | implemented | done           |
| 244 | [[fn:GDI.DeleteJob]]       | PSCRIPT.DRV            | implemented | done           |
| 245 | [[fn:GDI.GetSpoolJob]]     | PRINTMAN.EXE, MAIN.CPL | implemented | done           |
| 246 | [[fn:GDI.StartSpoolPage]]  | PSCRIPT.DRV            | implemented | done           |
| 247 | [[fn:GDI.EndSpoolPage]]    | PSCRIPT.DRV            | implemented | done           |
| 248 | [[fn:GDI.QueryJob]]        | none                   | implemented | done           |
| 250 | [[fn:GDI.Copy]]            | none                   | implemented | done           |
| 253 | [[fn:GDI.DeleteSpoolPage]] | none                   | implemented | done           |
| 254 | [[fn:GDI.SpoolFile]]       | none (declared)        | implemented | done           |

### TrueType for drivers

| Ord | Export                           | Callers     | WinBox      |
| --- | -------------------------------- | ----------- | ----------- |
| 300 | [[fn:GDI.EngineEnumerateFont]]   | PSCRIPT.DRV | implemented |
| 301 | [[fn:GDI.EngineDeleteFont]]      | PSCRIPT.DRV | implemented |
| 302 | [[fn:GDI.EngineRealizeFont]]     | PSCRIPT.DRV | implemented |
| 303 | `EngineGetCharWidth`             | PSCRIPT.DRV | implemented |
| 304 | `EngineSetFontContext`           | PSCRIPT.DRV | implemented |
| 305 | `EngineGetGlyphBmp`              | PSCRIPT.DRV | implemented |
| 306 | `EngineMakeFontDir`              | none        | implemented |
| 312 | `ConvertOutlineFontFile`         | none        | implemented |
| 314 | `EngineExtTextOut`               | none        | implemented |
| 352 | [[fn:GDI.GetPhysicalFontHandle]] | none        | implemented |

### Palettes, bitmaps and objects for USER and WinG

| Ord | Export                                 | Callers                | WinBox      | Recommendation             |
| --- | -------------------------------------- | ---------------------- | ----------- | -------------------------- |
| 361 | [[fn:GDI.GDISelectPalette]]            | USER.EXE               | implemented | done                       |
| 362 | [[fn:GDI.GDIRealizePalette]]           | USER.EXE               | implemented | done                       |
| 365 | [[fn:GDI.RealizeDefaultPalette]]       | USER.EXE               | implemented | done                       |
| 412 | [[fn:GDI.IsDCCurrentPalette]]          | USER.EXE, WING.DLL     | implemented | done                       |
| 401 | [[fn:GDI.GDIMoveBitmap]]               | none                   | implemented | done                       |
| 403 | [[fn:GDI.GDIInit2]]                    | WING.DLL               | implemented | done (a) ([[probe:ugaps]]) |
| 407 | [[fn:GDI.CreateUserBitmap]]            | USER.EXE               | implemented | done                       |
| 409 | [[fn:GDI.CreateUserDiscardableBitmap]] | USER.EXE               | implemented | done                       |
| 410 | `IsValidMetafile`                      | USER.EXE               | implemented | done                       |
| 461 | [[fn:GDI.SetObjectOwner]]              | WING.DLL, WINOA386.MOD | implemented | done                       |
| 463 | [[fn:GDI.MakeObjectPrivate]]           | USER.EXE               | implemented | done                       |
| 464 | [[fn:GDI.FixUpBogusPublisherMetafile]] | USER.EXE               | implemented | done                       |
| 467 | `UnicodeToAnsi`                        | MAIN.CPL               | implemented | done                       |

### Priority queues

| Ord | Export               | Callers | WinBox      |
| --- | -------------------- | ------- | ----------- |
| 230 | [[fn:GDI.CreatePQ]]  | none    | implemented |
| 231 | [[fn:GDI.MinPQ]]     | none    | implemented |
| 232 | [[fn:GDI.ExtractPQ]] | none    | implemented |
| 233 | [[fn:GDI.InsertPQ]]  | none    | implemented |
| 234 | [[fn:GDI.SizePQ]]    | none    | implemented |
| 235 | [[fn:GDI.DeletePQ]]  | none    | implemented |

### Debugging leftovers and data

| Ord | Export                 | Callers | WinBox      | Recommendation             |
| --- | ---------------------- | ------- | ----------- | -------------------------- |
| 452 | [[fn:GDI.GDISeeGDIDo]] | none    | implemented | done (a); GDI's heap a gap |
| 355 | [[fn:GDI.FTrapping0]]  | none    | data        | done (b) ([[probe:ugaps]]) |
| 46  | [[fn:GDI.__GP]]        | none    | data        | done (b), an empty table   |

## The named oddities

- **`Brute`** takes CX in a register, CL the words to move and CH the routine's offset in a driver's table, and it moves its caller's frame down by 20h bytes before it calls the display driver; a program that sets CX as a helper does gets that helper's answer ([[fn:GDI.Brute]], [[probe:ugaps]]). For a device that is not a bitmap AX is nought, the device's check having cleared it (seg13 `0218`).
- **`DMStrBlt`** is `DMExtTextOut` with five words of nought pushed after its own arguments, as the display drivers' `StrBlt` is their `ExtTextOut` ([[fn:GDI.DMStrBlt]]).
- **`FixUpBogusPublisherMetafile`** puts right the size in a memory metafile's header where it disagrees with the records, as some program's metafiles on the clipboard had it wrong; USER's clipboard code calls it for an entry of `CF_METAFILEPICT` ([[fn:GDI.FixUpBogusPublisherMetafile]]).
- **`GDIInit2`** has nothing to do with start-up: it reads or sets the word at 0Ah of an object in GDI's heap, a bitmap's block of bits, which is how WinG puts its own memory under a bitmap ([[fn:GDI.GDIInit2]]).
- **`FTrapping0`** and **`__GP`** are data: a word in GDI's data segment, nought once GDI has hooked the divide fault, and GDI's table of fault handlers -- WinBox's an empty one.

## Recommendations, ranked

1. **The display driver's routines on a memory bitmap: done** for the VGA, the Super VGA and the EGA ([[probe:gdidmdrw]], [[probe:gdidm]], [[probe:scanscr]]).
2. **The Hercules's and the 256-colour display's routines (M each).** Each driver's own `ColorInfo`, `RealizeObject` and drawing, read out of `HERCULES.DRV` and `SVGA256.DRV`; [[probe:gdidmdrw]] has recorded both.
3. **The last of them, by [[probe:ugaps]]: done.** (a) `Brute` as an export, from CX; `GDIInit2` through WinBox's GDI heap; `GDISeeGDIDo`. (b) `FTrapping0` at 2EFh of GDI's data; `__GP`, its end alone. (c) `FinalGDIInit` called again, the length of its last string.

## Not yet done

- The `Engine` calls and `GetPhysicalFontHandle` are mapped with the TrueType engine's calls, not here.
- `GDISeeGDIDo`'s 1, 2 and 3 on a local heap of GDI's, which WinBox's GDI segment does not hold (`ugaps:seegdiheap`).
- Every helper on the Hercules and the 256-colour display, whose drivers' physical colours, pens and brushes are not the VGA's (a Hercules brush is 22 bytes): recorded by [[probe:gdidmdrw]], known gaps.
- A compressed DIB through `DMDibBits`, which the driver reads by a routine of its own.
- `DMExtTextOut` taking off the display's emboldening and italics for the device of `[063Eh]` -- the `GDIINFO` of the context GDI is drawing text for ([[fn:GDI.DMExtTextOut]]) -- which WinBox does not keep.
- The `DI` device `Brute` knows, a table at GDI's `[0159h]` that no code of Windows 3.1's GDI was found to set.
- `ScanLR` on the Hercules and the 256-colour display.
