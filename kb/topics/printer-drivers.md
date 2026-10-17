---
kind: topic
name: Printer drivers in GDI
summary: How Windows 3.1's GDI loads a printer's driver from the drive and runs it — CreateDC and CreateIC, the driver's Enable, the GDIINFO GetDeviceCaps reads, the device shared between contexts, Escape through Control, the environment GDI keeps for a port, the TrueType size a driver asks for, and DeleteDC's Disable and FreeLibrary — read out of GDI.EXE and recorded with the PostScript driver.
probes: [pric, prdlg, prdoc]
---

A printer's driver is the user's own program, a library on the drive such as Windows' PostScript driver, `PSCRIPT.DRV`, or one a printer's maker shipped. GDI loads it by its name and calls its exports, as it calls any library's. winbox.js runs it the same way: the driver's code runs on the processor, and GDI calls its entry points where Windows' GDI does. This is unlike the display ([[topic:display-drivers]]), whose driver winbox.js never runs. winbox.js's own printer, `WBPRINT`, is a driver of winbox.js's and is not loaded from the drive ([[topic:printing]]).

Every address on this page is in `GDI.EXE` unless it says otherwise.

## Making a context

[[read out]] [[fn:GDI.CreateDC]] and [[fn:GDI.CreateIC]] (seg1 `480a`, `47d8`) both go to one routine (seg1 `0078`) with a flag: nought for a DC, 80h for an IC.

1. The driver's, the device's and the port's names are made atoms of GDI's, so all three are compared without case. A colon at the end of the port's name is left off (seg4 `0449`): `LPT1:` and `lpt1` are one port.
2. A DC on the null port, WIN.INI's `[windows]` `NullPort` (`None` where it is not there), read as GDI starts (seg2 `025c`), is refused; an IC on it is not (seg1 `00bb`).
3. **The driver.** GDI keeps a list of the drivers it has loaded. One not there is loaded with `LoadLibrary` of its name and `.drv` (seg1 `0284`-`02e1`); an answer below 32 refuses the context. Its ordinals 1 to 30 are found with `GetProcAddress` and kept (`02ef`), with a count of the contexts made on it (`0111`). The ordinals are the driver's entry points: 1 `BitBlt`, 2 `ColorInfo`, 3 `Control`, 4 `Disable`, 5 `Enable`, 6 `EnumDFonts`, 7 `EnumObj`, 8 `Output`, 9 `Pixel`, 10 `RealizeObject`, 11 `StrBlt`, 12 `ScanLR`, 13 `DeviceMode`, 14 `ExtTextOut`, 15 `GetCharWidth` and on.
4. **The device.** Each driver keeps the devices it has enabled, by the device's and the port's names (seg1 `0333`). A context on a device already enabled shares it, as the `GDIINFO`'s `dpDCManage` (5Ch) lets: bit 0 gives every context a device of its own, bit 2 shares the first whatever the names, and bit 1 refuses a second context.
5. **Enable, for the information.** A new device: GDI's 7Eh bytes are given to the driver's `Enable` with a style of 1 (8001h for an IC), the program's device, port and `DEVMODE` (seg1 `03af`, `04ca`). The answer is the bytes written: at least 6Eh where the table's version is 300h or more, else exactly 68h. Words 60h to 66h all nought are made B505h, 0, B505h, 0 (`0592`).
6. **Enable, for the device.** The `PDEVICE` is `GlobalAlloc(2002h, dpDEVICEsize)` (`03f5`), given to `Enable` with a style of nought (8000h for an IC, `046f`). Nought refuses the context.
7. A driver whose `dpRaster` has `RC_BANDING` has the drawing on its DC kept in a metafile for its bands (`042d`).

[[measured]] [[probe:pric]]: `CreateIC` of `pscript`, the Apple LaserWriter Plus and `LPT1:` gave an IC; the same again, and on `LPT2:`, gave more.

## GetDeviceCaps

[[read out]] [[fn:GDI.GetDeviceCaps]] (seg1 `44a6`) answers the word at the index's offset in the device's `GDIINFO`: nought past 6Ch, or past 66h where the table's version is below 300h. An odd index reads a word across two fields.

