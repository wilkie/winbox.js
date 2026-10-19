---
kind: topic
name: Printer drivers in GDI
summary: How Windows 3.1's GDI loads a printer's driver from the drive and runs it — CreateDC and CreateIC, the driver's Enable, the GDIINFO GetDeviceCaps reads, the device shared between contexts, Escape through Control, the environment GDI keeps for a port, fonts realized by the driver and by GDI's TrueType engine, a document's calls, the drawing handed to the driver, GDI's spooler, and DeleteDC's Disable and FreeLibrary — read out of GDI.EXE and recorded with the PostScript driver.
probes:
  [
    pric,
    prdlg,
    prdoc,
    prdraw,
    prspool,
    prabort,
    prlpt,
    prtabs,
    prnote,
    prmeta,
    prdrv,
    prband,
    prblt,
    prblt2,
  ]
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
7. A driver whose `dpRaster` has `RC_BANDING` has the drawing on its DC kept in a metafile for its bands (`042d`), on a device newly enabled and not for an IC. See Bands below.
8. The context's colours, brush and pen are made (below, under Drawing), and then its font is realized (`022e`). A pen, brush or font already realized for the device is not realized again: a second context on a shared device realizes nothing.

[[measured]] [[probe:prdrv]] brings a driver of its own, which logs each call GDI makes to it. `CreateDC` called its `Enable` for the information and for the device, then `RealizeObject` for the white brush, the black pen and the default font, each asked its size first. The default font's `LOGFONT` is all nought, its face empty. A second context on a device it shares called nothing.

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

[[read out]] [[fn:GDI.DeleteDC]] (seg1 `082e`):

1. The device's count is taken down, and at nought the driver's `Disable` is given the `PDEVICE` (`0906`), and the device leaves the driver's list.
2. The driver's count is taken down, and at nought it is freed with `FreeLibrary` (`0947`).
3. Where the device went, its `PDEVICE` is freed (`09dd`), and then what was realized for it. Its pens and brushes are GDI's blocks kept by the device's number (`09ea`, seg1 `4460`). Its fonts are entries in GDI's table of realized fonts (`09ef`, seg6 `0387`), each `FONTINFO` given to `EngineDeleteFont` and freed (seg6 `0272`). The driver is not called for either; it has gone.

A device shared by contexts keeps all of it until the last goes. [[measured]] Each of [[probe:pric]]'s three ICs answered 1, and one deleted twice nought. [[probe:prdrv]]'s driver asks, at its `Disable` and as its library is freed, whether each `FONTINFO` it realized is still there. Both times they were, and after the deletion they were gone. Of two contexts sharing a device, deleting the first called nothing of the driver's.

[[read out]] **A font deleted** while its device lives is given back to the driver (seg6 `0362`, `04bd`). The driver's `RealizeObject` is called with -`OBJ_FONT`, the `FONTINFO` as both objects and no `TEXTXFORM`, and then the block is freed ([[fn:GDI.DeleteObject]]). GDI walks its table from the first entry; an entry let go takes the last one's place, and that is looked at next (seg6 `01fa`). [[measured]] [[probe:prdrv]]: a font deleted so, then a context deleted with its own default font still realized.

## Fonts

[[read out]] A printer's context starts with `DEVICE_DEFAULT_FONT` selected, where the display's starts with `SYSTEM_FONT` (seg1 `0217`-`0225`).

[[read out]] **Realizing a font** (seg3 `0a68`). GDI first looks in its table of realized fonts, by the device's number, the font object and the context's extents (seg1 `3e86`): a font realized for one context serves every context on the device. Otherwise GDI copies the logical font's `LOGFONT`, `lfClipPrecision`'s high bits left off, and asks the driver's `RealizeObject` for the size of its `FONTINFO` with nought for it; then realizes it into `GlobalAlloc(2042h)` 42h bytes larger, with a `TEXTXFORM` of its own (`0c08`-`0c66`). The driver maps the font itself. Only where it realizes none does GDI map the font among its own.

