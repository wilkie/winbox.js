---
kind: topic
name: Display drivers
summary: Which Windows 3.1 screen answers come from the installed display driver and which come from GDI, what four recorded drivers report, what the 8514/a's and the XGA's drivers were read out to report, and why every display-dependent fixture is recorded once for each display.
probes: [devcaps, dither, escapes]
---

A Windows 3.1 program finds out about its screen by asking GDI and USER, and much of what they answer is not theirs. The installed display driver fills in a table when Windows starts. [[fn:GDI.GetDeviceCaps]] reads that table back, and [[fn:USER.GetSystemMetrics]] sizes window parts from it. A program then decides things from those answers: how many colours to use, how many pixels a point is, and whether a circle has to be drawn as an ellipse to look round.

## Four drivers, as recorded

[[measured]] [[probe:devcaps]] was recorded on four installations that differ only in the display chosen at setup. Every row below comes from `oracle/fixtures/devcaps-<display>.json`:

| Answer                                   | VGA          | Super VGA    | EGA          | Hercules     |
| ---------------------------------------- | ------------ | ------------ | ------------ | ------------ |
| `HORZRES` x `VERTRES`                    | 640x480      | 800x600      | 640x350      | 720x348      |
| `HORZSIZE` x `VERTSIZE` (mm)             | 208x156      | 208x156      | 240x175      | 225x145      |
| `LOGPIXELSX` / `LOGPIXELSY`              | 96 / 96      | 96 / 96      | 96 / 72      | 96 / 72      |
| `ASPECTX` / `ASPECTY` / `ASPECTXY`       | 36 / 36 / 51 | 36 / 36 / 51 | 38 / 48 / 61 | 11 / 16 / 19 |
| `BITSPIXEL` x `PLANES`                   | 1x4          | 1x4          | 1x4          | 1x1          |
| `NUMCOLORS`                              | 16           | 16           | 16           | 2            |
| `RASTERCAPS`                             | 18137        | 18137        | 18137        | 665          |
| `TEXTCAPS`                               | 8708         | 8708         | 8708         | 8196         |
| `LINECAPS`, `POLYGONALCAPS`, `CURVECAPS` | 34, 8, 0     | 34, 8, 0     | 34, 8, 0     | 34, 8, 0     |
| `CLIPCAPS`                               | 1            | 1            | 1            | 0            |
| `NUMBRUSHES`, `NUMPENS`                  | -1, 80       | -1, 80       | -1, 80       | 77, 10       |
| `DRIVERVERSION`, `TECHNOLOGY`            | 778, 1       | 778, 1       | 778, 1       | 778, 1       |
| `SM_CYCAPTION`, `SM_CYMENU`              | 20, 18       | 20, 18       | 18, 16       | 18, 16       |

[[measured]] All four report 0 for `NUMFONTS`, `NUMMARKERS`, `NUMRESERVED`, `SIZEPALETTE` and `COLORRES`. They also report the same borders (1), frames (4) and icons (32) from [[fn:USER.GetSystemMetrics]].

[[measured]] The three colour drivers give the same capability bits. The Hercules driver is the only one that differs. [[documented]] Decoded with the Windows 3.1 constants, it lacks `RC_BIGFONT`, `RC_SAVEBITMAP`, `RC_OP_DX_OUTPUT`, `TC_EA_DOUBLE` and `CP_RECTANGLE`, which the colour drivers have. All four report `LC_POLYLINE | LC_STYLED`, `PC_SCANLINE` and no curve capabilities, which by the API contract means GDI breaks curves and filled shapes into polylines and scanlines before the driver sees them.

## Non-square pixels

[[measured]] The EGA and the Hercules report the same logical resolution, 96 across and 72 down, but different aspect numbers: 38 by 48 and 11 by 16. [[inferred]] Their millimetre sizes give the same 3:4 shape as their logical resolutions. The aspect numbers do not: the EGA's pixel is closer to square than 3:4, and the Hercules's is further from it. A rule that uses one set of numbers can therefore be told apart from a rule that uses the other only on the Hercules.

[[read out]] The font mapper uses `ASPECTY` over `ASPECTX` for its off-square penalty, not the logical resolution. It uses `LOGPIXELSY` to convert its default twelve points into rows. See [[fonts:3]] and [[topic:font-mapper]]. For how turned text is placed on these displays, see [[topic:non-square-pixels]].

## What the driver decides, and what GDI decides

