---
kind: function
module: GDI
name: DMSetDibToDev
ordinal: 219
summary: A DIB's scans set onto a memory bitmap by the display driver's DIBToDevice (the VGA's DIBScreenBlt).
versions:
  '3.1': unrecorded
source: src/win16/gdi/driver-helpers.ts
topics: [gdi-internals, printer-drivers]
---

## Observed behaviour

- [[read out]] `DMSetDibToDev(lpDestDev, X, Y, iScan, cScans, lpClipRect, lpDrawMode, lpDIBits, lpBitmapInfo, lpTranslate)` takes 32 bytes of arguments, as the display driver's `DIBToDevice` does. For a device that is not a memory bitmap -- its first word not nought -- nothing is drawn and the answer is GDI's data segment in AX and 50h in DX.
- [[read out]] For a memory bitmap it is the display driver's `DIBToDevice` on that bitmap, its answer the answer.

## Inside Windows

[[read out]] `GDI.EXE` seg13 `0145`: `mov cx,5014h`, CL the words `Brute` moves and CH the offset 50h of `DIBToDevice` in the display driver's table. It is one of the five-byte entries of `GDI.EXE` seg13 that load CX and jump to [[fn:GDI.Brute]] (seg13 `0171`): for a memory bitmap, the display driver's own routine of the same offset is called with the same arguments; for any other device nothing is called and the answer is GDI's data segment in AX with the routine's offset in DX.

## Callers

[[read out]] None imports it (`kb/data/gdi-callers.json`).

## Implementation

`Brute`'s choice in both engines (`driver-helpers.ts`, `driver_helpers.rs`): the answer for a device that is not a bitmap as read out; for a memory bitmap nought, with nothing drawn, as WinBox's display driver's stubs answer -- WinBox draws with its own raster code and has not got the display driver's `DIBToDevice` for a bitmap in memory.

**Recommendation:** as Windows does, through WinBox's own `SetDIBitsToDevice` on the bitmap (M).

## Not yet done

- The display driver's `DIBToDevice` on a memory bitmap. See [[topic:gdi-internals]].