[[read out]] **The size in the device's units** (seg3 `0b35`-`0b9c`). A font that is not a stock one (8000h in its type word) has its height and width mapped before the driver sees them. The window origin, and the origin moved by the width and the height, are taken to the device with `LPtoDP` (seg1 `52f5`; the origin is the context's word at 68h, which `GetWindowOrg` reads). The width is their distance across. The height is their distance down: negative for a negative height, and 1 where it comes to nought from a height that was not. So a font is realized again in each mapping mode it is used in. [[measured]] [[probe:prtabs]]: Helvetica 60 high measures 90 by 61 dots in `MM_TEXT`, and 89 by 60 tenths of a millimetre in `MM_LOMETRIC`, realized at 71 dots.

[[read out]] **[[fn:GDI.GetTextMetrics]]** of a font the driver realized (seg3 `0222`): the height the `TEXTXFORM`'s; the ascent, descent and leadings the `FONTINFO`'s scaled to it; the average width the `TEXTXFORM`'s and the widest the `FONTINFO`'s scaled to it, a pixel more each where the `TEXTXFORM` asks GDI to embolden (200h); overhang, weight, italic, underline and strike-out the `TEXTXFORM`'s; the characters, character set and resolutions the `FONTINFO`'s; the pitch and family the `FONTINFO`'s with `TMPF_DEVICE` and its type's two low bits. `GetTextFace` (seg3 `0102`) answers the face the `FONTINFO`'s `dfFace` names.

[[measured]] [[probe:pric]]: the PostScript driver's default font is Courier at 42 dots; Courier at -50, Helvetica bold at 50, Times at -100 and a nameless Swiss face (AvantGarde) answer as the driver realized them. Arial at -40 is realized through GDI's TrueType engine, with a `FONTINFO` for [[fn:GDI.EngineRealizeFont]] to fill from the face's `.FOT` stub. Both engines agree with all 200 records.

[[read out]] **[[fn:GDI.EnumFonts]]** on a printer's context (seg5 `01a7`): first the driver's `EnumDFonts`, given the face asked for, GDI's procedure (`048a`) and GDI's frame. GDI's procedure makes a font not TrueType a device font — `DEVICE_FONTTYPE` added, `TMPF_DEVICE` and, but for a raster font, `TMPF_VECTOR` in its metrics — and calls the program's procedure with a `NEWTEXTMETRIC` copy. The driver's nought ends the walk; its answer stands where it handed any font on. Then GDI's own table: a raster font only where `dpText` has `TC_RA_ABLE` (`0316`); vector fonts always. GDI's TrueType fonts only with `TC_RA_ABLE` or bit 1 of `dpCaps1` (`06c0`). A driver that prints TrueType asks for them itself with [[fn:GDI.EngineEnumerateFont]] (seg5 `093c`): each at the resolution of the context being walked, or 300 dots an inch, typed `TRUETYPE_FONTTYPE` and `DEVICE_FONTTYPE`.

[[measured]] [[probe:pric]]: every face, five TrueType (type 6, from the driver) then thirteen of the PostScript printer's own (type 2) then GDI's three vector fonts; and each face by name. Both engines agree with all of them. winbox.js calls GDI's procedure through a thunk of eight bytes, as it calls USER's own window procedures, popping fourteen bytes.

## A document

[[read out]] Of a document on a driver's DC, GDI does little itself (seg31):

- [[fn:GDI.StartDoc]] (`0196`) gives the driver's `Control` `SETABORTPROC` with the DC, then `STARTDOC` with the document's name, and the `DOCINFO` as its output where the `GDIINFO` is newer than 300h.
- [[fn:GDI.StartPage]] (`02ae`) only marks the DC and answers 1.
- [[fn:GDI.EndPage]] (`02e0`) answers -1 on a DC not so marked. Otherwise it answers the escape `NEWFRAME`'s answer, or 1 where `NEXTBAND` has marked the DC as banding.
- [[fn:GDI.EndDoc]] (`0234`) is `Control`'s `ENDDOC`. [[fn:GDI.AbortDoc]] is the escape `ABORTDOC`, and [[fn:GDI.SetAbortProc]] the escape `SETABORTPROC`.