- [[read out]] GDI builds every font. Each of the three drivers read has a font handler for `RealizeObject` that does nothing. A driver affects fonts only through its capability bits: without `RC_BIGFONT`, a stretched strike is held to one segment ([[fonts:3]]), and without `TC_EA_DOUBLE`, GDI makes bold itself ([[topic:synthetic-bold]], [[fonts:8u]]).
- [[measured]] The driver chooses the pixel a line takes when the line passes exactly between two pixels. The three colour drivers make the same choice and the Hercules makes a different one. [[probe:lines]] records 2,478 lines on each display, and winbox.js agrees with all of them.
- [[measured]] GDI draws a line that leaves the surface when the driver reports `CLIPCAPS` 0. On the Hercules, those lines follow GDI's rules, not the driver's.
- [[inferred]] The caption and menu bars are USER's, sized from the system font, and that font's height follows the driver's vertical resolution. That would explain why both 72-dot displays have bars two pixels shorter.

The long derivation of the driver's decisions, including the readings that were refused, is in [[fonts:8v]].

## Colours

- [[read out]] The EGA's sixteen colours are not the VGA's. `EGA.DRV` keeps its colour table where `VGA.DRV` keeps its own, and the two tables differ in one entry: index 8 is dark grey `404040` on the EGA and light grey `c0c0c0` on the VGA. [[measured]] [[probe:dither]]'s `GetNearestColor` and `GetPixel` answer `404040` on an EGA and never `c0c0c0`.
- [[measured]] The driver chooses the pattern a brush of a colour it lacks is drawn as, and the one colour a pen gets. The three colour drivers share the patterns. The EGA uses its own order for monochrome bitmaps, and the Hercules weighs red, green and blue alike where the colour drivers count green twice. See [[topic:brush-dithering]].

## Escapes

A program reaches a driver's own functions through [[fn:GDI.Escape]], by number. Control Panel's Mouse applet asks the screen's driver whether it can draw mouse trails.

- [[measured]] [[probe:escapes]] asks `QUERYESCSUPPORT` about every escape from 0 to 255, and some past that, on all four displays. The colour drivers answer 1 for 5 (`GETCOLORTABLE`) and for 8 (`QUERYESCSUPPORT` itself), and **-7** for 39 (`MOUSETRAILS`). The Hercules answers only for 5 and 8.
- [[measured]] `MOUSETRAILS` answers 7 on the colour displays and nought on the Hercules. It writes nothing back.
- [[measured]] An escape the driver has not got answers nought.
- [[measured]] A memory device context's driver is GDI's own for bitmaps, and answers nought to everything, `QUERYESCSUPPORT` included.
- winbox.js does not run the driver's code. It answers from each display's record in `display-modes.ts`. Not followed: what `GETCOLORTABLE` answers.

## Why fixtures are recorded per display

[[measured]] A fixture is only correct for the driver it was recorded on. The Super VGA and the VGA differ only in resolution. The EGA changes the vertical resolution. The Hercules changes the pixel shape, the colour depth and the capability bits all at once. The recorder installs Windows once for each display. It names each fixture after its display, for example `devcaps-ega.json`, and the conformance suite replays each fixture on a machine running that display mode. All 37 records of each `devcaps` fixture agree with winbox.js. To record a display yourself, see [[guide:reproducing]].

[[measured]] The 256-colour display, `vga256`, is Microsoft's Super VGA driver from the Windows Driver Library on an ET4000, which DOSBox emulates. Its fixtures are recorded like the others ([[topic:palettes]]).

## The 8514/a and the XGA, read out

Windows 3.1's own 256-colour drivers are each for one card: the Video 7's, the 8514/a's (`8514.DRV`) and the XGA's (`XGA.DRV`). DOSBox emulates none of those cards. Windows started on one stops while USER takes the display's resources, so nothing can be recorded on them. winbox.js has two modes for them, `8514` and `xga256`, marked `read out`: every number is read out of the driver, and none is recorded.

**The method.** A driver gives GDI a `GDIINFO` table from `Enable` when GDI asks for the device's information. `GetDeviceCaps` answers from that table, and its index is the byte offset of a word in it. Read the same way, `SVGA256.DRV`'s 640x480 table (file offset `4102h`) equals what [[probe:devcaps]] recorded on `vga256` in every field.

### `8514.DRV`

- [[read out]] **The table.** It is a template in code segment 6 at `0446` (file offset `4006h`):
  - 1024x768 and 280x210 mm.
  - 0 bits a pixel and 1 plane.
  - Brushes -1, pens 16, colours 16.
  - `CURVECAPS` 0, `LINECAPS` 2, `POLYGONALCAPS` 8Ah, `TEXTCAPS` 2004h, `CLIPCAPS` 1, `RASTERCAPS` 02D9h.
  - Aspect 10, 10 and 14.
  - 120 dots an inch.
  - Palette of 0, 16 reserved, resolution 18.
  - The mapping modes' extents: windows of 2800x2100 and 28000x21000 on a viewport of 1024x-768; 4375 on 4064, 21875 on 2032 and 7875 on 508.