[[measured]] The PostScript driver's table, as [[probe:pric]] read it: `DRIVERVERSION` 778, `TECHNOLOGY` 2, 203 by 274 mm, 2394 by 3231 dots, 1 bit in 1 plane, 17 brushes, 8 pens, 4 fonts, 2 colours, `PDEVICESIZE` 974, curves 510, lines 242, polygons 255, text 6655, clipping 1, raster 10777, aspects 300, 300, 424, 300 dots an inch, `dpDCManage` 1, and 60h to 66h -19195, 0, -19195, 0 — the words GDI made. Index 1 is 515 and 3 is -13568, each the high byte of one field and the low byte of the next; 6Eh, 70h and past answer nought.

## Escape

[[read out]] [[fn:GDI.Escape]] on a printer's context (seg7 `0042`-`0526`):

- `SETABORTPROC` (9) is GDI's: the procedure is kept on the context (+A6h), and the answer is its segment (`00fb`).
- `STARTDOC` (10) first gives the driver's `Control` a `SETABORTPROC` whose input is the context, from GDI's stack, then the `STARTDOC` itself (`00c1`, `00dd`).
- 0Fh answers nought (`008f`). 100h to BFFh are GDI's own first (`044e`).
- Every other goes to the driver's `Control` with the `PDEVICE`, the escape, the input and the output. The count is not passed (`04f0`).

[[measured]] [[probe:pric]]: the PostScript driver supports, by `QUERYESCSUPPORT`, escapes 1–3, 6, 8–14, 17, 19–23, 29–38, 128, 256, 258, 513, 3072, 4096–4102, 4104, 4105 and 4107–4109. `GETPHYSPAGESIZE` 2550 by 3300, `GETPRINTINGOFFSET` 75, 33, `GETSCALINGFACTOR` 0, 0, `GETTECHNOLOGY` "PostScript", `GETSETPRINTORIENT` 1, an escape it has not got nought; `SETABORTPROC` answered the procedure's segment.

## The environment

[[read out]] [[fn:GDI.GetEnvironment]] and [[fn:GDI.SetEnvironment]] (seg7 `0571`, `05ed`) keep a `DEVMODE` for a port, which a driver's `Enable` and `ExtDeviceMode` keep there and read back. GDI has twenty slots (seg4 `0438`), each a port's atom and a block of global memory; on the null port the slot is named by the environment's device name instead. Get answers the bytes copied, no more than asked, or with no buffer the block's size; set lets go of the one there, and with a count of nought answers -1; else copies the count into `GlobalAlloc(2002h)` and answers its handle, nought with no slot free.

## The TrueType engine

[[read out]] [[fn:GDI.EngineRealizeFont]] (seg3 `2b2d`): nought with TrueType off, and for a `LOGFONT` with no face and a height of nought; any other, with no `FONTINFO` to fill, answers 96h, the size of one. The PostScript driver asks so as it enables a device, and fails the device on nought (`PSCRIPT.DRV` seg5 `009e`).

## Deleting

[[read out]] [[fn:GDI.DeleteDC]] (seg1 `082e`): the device's count taken down, and at nought the driver's `Disable` given the `PDEVICE` (`0906`), which is freed with its table; the driver's count taken down, and at nought `FreeLibrary` (`0947`). [[measured]] Each of [[probe:pric]]'s three ICs answered 1, and one deleted twice nought.

## Fonts

[[read out]] A printer's context starts with `DEVICE_DEFAULT_FONT` selected, where the display's starts with `SYSTEM_FONT` (seg1 `0217`-`0225`).

[[read out]] **Realizing a font** (seg3 `0a68`): GDI copies the logical font's `LOGFONT`, `lfClipPrecision`'s high bits left off, and asks the driver's `RealizeObject` for the size of its `FONTINFO` with nought for it; then realizes it into `GlobalAlloc(2042h)` 42h bytes larger, with a `TEXTXFORM` of its own (`0c08`-`0c66`). The driver maps the font itself. Only where it realizes none does GDI map the font among its own.

