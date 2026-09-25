---
kind: topic
name: Display drivers
summary: Which Windows 3.1 screen answers come from the installed display driver and which come from GDI, what four recorded drivers report, and why every display-dependent fixture is recorded once for each display.
probes: [devcaps]
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

## Why fixtures are recorded per display

[[measured]] A fixture is only correct for the driver it was recorded on. The Super VGA and the VGA differ only in resolution. The EGA changes the vertical resolution. The Hercules changes the pixel shape, the colour depth and the capability bits all at once. The recorder installs Windows once for each display. It names each fixture after its display, for example `devcaps-ega.json`, and the conformance suite replays each fixture on a machine running that display mode. All 37 records of each `devcaps` fixture agree with winbox.js. To record a display yourself, see [[guide:reproducing]].

Not yet measured: a 256-colour driver. None can be recorded yet, because DOSBox emulates none of the cards that Windows 3.1's 256-colour drivers need. winbox.js has two such modes marked `modelled`, and no fixture supports their numbers.
