---
kind: topic
name: Mapping modes
summary: How a Windows 3.1 device context turns a program's logical coordinates into pixels — the eight modes, their origins and extents on four displays, how a coordinate is rounded, and what drawing does through a moved origin and a scale.
probes: [mapmode, exfuncs]
---

A program gives GDI coordinates in its own units, **logical**, and the device context turns them into pixels, **device**. On each axis, device = (logical − window origin) × viewport extent ÷ window extent + viewport origin. The mapping mode ([[fn:GDI.SetMapMode]]) picks the extents. The origins are the program's to move ([[fn:GDI.SetWindowOrg]], [[fn:GDI.SetViewportOrg]]), and in two of the modes so are the extents ([[fn:GDI.SetWindowExt]], [[fn:GDI.SetViewportExt]]). Paintbrush moves its window origin to scroll its picture.

[[measured]] [[probe:mapmode]] records, on the VGA, the EGA, the Super VGA and the Hercules:
- every mode's origins and extents;
- what each origin and extent call answers;
- 150 points through [[fn:GDI.LPtoDP]] and [[fn:GDI.DPtoLP]];
- every pixel of a 16 by 16 bitmap after drawing seven ways through a moved origin and a scale.

winbox.js agrees with all of them on all four displays.

## The modes

- [[measured]] `SetMapMode` answers the mode before. Nought, and anything past 8, answer nought and change nothing.
- [[measured]] `MM_TEXT` has extents of 1, so logical is device.
- [[measured]] `MM_LOMETRIC`, `MM_HIMETRIC`, `MM_LOENGLISH`, `MM_HIENGLISH` and `MM_TWIPS` take their extents from the display driver, with the viewport's y negative, so y runs up the screen. On the VGA they are 2080 by 1560 to 640 by −480 for `MM_LOMETRIC` and 325 to 254 for `MM_LOENGLISH`. On the Hercules the English ones are not even quite the millimetres converted: 1000 by 725 to 813 by −442. They are the driver's own numbers.
- [[measured]] `MM_ISOTROPIC` starts with `MM_LOMETRIC`'s extents. `MM_ANISOTROPIC` keeps what the device context already had.
- [[measured]] Only those two take new extents. In any other mode `SetWindowExt` and `SetViewportExt` answer the extent and change nothing. An extent of nought answers nought.
- [[measured]] `ScaleWindowExt` and `ScaleViewportExt` multiply and divide each extent, rounded: a window extent of 10 scaled by 2/3 becomes 7.
- [[measured]] In `MM_ISOTROPIC`, setting either extent shrinks the viewport extent on whichever axis would have the larger scale, keeping its sign. The scales are compared as lengths on the screen, with a pixel `ASPECTX` wide to `ASPECTY` tall. On the EGA, 38 to 48, a window of 100 by 100 on a viewport of 640 by −350 becomes 442 by −350, not 350.
- [[measured]] The origins can be set and offset in every mode. Every call answers what it had before, x in the low word.

## Rounding

[[measured]] The division rounds to the nearest whole number, a half away from nought, with one quirk. The half that is added is the divisor shifted right by one bit. For a negative odd divisor that is the larger half. With a window extent of 7 and a viewport extent of −3, device 1 becomes logical −3 and device −1 becomes 3, where plain rounding would give −2 and 2. 150 points on each display agree.

## Drawing

- [[measured]] Every drawing call maps its points, and both corners of a rectangle. `PatBlt(1, 1, 5, 4)` at two thirds covers columns 1 to 3 and rows 1 and 2: 1 maps to 1, 6 to 4, and 5 to 3.
- [[measured]] A [[fn:GDI.BitBlt]] maps both of its rectangles, each through its own device context, so a source whose window origin is moved is read from the moved place. Where the two rectangles come out different sizes, it stretches as [[fn:GDI.StretchBlt]] does: four logical pixels at a viewport of 3 by 2 fill 12 by 8.
- [[measured]] Lines, rectangles and moved origins draw the same pixels as the same shapes given in device terms. That includes, on the Hercules, three lines whose every other step is a tie. Those do not show whether GDI or the driver drew them, because the Hercules driver's own rule turns the tie the same way at that slope.

## Not yet followed

- Sizes: a font's height, a pen's width and `ExtTextOut`'s spacing are taken as device units.
- Clip regions are kept in device terms, and `GetClipBox` answers in logical terms. Neither is recorded through a mapping.
- Regions, `Polygon`, `Polyline` and the other calls that take lists of points.

## In winbox.js

`src/win16/gdi/mapping.ts` holds each device context's mapping and the rounding. The Ex forms, which answer in a `POINT` or `SIZE`, wrap the plain ones in `src/win16/gdi/ex-forms.ts`, as [[probe:exfuncs]] records them: see [[fn:GDI.MoveToEx]]. A drawing call maps its coordinates as it starts, and only when the mapping moves or scales something, so every call made in `MM_TEXT` with no origin moved does exactly what it did before.