- [[read out]] **What `Enable` changes** (seg6 `0311`-`0385`). It copies 6Eh bytes of the template out, then changes the copy:
  1. The dots an inch become 96 when the byte at `[1926h]` is 1.
  2. The bits a pixel become `[3B7h]`, and the palette's size becomes two to that power.
  3. With 256 colours, it adds `RC_PALETTE` (100h). The colours, the pens and the palette's reserved entries all become `[6F4h]`.
  4. It adds `RC_BIGFONT` (400h) when `__WINFLAGS` (an import of `KERNEL.178`, at `0374`) has `WF_PMODE` and not `WF_CPU286`.
- [[read out]] **The dots an inch.** `[1926h]` is set as the driver loads (seg6 `0297`, called from `024E`). It is `GetPrivateProfileInt("8514.DRV", "dpi", 120, "SYSTEM.INI")` compared with 96. Setup writes `dpi=120` for "8514/a" and `dpi=96` for "8514/a (Small fonts)" (`SETUP.INF`'s `[8514]` and `[8514s]`).
- [[read out]] **The card.** At the first `Enable` (seg6 `0044`-`00A2`), the driver reads port 42E8h:
  - With bit 80h set, the card has a megabyte: 8 bits, and `[6F4h]` 20.
  - Without it, the card has half a megabyte: 4 bits and 16, and the palette table is moved down to suit.
- [[read out]] **`QUERYESCSUPPORT`** answers 1 for `GETCOLORTABLE` (5) and for itself (8), and nought for the rest, `MOUSETRAILS` among them (seg1 `1b1c`).
- [[read out]] **`GetDriverResourceID`** (ordinal 450, seg6 `02c1`) is like `SVGA256.DRV`'s the other way round:
  - At 96 dots an inch it adds 2000 to `OEMBIN` 1 and 3 and to every number above 7F87h, which are the OEM bitmaps.
  - At 120 it answers each number unchanged.
  - On a half-megabyte card, `OEMBIN` 1 becomes 2100, or 2101 at 96 dots an inch.
  - Its resources are `OEMBIN` 1, 2, 3, "FONTS", 2001, 2003, 2100 and 2101. Its bitmaps 32734-32767 are the large ones (`OBM_CLOSE` is 52 by 26), and 1966-1999 the small ones: 32734 + 2000, taken to 15 bits.

### `XGA.DRV`

- [[read out]] **The table is built at run time** by `Enable` (ordinal 5, seg3 `0755`). Its template is in the data segment (seg11 `178c`):
  - Lines 2, polygons 8Ah, `TEXTCAPS` 2204h, clip 1, raster 02D9h.
  - Aspect 10, 10 and 14, style length 28.
  - The mapping windows 254, 2540, 100, 1000 and 1440.
  - Palette resolution 18.
  - Everything that depends on the mode is -1.
- [[read out]] **Choosing the mode** (seg3 `05e4`, `04fb`):
  1. The driver finds the cards and the monitor each reports.
  2. It counts each card's memory in 256 KB steps, by writing a test byte through the aperture (seg3 `03ce`). A megabyte counts 4.
  3. It looks the monitor up in a table at seg3 `0236`. Each monitor there has a priority and a list of 16-byte modes. A mode gives the memory it needs, the monitor's pixels an inch, its width and height in millimetres, the dots an inch, the width, the height and the bits a pixel.
  4. It takes the first mode the memory allows.
- [[read out]] **The settings** (seg3 `0693`):
  - `SYSTEM.INI`'s `[XGA_DISPLAY] XGA_Resolution=1` makes it 640x480, 8 bits and 96 dots, whatever the monitor. Setup writes that for "XGA (640x480, 256 colors)".
  - `WIN.INI`'s `[XGA_DISPLAY] ColorPreferred=Y` turns a 16-colour 1024x768 into 640x480 at 256 colours.
  - `XGA_Resources` is 1 for "XGA (Small fonts)" and 2 for "XGA (Large fonts)".
- [[read out]] **Filling the table in** (seg3 `0c1c`-`0d41`):
  - The millimetres come from the mode.
  - Every mapping viewport becomes the monitor's pixels an inch, x and -x.
  - The size and the dots an inch come from the mode.
  - At 4 bits: 96 pens and 16 colours.
  - At 8 bits: 120 pens, 20 colours, 20 reserved entries, and `RC_PALETTE`.
  - It adds `RC_BIGFONT` only when `__WINFLAGS` has both `WF_PMODE` and `WF_CPU386`.
- [[read out]] **`GetDriverResourceID`** (seg3 `008e`) depends on the resolution and the resources:
  - In 640x480, it adds 2000 to `OEMBIN` 1 and 3.
  - With `XGA_Resources=1`, it adds 2000 to the bitmaps.
  - At 1024x768 with `XGA_Resources=2`, it answers every number unchanged.
  - Its bitmaps and its `OEMBIN` 1 are the 8514/a's.
- [[read out]] **`QUERYESCSUPPORT`** answers 1 for 5 and 8, and nought for the rest (seg1 `1316`).

[[read out]] Three monitors in the XGA's table have 1024x768:

| Monitor | Millimetres | Pixels an inch |
|---|---|---|
| 9 | 360x270 | 73 |
| 10 | 280x210 | 92 |
| 11 | 252x190 | 104 |

Each of the three has 1024x768 at 8 bits with a megabyte, 1024x768 at 4 bits with half a megabyte, and 640x480 at 4 bits with less. Monitors 13 and 14 have only 640x480. The 1024x768 modes are at 120 dots an inch, the 640x480 ones at 96.

### What winbox.js takes

[[inferred]] winbox.js takes these assumptions, each the one a driver here would meet:

- **A megabyte on the card.** That is the card with 256 colours.
- **Large fonts.** That is Setup's "8514/a" and "XGA (Large fonts)".
- **For the XGA, monitor 10.** Of the three monitors with 1024x768, its 280x210 mm is the 8514/a's own size.
- **Protected mode on a 486, `__WINFLAGS` 419h.** That is what winbox.js is, as `winflags` recorded. It is standard mode, not 386 enhanced mode. `8514.DRV` adds `RC_BIGFONT` on it. `XGA.DRV` tests `WF_CPU386`, which a 486's flags lack, so it does not.

| Answer | `8514` | `xga256` |
|---|---|---|
| `HORZRES` x `VERTRES`, `HORZSIZE` x `VERTSIZE` | 1024x768, 280x210 | 1024x768, 280x210 |
| `LOGPIXELSX` / `Y`, `ASPECTX` / `Y` / `XY` | 120 / 120, 10 / 10 / 14 | 120 / 120, 10 / 10 / 14 |
| `BITSPIXEL` x `PLANES`, `NUMCOLORS` | 8x1, 20 | 8x1, 20 |
| `SIZEPALETTE`, `NUMRESERVED`, `COLORRES` | 256, 20, 18 | 256, 20, 18 |
| `NUMBRUSHES`, `NUMPENS` | -1, 20 | -1, 120 |
| `RASTERCAPS` | 07D9h (2009) | 03D9h (985) |
| `TEXTCAPS` | 2004h (8196) | 2204h (8708) |
| `LINECAPS`, `POLYGONALCAPS`, `CURVECAPS`, `CLIPCAPS` | 2, 8Ah, 0, 1 | 2, 8Ah, 0, 1 |
| `MM_LOMETRIC` window, viewport | 2800x2100, 1024x-768 | 254x254, 92x-92 |
| `MM_HIMETRIC` | 28000x21000, 1024x-768 | 2540x2540, 92x-92 |
| `MM_LOENGLISH` | 4375x4375, 4064x-4064 | 100x100, 92x-92 |
| `MM_HIENGLISH` | 21875x21875, 2032x-2032 | 1000x1000, 92x-92 |
| `MM_TWIPS` | 7875x7875, 508x-508 | 1440x1440, 92x-92 |

[[documented]] Neither driver has `RC_STRETCHBLT` (800h), `RC_STRETCHDIB` (2000h) or `RC_OP_DX_OUTPUT` (4000h). The 8514/a's has no `TC_EA_DOUBLE`. Both have only `LC_POLYLINE` for lines, and `PC_RECTANGLE` and `PC_INTERIORS` besides `PC_SCANLINE`.

[[read out]] **The system metrics** are sums USER makes of the driver's bitmaps, its `OEMBIN` 1 and the system font (`USER.EXE` seg3 `0ee8`-`1124` and `1446`-`14f3`; the icon spacing at `1dc5`-`1ef0`, the frames at `24bc`, the smallest window at `253b`):

- `SM_CXSIZE` x `SM_CYSIZE` is half `OBM_CLOSE`'s width by its height.
- `SM_CYCAPTION` is the larger of a border plus `SM_CYSIZE` and the system font's height, plus a border.
- `SM_CYMENU` is `SM_CYSIZE` when the font is shorter. Otherwise it is the font's height and external leading, plus one.
- The scroll bars are `OBM_UPARROW`'s and `OBM_LFARROW`'s sizes.
- `SM_CXMIN` is two frames, five of USER's average character widths and three `SM_CXSIZE`s.
  - A frame is `BorderWidth` borders and one more. `BorderWidth` is 3 by default.
  - USER's average width is a fixed font's width. For a proportional font it is (the extent of "a"-"z" and "A"-"Z" / 26 + 1) / 2 (seg2 `03a4`).
- `SM_CYMIN` is two times three borders, plus the caption.
- `SM_CXICONSPACING` is `LOGPIXELSX` x 75 / 96, and never less than the icon's width.
- `SM_CYICONSPACING` is a quarter of the icon, four borders and the icon, and two lines of the icon titles' font with a border each. That font is 8-point MS Sans Serif, asked for at `-MulDiv(8, LOGPIXELSY, 72)`.

[[read out]] The same sums give the recorded VGA, Super VGA, EGA and Hercules tables exactly. The 8514/a and the XGA have `OBM_CLOSE` 52x26, arrows 21x22, and `8514SYS.FON` 20 rows high with an average of 10. The sums give them these:

| Metric | Value |
|---|---|
| Caption | 28 |
| Menu | 26 |
| Caption buttons | 26x26 |
| Scroll bars | 21 wide, 22 high |
| Thumbs | 22, 21 |
| Smallest window | 136x34 |
| Icon spacing | 93x78 |

[[read out]] **The default colours** are their `OEMBIN` 1's, the same in both drivers. Some are the palette's static colours: the desktop is `A0A0A4`, the caption and the selection `A4C8F0`, and the application workspace `FFFBF0`. The caption's text is black.

[[read out]] **The static colours.** Both drivers' twenty are the Super VGA's but for the tenth, which is `A4C8F0` where `SVGA256.DRV` has `A6CAF0` (`8514.DRV` data `3B8h`, `XGA.DRV` data `1BD9h`). Both modes have their own 256-colour palette with that colour (`palette: '8514'`, `DevicePalette.TWO_FIFTY_SIX_IBM` and `two_fifty_six_ibm`). With the Super VGA's, the caption's `A4C8F0` would be dithered.

### Installing them

Setup's own installation cannot install them. With an 8514/a or an XGA named, Setup's second half starts Windows on that driver to finish, and on DOSBox's card Windows stops at USER's "Display Resources". So `install-windows.mjs` installs the VGA first and then changes the display, as a person would, without starting Windows. It runs Setup again from DOS in `C:\WINDOWS` and chooses Display and then the driver. Setup does the rest:

- It copies the driver, its fonts and its grabbers.
- In `SYSTEM.INI`, it writes `[boot]`, `[boot.description]`, `[386Enh]` and the driver's own section: `[8514.DRV] dpi=120`, or `[XGA_Display] XGA_Resources=2`.
- In `WIN.INI`, it writes the 120-dot fonts.

The installations are `oracle/build/drive-c-8514` and `drive-c-xga256`. `record.mjs` refuses to record on them.

### Not yet done

- **The small-font and 640x480 settings**: "8514/a (Small fonts)", "XGA (Small fonts)" and "XGA (640x480, 256 colors)". At those settings each driver's `GetDriverResourceID` moves the OEM bitmaps, and some of `OEMBIN`, to their numbers plus 2000. Neither engine runs it yet; both take the resources by their own numbers.
- **The stock `DEFAULT_PALETTE`** on these drivers is not read out. Both engines answer the twenty [[probe:palette]] recorded, with `A6CAF0`.
- **What the screen shows of the statics.** `8514.DRV` puts a component of exactly 80h into the DAC as BFh, except in 808080 (seg1 `2ae9`). `SVGA256.DRV` puts it in as C0h, and only below index 10. These modes show the entries as they are.
- **An escape `8514.DRV` has not got.** Its `Control` returns the escape's own number (seg1 `1b28`-`1b35`). Whether GDI passes that back is not read out, and both engines answer nought.
- **`lineTie` and `boldOverhang`**, how each driver breaks a line's tie and draws a bold overhang, are the colour drivers' recorded choices, carried over and not read out.
- **The drivers' export tables** are not checked against `DISPLAY`'s ordinals (`argument-sizes`).
