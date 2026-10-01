---
kind: topic
name: Clip regions and saved device contexts
summary: How a Windows 3.1 device context keeps drawing inside its clip region, what the clipping calls answer, and how SaveDC and RestoreDC count their levels — recorded on a memory device context.
probes: [clipdc, selrgn, dcreset]
---

A device context can be told to draw only inside a region: [[fn:GDI.IntersectClipRect]] narrows it to a rectangle, [[fn:GDI.ExcludeClipRect]] cuts a rectangle out of it, [[fn:GDI.SelectClipRgn]] sets it from a region, and [[fn:GDI.OffsetClipRgn]] moves it. [[fn:GDI.GetClipBox]] answers the rectangle around it. A program that draws a picture in a corner of a window usually saves the device context with [[fn:GDI.SaveDC]] first, narrows the clip, draws, and puts everything back with [[fn:GDI.RestoreDC]]. Sound Recorder draws its buttons that way.

[[measured]] [[probe:clipdc]] does all of this on a memory device context with a 16 by 16 colour bitmap. It records what each call answers, the clip box after it, and every pixel after drawing seven ways through a rectangle with a hole in it. winbox.js agrees with all 154 records.

## The region

- [[measured]] Each clipping call answers the kind of region left: 1 empty, 2 a single rectangle, 3 anything else. A rectangle with a hole cut in it is 3, and it stays 3 after an edge is cut away too.
- [[measured]] Until something narrows it, the region is the whole bitmap. A new memory device context, which has only the one-pixel bitmap every memory device context starts with, answers an empty region with an empty box.
- [[measured]] `IntersectClipRect` with its left edge right of its right edge leaves nothing. The edges are not put in order.
- [[measured]] `SelectClipRgn` takes a copy of the region. Changing or deleting the region afterwards changes nothing. With no region it lets the whole bitmap be drawn on again, and answers 2.
- [[measured]] Selecting another bitmap keeps the region as it is.
- [[measured]] `OffsetClipRgn` moves the region, and answers its kind.
- [[measured]] [[fn:GDI.SelectObject]] of a region is `SelectClipRgn` of it, and answers the same: 3 for an ellipse, 2 for a rectangle, 1 for an empty region ([[probe:selrgn]]). An ellipse from (2, 2) to (31, 31) has the box (2, 2)-(30, 30). `SelectObject` of nothing answers nought and leaves the region as it was. The region selected is a copy: [[fn:GDI.PtInRegion]] can still use it after.
- [[measured]] [[fn:GDI.GetPixel]] of a point outside the region answers `CLR_INVALID`, FFFFFFFFh, whatever the pixel is. Once the region is lifted, the same point answers its colour.
- Roulette selects an elliptic region with `SelectObject` before it copies its 300 by 300 wheel. winbox.js had refused the region, and the wheel's white corners covered the table. With the region, Roulette's screen matches Windows' pixel for pixel.

## Drawing inside it

[[measured]] `PatBlt`, `FillRect`, `Rectangle`, `LineTo`, `TextOut`, `SetPixel`, `BitBlt` and `StretchBlt` all stay inside the region, pixel for pixel. A line crossing the hole stops at its edge and carries on past it. A `BitBlt` from a smaller bitmap draws only as much as the source has.

## Saved levels

- [[measured]] `SaveDC` answers the new level: 1 for the first, then 2 and 3.
- [[measured]] `RestoreDC` answers the level it restored and drops that level and every later one, so the next `SaveDC` answers that level again. A negative level counts back from the last: −1 is the last, −2 the one before. Nought restores level 1. A level that is not there answers nought and changes nothing.
- [[measured]] The text and background colours ([[fn:GDI.GetTextColor]], [[fn:GDI.GetBkColor]]), the stretch mode and the clip region all come back.

## Not yet recorded

- A window's device context, where the region is also kept to what is being painted.
- Which other parts of the state `SaveDC` saves. winbox.js also saves the background mode, text alignment, character spacing, brush, pen, font, drawing mode, brush origin and current position, but not the bitmap.
- Whether a window's device context forgets its region when it is released. winbox.js clears it in `GetDC` and `BeginPaint`, because its window device contexts last as long as the window.

## A window's device context, got again

[[measured]] [[probe:dcreset]] selects the ANSI fixed font, red text on a green background, `TRANSPARENT`, `R2_NOT`, the white pen and the black brush into a window's device context. It gives the context back, gets one again, and asks what it has.

- **A common device context**, for a window whose class has no `CS_OWNDC`, has forgotten all of it. It has the System font, black text on white, `OPAQUE`, `R2_COPYPEN` and the black pen and white brush, as a new one has.
- **With `CS_OWNDC`**, the window's own context keeps all of it.

Cribbage selects a fixed font into its window's device context, gives it back, and draws its status line in the next one it gets. Windows draws the line in the System font. winbox.js's window device contexts last as long as the window, and kept the fixed font. It now resets a common one's attributes in `GetDC` and `BeginPaint`, but only when no other context of the window is still out. Its contexts for a window share one surface, so a reset while a paint is under way would take what that paint selected, as Championship Slots showed.

## In winbox.js

The region is `src/raster/clip-region.ts`: bands of rows, each a set of runs of columns, with bands that are alike joined, so a region that is only a rectangle is always one. The device context hands it to the context of the bitmap selected into it (`dcClip`), and every pixel that is drawn is checked against it. The functions are in `src/win16/gdi/clipping.ts` and `src/win16/gdi/SaveDC.ts`.
