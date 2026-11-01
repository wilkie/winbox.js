---
kind: function
module: GDI
name: DMOutput
ordinal: 208
summary: A printer's driver's lines and shapes on a memory bitmap, handed to the display driver's Output -- which draws polylines and scanlines and leaves the rest to GDI.
versions:
  '3.1': partial
probes: [gdidmdrw]
records: [output]
source: src/win16/gdi/driver-bitmap.ts
topics: [gdi-internals, printer-drivers]
---

## Observed behaviour

- [[read out]] `DMOutput(lpDestDev, wStyle, wCount, lpPoints, lpPPen, lpPBrush, lpDrawMode, lpClipRect)` takes 28 bytes of arguments, as the display driver's `Output` does. For a device that is not a memory bitmap -- its first word not nought -- nothing is drawn and the answer is GDI's data segment in AX and 1Ch in DX.
- [[measured]] [[probe:gdidmdrw]]: only `OS_POLYLINE` (18) and `OS_SCANLINES` (4) are drawn. Rectangles, ellipses, polygons and every other style answer -1 and draw nothing, which tells GDI to make them itself.
- [[measured]] A polyline answers 1. Each segment draws up to its end and not the end, the pixel nearest the line at each step along its longer axis, a tie to the smaller y -- the VGA's lines on the screen ([[topic:line-drawing]]). Only pixels inside the clipping rectangle are drawn, the whole line's pixels and no others. Each pixel is the pen's colour under the `DRAWMODE`'s binary raster operation.
- [[measured]] A styled pen's gaps are drawn in the background colour where the background is opaque and left where it is transparent. The style goes on from one segment into the next, not starting again at each.
- [[measured]] Scanlines answer nought. The first point is the count of points and the row; each point after it is a run from its x to before its y. Each pixel is the brush's under the raster operation, and with no brush the pen's colour. The clipping rectangle is not looked at. A hatched brush where the background is transparent draws its hatch alone.
- [[measured]] The Super VGA's and the EGA's drivers give every record the VGA's.

## Inside Windows

[[read out]] `GDI.EXE` seg13 `0159`: `mov cx,1C12h`, CL the words `Brute` moves and CH the offset 1Ch of `Output` in the display driver's table. It is one of the five-byte entries of `GDI.EXE` seg13 that load CX and jump to [[fn:GDI.Brute]] (seg13 `0171`): for a memory bitmap, the display driver's own routine of the same offset is called with the same arguments; for any other device nothing is called and the answer is GDI's data segment in AX with the routine's offset in DX.

[[read out]] `VGA.DRV` seg1 `284e`: a style of 12h jumps to `Do_Polylines` (seg6 `00a0`, ordinal 90), of 4 to `Do_Scanlines` (seg8 `006e`, ordinal 91); any other answers -1 by `retf 1Ch`.

[[read out]] The style of a line (seg6 `01c0`-`01ea`, `0347`-`03ca`): the pen's style picks a word of masks at seg6 `0056` -- `FFFF`, `E7E7`, `AA55`, `E427`, `EA57` for solid, dash, dot, dash-dot and dash-dot-dot, the high byte the low one reversed, for a line drawn from its other end. Each segment is drawn from its left end. A counter at `[bp-60h]` is the style's place: a segment moves it by 40h times its longer span where `55h * |dy| <= 40h * |dx|`, else by 55h times it, and each bit of the mask is 100h of it; the counter is not reset between segments. A segment drawn from its other end starts from the counter's complement with the reversed mask, which comes to the same bits.

## Callers

[[read out]] `PSCRIPT.DRV` imports it by ordinal. No program of the corpus does.

## Implementation

`driver-bitmap.ts` and `driver_bitmap.rs` on the VGA, the Super VGA and the EGA: the polyline walked as above with the style's counter, the clip and the raster operation; scanlines as above. [[probe:gdidmdrw]] agrees in both engines on the three.

## Nuances

- WinBox's own `LineTo` restarts a style at each line, as GDI's `LineTo` hands the driver a polyline of two points each time; a driver's own polyline carries the style on.

## Not yet done

- The 256-colour display's own `Output`, which answers nought here (known gaps of [[probe:gdidmdrw]]).
- The Hercules's walk along a styled line, in runs (`HERCULES.DRV` seg4 `02f6`-`0360`, its steps 40h and 48h): where each pixel falls in the style shows on a transparent background, one record of [[probe:gdidmdrw]].