[[measured]] [[probe:prdoc]] prints a page of text, a rectangle, a line and an ellipse through the PostScript driver to a file, and records the PostScript it wrote. Its `EndPage` answers the driver's job, a block of 352 bytes. [[probe:prabort]] stops a document from its abort procedure, drops one partway, starts one on an information context, and prints one by the escapes, counting the abort procedure's calls. Both engines agree with all 223 and all 32 records.

## Drawing

[[read out]] GDI hands the driver what the program draws, with the objects the driver realized:

- **The context** (seg1 `0192`-`0210`). `CreateDC` gives the driver's DC a `DRAWMODE` of `R2_COPYPEN` and `OPAQUE`. The background is white and the text black, each made physical by the driver's `ColorInfo` (seg1 `1526`) and kept in the `DRAWMODE`, as [[fn:GDI.SetBkColor]] and [[fn:GDI.SetTextColor]] keep them later (`1476`, `14dc`). The white brush and the black pen are realized. A hatched brush selected is selected again where the background's physical colour changes (`1556`-`1575`).
- **Pens and brushes** go to the driver's `RealizeObject`, asked the size with nought for the object, then given a block that large (`26e5`, `256f`). What is realized is kept for the device, and a context on the same device uses it without asking the driver again. A pen's width is made device units, `MulDiv` by the viewport's extent over the window's, and its height comes from the device's aspects (`2640`). A brush's `LOGBRUSH` has the background's physical colour after it (`23a1`), and its origin goes as a fifth argument (`2304`).
- **The visible region** of a driver's DC is its page, `dpHorzRes` by `dpVertRes`. A mapping mode's extents come from the `GDIINFO` (30h on).
- **Figures** (seg25 `082f`). With the pen and the brush, a figure inside the region (seg18 `0000` answers 2) goes with no clip rectangle. Where the region is one rectangle that is the clip. Otherwise the figure goes once for each of the region's rectangles within its bounds, out by the pen's width. [[fn:GDI.Rectangle]] (`0093`) goes as `OS_RECTANGLE` where `dpPolygonalCaps` has `PC_RECTANGLE` and what the pen and brush need. The curves (seg9 `02c4`) bring the right and bottom in by one and go as `OS_ELLIPSE`, `OS_ARC`, `OS_CHORD`, `OS_PIE` or `OS_ROUNDRECT`, or `OS_CIRCLE` where the sides are as long by the aspects and the driver has `CC_CIRCLES`. A thin polyline goes as `OS_POLYLINE` with its bounds as the clip; a wide pen needs `LC_WIDE` and goes as a figure (seg21 `0726`). [[fn:GDI.Polygon]] closes the points and goes as `OS_ALTPOLYGON` or `OS_WINDPOLYGON` (seg24 `0254`, `0396`).
- **Text** goes to the driver's `ExtTextOut` ([[fn:GDI.ExtTextOut]]), and [[fn:GDI.GetTextExtent]] asks it the extent with its count negated. USER's [[fn:USER.TabbedTextOut]] draws each run with GDI's `ExtTextOut`.
- **A DIB** goes to the driver's `StretchDIBits`, ordinal 28, where `dpRaster` has `RC_STRETCHDIB` (seg11 `1058`). It goes once for each of the region's rectangles within the destination, from the bottom up, and the answer is the source's height. A driver without it, or that answers -1, has GDI draw it ([GDI's own stretching and DIBs](#gdis-own-stretching-and-dibs)).
- **[[fn:GDI.BitBlt]] and [[fn:GDI.PatBlt]]** go to the driver's `BitBlt`, ordinal 1 (seg1 `305b`, `2d0d`). Both rectangles are taken to the device; an empty one answers 1. A raster operation that does not read its source takes none (`2fbf`). A source must be of the same driver: a driver's context, or a memory context made compatible with one. Where either is a device and their drivers differ, the answer is nought (`2e06`-`2e10`), so a bitmap of a memory context made compatible with the display cannot be copied to a printer. The driver is called once for each of the visible region's rectangles within the destination, from the bottom up where the source lies above it and from the right where it lies to the left (`2da8`). Each call gives the rectangle's corner, the source's `BITMAP` and its corner moved as far, the extent, the raster operation, the realized brush and the `DRAWMODE` (`2e92`). The answer is 1.
- **[[fn:GDI.StretchBlt]]** (seg1 `305b`) maps both rectangles' corners; either with no width or height answers 1 (`312c`). Extents alike, even both turned over, are a `BitBlt` (`30bc`). From a memory context whose bitmap the source's far corner passes, the answer is nought and nothing is drawn (`30da`). Then GDI's stretching (seg32 `03ba`) puts each rectangle in order: a side given the wrong way round starts a pixel on from its far edge, and the stretch is turned over where one side is and the other is not (`11bb`). Neither turned over and each side within a pixel of the other's size, it is GDI's `BitBlt` of the smaller, and of its last column and row again where the destination is the larger (`04fb`), before any driver is asked. Where `dpRaster` has `RC_STRETCHBLT` (`05fa`), the driver's `StretchBlt`, ordinal 27, is called once for each of the visible region's rectangles within the destination, with that rectangle as its clip (`0687`), the flip made the source's: its corner moves to its far edge and its extent goes negative (`0658`). A driver without it, or whose answer is below nought, has GDI stretch it ([GDI's own stretching and DIBs](#gdis-own-stretching-and-dibs)).
- **[[fn:GDI.SetDIBitsToDevice]]**, where `dpRaster` has `RC_DIBTODEV`, goes to the driver's `DIBToDevice`, ordinal 21 (seg11 `0b13`). The driver is given the destination's corner less the source's x, moved down by the source's y and the height less the DIB's height (`0c61`-`0c78`). It also gets the first scan and the count, the visible region's rectangle as the clip, the `DRAWMODE`, the bits, the `BITMAPINFO` and no translation (`0cac`). The answer is the driver's; a driver without it, or whose answer is below nought, has GDI draw it.
- **A memory context** made compatible with a printer's context is of its driver. [[fn:GDI.GetDeviceCaps]] answers the printer's `GDIINFO`, and `CreateCompatibleDC` has the driver realize its white brush and black pen again. Those are kept apart from the device's, by the device's number and one (seg1 `0151`). Its font is the device's, found realized already (`3e64`).

[[measured]] [[probe:prdraw]]: dashed and wide pens, a hatched rectangle with no outline, a star filled both ways, an ellipse inside its frame, a circle, a round rectangle, a pie, an arc and a chord, a rectangle in `MM_LOMETRIC`, a rectangle and a line across a clip, text of colours and modes and in a font of its own, an opaque rectangle, and a DIB stretched ten times. Both engines agree with every line of the PostScript written, all 149 records. [[probe:prtabs]]: tabbed text and its extents, 88 records.

[[measured]] [[probe:prblt]], with the probe's own driver on a device that can only `BitBlt`, then on one that can also stretch and take DIBs. A memory context made compatible with the printer's answers its `TECHNOLOGY`, 2, and its driver realizes a brush and a pen for it. A bitmap copied, in part and under a clip of one rectangle and around a hole, reaches the driver's `BitBlt` with its `BITMAP`, rectangle by rectangle from the bottom up and from the right. A bitmap of a memory context compatible with the display is refused with nought, and `PatBlt` goes with no source. A stretch and a flipped stretch reach `StretchBlt`, a DIB `DIBToDevice` and `StretchDIBits`. With the PostScript driver, a bitmap copied and stretched and a DIB set are written as `imagemask` and `image`. The probe's last part stretches and draws DIBs on the device that can only `BitBlt`, below. Both engines agree with all 199 records.

[[read out]] **A metafile played** on a driver's context reaches the driver record by record, as the calls it keeps would: `PlayMetaFileRecord` (seg19 `0826`) makes each through the function's own entry ([[topic:metafiles]]). [[measured]] [[probe:prmeta]] plays one with colours, a pen, a brush, figures and text, whole and then a record at a time; both pages are written alike, and both engines agree with all 112 records.

## GDI's own stretching and DIBs

[[read out]] For a driver that cannot stretch or take a DIB, GDI stretches and converts into bitmaps of its own, and has the driver copy them with its `BitBlt`. A bitmap made compatible with a printer's context is of the printer's format, `dpPlanes` and `dpBitsPixel` (seg4 `01fb`); with a memory context, of the bitmap it holds. The bitmaps GDI writes into are a memory context's, made compatible with the printer's, so the driver's `BitBlt` is given them as its destination, with that memory context's brush and `DRAWMODE`. The memory contexts are made by `CreateCompatibleDC`, so the driver realizes their brush and pen once for its device, as for a program's.

**`StretchBlt`** (seg32 `0690`). GDI keeps a flag for each side: a device, of colours. Turned over either way, or both sides of colours, the stretch goes through DIBs, as does a source bitmap of more than a segment (its object's flag, seg1 `1c10`). Otherwise it goes through one bitmap (`06c9`):

- The bitmap is as wide as the wider side and as high as the higher, compatible with the source. A source of colours is first copied into it at its bottom, by its own driver with no brush, and the bitmap is a row higher and compatible with the destination; so is a device's, by the destination's driver (`072b`, `07bd`). A bitmap past a segment goes through DIBs instead (`0712`).
- For each band of the destination, all of it unless the source was copied in (`085e`), GDI walks the visible region's rectangles within it, top down and from the left. For each new top and bottom, GDI's monochrome stretcher (seg32 `0000`) writes those rows of the destination into the bitmap from its top. The driver's `BitBlt` copies each rectangle from the bitmap's top row and its column as far in, with the program's raster operation, the context's brush and `DRAWMODE` (`0906`).
- The stretcher takes each axis as the larger size against the smaller. Across, a source pixel shows the quotient's times, and once more while the remainder's running balance is above nought (`0185`). Shrinking, a destination pixel is a group as large: white where all its pixels are (`BLACKONWHITE`), any of them (`WHITEONBLACK`), or its first (`COLORONCOLOR`) (`01ed`, `0246`, `029f`). Down, the error starts at the larger less half the smaller, rounded up. Enlarging, rows between steps are copies (`0155`, `0129`). Shrinking, a row is its group of source rows anded, ored or the first (`02f1`). The mode is the context's: `BLACKONWHITE` as it starts, `WHITEONBLACK` for any value but the three (`04e1`).

**Through DIBs** (seg32 `099e`). GDI makes two memory contexts, compatible with the source's and the destination's, and two bitmaps. The first is compatible with the source and as wide as it. The second is as wide as the destination, compatible with the source for a monochrome source and the destination otherwise. Each DIB row is the bitmap's width at its bits a pixel, to a doubleword. The rows a chunk and the second bitmap take halve, the second's plus the destination's height over the source's and one, until both buffers fit a segment. Where the chunk can halve no more, the band of source rows halves and they start again (`0ba9`-`0c26`). Then for each band of the source:

- its rows are copied into the first bitmap by the source's driver, with no brush (`0d23`);
- for each chunk of them, `GetDIBits` of the first bitmap, a chunk at a time from its top; the chunk stretched in DIB pixels: across by the column groups of [[fn:GDI.StretchBlt]], and down by an error that starts at the larger less half the smaller, rounded down (`0e29`-`0f09`). Each chunk starts its rows afresh, all ones in `BLACKONWHITE` and noughts in `WHITEONBLACK`;
- `SetDIBits` of as many rows as the second bitmap holds at a time, from its top, and the driver's `BitBlt` from it to each of the visible region's rectangles within those rows of the destination, from the second bitmap's row as far down (`0f17`, `1124`). Turned over, the rows go from the destination's bottom up. A `SetDIBits` that sets none ends it with nought.

**A DIB with no `RC_DI_BITMAP`.** [[fn:GDI.SetDIBits]] of a bitmap with a printer's context goes through a memory context compatible with it holding the bitmap (seg11 `094c`). GDI draws the DIB itself (seg12 `094f`):

- A header of 1, 4, 8 or 24 bits, or `BI_RLE4` or `BI_RLE8` of 4 or 8, is taken; any other, or no scans from the first, answers nought (`08fa`).
- The DIB becomes a monochrome bitmap of GDI's own as wide as the DIB and as high as the scans given, the first at its bottom (`0cba`). Each colour is white where its blue, twice its red and five times its green come to 1020 or more (seg11 `0479`). A compressed DIB is decoded whole, and answers 1 (`08b3`, seg12 `023d`).
- GDI's `BitBlt` copies it, the DIB's width and the scans' count, to the bitmap at its height less the first scan and the count.

[[fn:GDI.GetDIBits]] makes a monochrome bitmap as wide as the header and as high as the scans, and two memory contexts. The driver copies the rows into it from the bitmap's height less the first scan and the count (seg12 `0d92`). The colour table is black, white, and the rest nought. Each pixel is 0 or 1 at the header's bits a pixel, the first scan from the bottom row. One bit's rows are copied a word at a time and padded with noughts, the others' padding left as it was (`0f21`). It answers the count, no more than the header's height less the first scan. [[fn:GDI.CreateDIBitmap]] with `CBM_INIT` is a bitmap compatible with the context and `SetDIBits` of all its scans (seg11 `0a8a`).

[[fn:GDI.SetDIBitsToDevice]] (seg11 `0ce9`) maps the corner, saves the context, sets `MM_TEXT` and clips it to the destination's rectangle. GDI then draws the scans given as above, to the corner's x and its y moved by the DIB's height less the first scan and the count, less the source's y, from the source's x. The context is restored, and the answer is the scans, though nothing may show. [[fn:GDI.StretchDIBits]] (seg11 `1253`), where the driver takes `SetDIBitsToDevice` and the extents are alike and `SRCCOPY`, is that. Otherwise GDI makes a memory context, a bitmap compatible with the printer's made of the DIB as `CreateDIBitmap` makes it, and `StretchBlt`s from it, counting the source from the bottom row. It answers the source's height where it drew.

[[read out]] The same routines serve every device: every `StretchBlt` that is not a copy goes to `03ba` (seg1 `3105`), for the display, whose driver has no `RC_STRETCHBLT` (`VGA.DRV`'s `dpRaster`, 46D9h), and for memory contexts ([[fn:GDI.StretchBlt]]). The display's driver has `RC_DI_BITMAP`, so its `SetDIBits` goes to `DeviceBitmapBits` and not through `094f`.

[[measured]] [[probe:prblt2]], with the probe's own driver, whose `BitBlt` sums the bits it is given and copies between monochrome bitmaps. On the device that can only `BitBlt`, a bitmap is stretched larger, turned either way, smaller in each mode, by a pixel each way, turned over both ways, from beyond its bitmap, inverting, two thousand pixels wide either way, and under a clip of two rectangles. A DIB is set in part, from later scans, stretched the same size, turned, from a part and inverting, of two colours either way round, of 256, of 24 bits, and compressed. A bitmap made compatible with the printer's is monochrome; a DIB is set into it and got back, and one made of a DIB. A bitmap of a memory context compatible with the display, of one colour and of sixteen, is stretched to the printer, though `BitBlt` refuses it. On the device that can also `StretchBlt`, the stretches within a pixel are still GDI's `BitBlt`s. Both engines agree with all 192 records.

## Bands

[[read out]] A driver that bands (`RC_BANDING` in `dpRaster`) is given the page a band at a time. GDI does it one of two ways (`GDI.EXE` seg7 `0042`-`0526`, seg1 `042d`):

- **GDI keeps the page.** `CreateDC` makes a metafile, keeps it on the context, saves the context with [[fn:GDI.SaveDC]] and marks it with a type of its own, 4F50h (seg1 `025b`-`0264`). While the context is so, each call that draws is kept in the metafile and not drawn (seg20 `2596`, from each function): [[fn:GDI.Rectangle]], [[fn:GDI.BitBlt]], [[fn:GDI.ExtTextOut]] and the rest. A call that sets the context's state is kept and made as well: the colours, modes, mapping, clip rectangles, [[fn:GDI.SelectObject]], `SaveDC` and `RestoreDC`, [[fn:GDI.MoveTo]]. [[fn:GDI.LineTo]] is kept, and moves the current position (seg21 `0b47`). [[fn:GDI.OffsetClipRgn]] is kept only.
- **`NEWFRAME`**, as [[fn:GDI.EndPage]] sends it, plays the page (seg7 `01b7`). The context is made the type that draws, 4F4Fh, and restored to its first saved level, and the metafile closed. Then for each band: the context saved and its visible region saved (`SaveVisRgn`), the driver's `Control` asked `NEXTBAND`, the visible region narrowed to the band (`IntersectVisRect`), the clip region dropped, the metafile played, and the context and its region restored. An empty band ends it. The metafile is deleted and a new one made, the context restored and saved again, and it records again; then `NEWFRAME` goes to the driver. A band the driver refuses with nought or less, or a metafile that will not play, ends the page so too, but gives the driver `ABORTDOC`, and the escape answers the refusal (`028d`).
- **The program bands**, with `NEXTBAND` of its own (`0303`). The first of a page throws the kept page away, restores and saves the context, and the context draws from then. Each gives the driver `NEXTBAND` and narrows the visible region to the band it gives. An empty band makes a metafile again, restores and saves the context, and it records again.
- `ABORTDOC` restores the context and makes its metafile anew (`018c`); `ENDDOC` widens the visible region back (`0152`); [[fn:GDI.DeleteDC]] closes and deletes the metafile (seg1 `089b`).

So each page starts from the context as it was saved: what the program set on one page is gone on the next. [[fn:GDI.SaveDC]] saves the whole of GDI's context, its marks among it (seg1 `0a84`), so [[fn:GDI.RestoreDC]] takes back `StartPage`'s and `NEXTBAND`'s marks too.

A driver that does not band is given `NEXTBAND` as any escape.

[[measured]] [[probe:prband]]. The PostScript driver does not band: its `RASTERCAPS` is 10777, without `RC_BANDING`, and `QUERYESCSUPPORT` answers 1 for `NEXTBAND` and nought for `BANDINFO`. Its `NEXTBAND` gives the whole page, 2550 by 3300, then an empty band, each answered with its job. With the probe's own driver as a device that bands, two bands of its page:

- the program's own `NEXTBAND`s give each band, and each figure reaches the driver's `Output` with the band as its clip. A colour set and a rectangle drawn before the first `NEXTBAND` are lost;
- a page drawn and ended with `EndPage` calls nothing of the driver's until `EndPage`, but to realize a brush selected. Then each band gets every figure, clipped to the band. The brush the metafile made is realized in each band and deleted after it, with `RealizeObject`'s -2. After the page, the text colour and the current position are the context's first again;
- a page aborted gives the driver only `ABORTDOC`, and a context deleted with a page kept gives it nothing but `Disable`.

Both engines agree with all 174 records.

## GDI's spooler

[[read out]] A driver writes its output through GDI's spooler (seg28, seg29 and seg30): [[fn:GDI.OpenJob]], [[fn:GDI.StartSpoolPage]], [[fn:GDI.WriteSpool]], [[fn:GDI.EndSpoolPage]], [[fn:GDI.WriteDialog]], [[fn:GDI.CloseJob]] and [[fn:GDI.DeleteJob]]. A job is a block of 148h bytes, and its handle is answered shifted right a bit. It goes straight to a file or port, through the communications driver, through Print Manager, or through the network. Its 100h-byte buffer is written as it fills, and [[fn:GDI.QueryAbort]] is asked before each write. A port that does not answer puts up GDI's box, system-modal, after WIN.INI's timeouts.

[[measured]] [[probe:prspool]] calls the spooler as a driver does, 33 records. [[probe:prlpt]] opens a job to `LPT1` with no printer on it, and Cancels GDI's box, 10 records. Both engines agree with all of them.

## Notepad

[[measured]] [[probe:prnote]] has Notepad print a note with `/p` to a file port, through the PostScript driver. Notepad makes the DC, measures a character, starts the document by the escapes, and prints each line, the header and the footer with [[fn:USER.TabbedTextOut]]. It counts the spaces that centre the header and footer by [[fn:GDI.GetTextExtent]]. Both engines agree with every line of the 11866 bytes written, all 198 records.

## The print dialogs

[[measured]] COMMDLG's Print dialog makes an IC of the printer as it starts and asks `QUERYESCSUPPORT` of `SETCOPYCOUNT`; `PD_RETURNDC` and `PD_RETURNIC` hand one back ([[topic:print-dialogs]]). With the driver run as above, all 376 of [[probe:prdlg]]'s records agree in both engines.

## In winbox.js

`src/win16/gdi/printer-driver.ts` and `crates/winbox-win16/src/gdi/printer_driver.rs` keep the drivers and devices, make the contexts, realize fonts, and take a document's calls. `printer-output.ts` and `printer_output.rs` hand the drawing to the driver, and `spooler.ts` and `spooler.rs` are GDI's spooler. `environment.ts`/`environment.rs` and `engine-font.ts`/`engine_font.rs` are beside them. The `GDIINFO` GDI keeps in its heap is laid below the stack for the call to `Enable`. `DISPLAY` and `WBPRINT` are kept as before. GDI's messages for the spooler's boxes are its own string table (`strings.ts`, `strings.rs`). Each engine keeps the pens and brushes realized for a device on the device, in the order each object was first realized, and the fonts in one table like GDI's, let go as GDI walks it, so a run's handles do not depend on a hash's order. A context starts with the stock pen and brush, and what is realized is keyed by the stock objects, as Windows' contexts start with the stock objects themselves.

[[probe:prdrv]] brings a printer's driver of its own, `prdrv.dll.c`, built with its entry points at GDI's ordinals by the linker's `export` directives in `prdrv.dll.lnk`. The probe copies it to `PRDRVD.DRV`, since GDI loads a driver by its name and `.DRV`. It logs every call GDI makes to it to a file, which outlives the driver, and the probe reads that back as records. Both engines run it as they run the PostScript driver.

## Not yet done

- GDI's own mapping where a driver realizes no font, GDI's own text and extents for such a font, and the compatibility flags' changes to a driver's TrueType fonts.
- GDI's own drawing for a driver that cannot draw a figure (`OS_BEGINNSCAN`, scan lines), the wide frames GDI draws itself, plotters' pens and brushes, and arcs whose two points meet.
- Text: alignments other than the top left, the current position, `lpDx`, justification's second call, rotation, a complex region, and the driver's `StrBlt`.
- GDI's own stretching from a printer's context itself, or for a printer of colours; a DIB of `DIB_PAL_COLORS`, a driver with `RC_DI_BITMAP` (`DeviceBitmapBits`), `GetDIBits` with no bits or compressed, and the skipped pixels of a compressed DIB, which keep what GDI's monochrome bitmap held. GDI's halving of its bitmaps where memory runs short; winbox.js halves them only where they pass a segment. The bounds GDI keeps of what a stretch drew (seg1 `42be`), the palette `StretchDIBits` selects into its memory context (seg22 `0271`), and the source's `DRAWMODE` `BitBlt` takes where a monochrome destination's source is of colours (seg1 `2ded`).
- A memory context's own drawing through its printer's driver, and the count a memory context keeps on its device.
- GDI's escapes 100h to BFFh on a printer, and the escapes GDI keeps in a banding driver's metafile (25, 200h on, seg7 `0172`, `0469`). `RC_SCALING`'s shifts of a band (`0211`). The temporary file GDI keeps a banding driver's page in; winbox.js keeps it in memory.
- The `Ex` calls (`MoveToEx`, `SetWindowOrgEx` and the rest) on a banding driver's context while its page is kept, and drawing USER does on one, which winbox.js makes without the dispatcher.
- Print Manager's side of the spooler, the network's jobs, `FILE`'s "Print To File" box, and DOS's devices.
- `GetTabbedTextExtent`, `DrawText` and `GrayString` on a driver's DC.
- A Write session: `write /p` of a text file asks first whether to convert it.
- The rest of the TrueType engine's exports, and its penalties among faces not named.