[[read out]] **[[fn:GDI.GetTextMetrics]]** of a font the driver realized (seg3 `0222`): the height the `TEXTXFORM`'s; the ascent, descent and leadings the `FONTINFO`'s scaled to it; the average width the `TEXTXFORM`'s and the widest the `FONTINFO`'s scaled to it, a pixel more each where the `TEXTXFORM` asks GDI to embolden (200h); overhang, weight, italic, underline and strike-out the `TEXTXFORM`'s; the characters, character set and resolutions the `FONTINFO`'s; the pitch and family the `FONTINFO`'s with `TMPF_DEVICE` and its type's two low bits. `GetTextFace` (seg3 `0102`) answers the face the `FONTINFO`'s `dfFace` names.

[[measured]] [[probe:pric]]: the PostScript driver's default font is Courier at 42 dots; Courier at -50, Helvetica bold at 50, Times at -100 and a nameless Swiss face (AvantGarde) answer as the driver realized them, and both engines agree. Arial at -40 is realized through GDI's TrueType engine with a `FONTINFO` to fill, which is not followed: the engines answer the driver's Helvetica.

[[read out]] **[[fn:GDI.EnumFonts]]** on a printer's context (seg5 `01a7`): first the driver's `EnumDFonts`, given the face asked for, GDI's procedure (`048a`) and GDI's frame. GDI's procedure makes a font not TrueType a device font — `DEVICE_FONTTYPE` added, `TMPF_DEVICE` and, but for a raster font, `TMPF_VECTOR` in its metrics — and calls the program's procedure with a `NEWTEXTMETRIC` copy. The driver's nought ends the walk; its answer stands where it handed any font on. Then GDI's own table: a raster font only where `dpText` has `TC_RA_ABLE` (`0316`); vector fonts always. GDI's TrueType fonts only with `TC_RA_ABLE` or bit 1 of `dpCaps1` (`06c0`). A driver that prints TrueType asks for them itself with [[fn:GDI.EngineEnumerateFont]] (seg5 `093c`): each at the resolution of the context being walked, or 300 dots an inch, typed `TRUETYPE_FONTTYPE` and `DEVICE_FONTTYPE`.

[[measured]] [[probe:pric]]: every face, five TrueType (type 6, from the driver) then thirteen of the PostScript printer's own (type 2) then GDI's three vector fonts; and each face by name. Both engines agree with all of them. winbox.js calls GDI's procedure through a thunk of eight bytes, as it calls USER's own window procedures, popping fourteen bytes.

## The print dialogs

[[measured]] COMMDLG's Print dialog makes an IC of the printer as it starts and asks `QUERYESCSUPPORT` of `SETCOPYCOUNT`; `PD_RETURNDC` and `PD_RETURNIC` hand one back ([[topic:print-dialogs]]). With the driver run as above, all 376 of [[probe:prdlg]]'s records agree in both engines.

## In winbox.js

`src/win16/gdi/printer-driver.ts` and `crates/winbox-win16/src/gdi/printer_driver.rs` keep the drivers and devices and make the contexts; `environment.ts`/`environment.rs` and `engine-font.ts`/`engine_font.rs` beside them. The `GDIINFO` GDI keeps in its heap is laid below the stack for the call to `Enable`. `DISPLAY` and `WBPRINT` are kept as before.

## Not yet done

- GDI's own mapping where a driver realizes no font, a font realized in a mapping mode other than `MM_TEXT`, and the compatibility flags' changes to a driver's TrueType fonts.
- Drawing and printing a document through the driver: `Output`, `ExtTextOut`, the realized pens and brushes, `ColorInfo`, and GDI's spooler (`OpenJob`, `WriteSpool`, `CloseJob`), which [[probe:prdoc]] records with the PostScript it writes.
- Banding (`RC_BANDING`) and GDI's escapes 100h to BFFh on a printer.
- A `FONTINFO` given to `EngineRealizeFont` to fill ([[probe:pric]]'s Arial), and the rest of the engine's exports.
