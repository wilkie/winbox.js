---
kind: function
module: GDI
name: DMStretchBlt
ordinal: 216
summary: A stretch on a memory bitmap handed to the display driver's StretchBlt, which the VGA has not got.
versions:
  '3.1': unrecorded
source: src/win16/gdi/driver-helpers.ts
topics: [gdi-internals, printer-drivers]
---

## Observed behaviour

- [[read out]] `DMStretchBlt(lpDestDev, DestX, DestY, DestXE, DestYE, lpSrcDev, SrcX, SrcY, SrcXE, SrcYE, Rop3, lpPBrush, lpDrawMode, lpClip)` takes 40 bytes of arguments, as the display driver's `StretchBlt` does. For a device that is not a memory bitmap -- its first word not nought -- nothing is drawn and the answer is GDI's data segment in AX and 68h in DX.
- [[read out]] For a memory bitmap it is the display driver's `StretchBlt` on that bitmap, its answer the answer.

## Inside Windows

[[read out]] `GDI.EXE` seg13 `0136`: `mov cx,6818h`, CL the words `Brute` moves and CH the offset 68h of `StretchBlt` in the display driver's table. It is one of the five-byte entries of `GDI.EXE` seg13 that load CX and jump to [[fn:GDI.Brute]] (seg13 `0171`): for a memory bitmap, the display driver's own routine of the same offset is called with the same arguments; for any other device nothing is called and the answer is GDI's data segment in AX with the routine's offset in DX.

[[read out]] Unlike `DMBitBlt`, its source is not looked at: an offset other than nought takes only the destination (`01ae`). The VGA's, the EGA's and the Hercules's drivers export no `StretchBlt` (ordinal 27), so what GDI's table holds there is called; `SVGA256.DRV` has one.

## Callers

[[read out]] None imports it (`kb/data/gdi-callers.json`).

## Implementation

`Brute`'s choice in both engines (`driver-helpers.ts`, `driver_helpers.rs`): the answer for a device that is not a bitmap as read out; for a memory bitmap nought, with nothing drawn, as WinBox's display driver's stubs answer -- WinBox draws with its own raster code and has not got the display driver's `StretchBlt` for a bitmap in memory.

**Recommendation:** not applicable on the VGA, the EGA and the Hercules, whose drivers have no `StretchBlt`; as Windows does on the 256-colour driver, with it (M).

## Not yet done

- The display driver's `StretchBlt` on a memory bitmap. See [[topic:gdi-internals]].
