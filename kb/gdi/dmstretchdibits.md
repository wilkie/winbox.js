---
kind: function
module: GDI
name: DMStretchDIBits
ordinal: 218
summary: A DIB stretched onto a memory bitmap by the display driver's StretchDIBits, which the VGA has not got.
versions:
  '3.1': unrecorded
source: crates/winbox-win16/src/gdi/driver_helpers.rs
topics: [gdi-internals, printer-drivers]
---

## Observed behaviour

- [[read out]] `DMStretchDIBits(lpDestDev, fGet, DestX, DestY, DestXE, DestYE, SrcX, SrcY, SrcXE, SrcYE, lpBits, lpBitmapInfo, lpTranslate, Rop3, lpPBrush, lpDrawMode, lpClip)` takes 50 bytes of arguments, as the display driver's `StretchDIBits` does. For a device that is not a memory bitmap -- its first word not nought -- nothing is drawn and the answer is GDI's data segment in AX and 6Ch in DX.
- [[read out]] For a memory bitmap it is the display driver's `StretchDIBits` on that bitmap, its answer the answer.

## Inside Windows

[[read out]] `GDI.EXE` seg13 `0140`: `mov cx,6C1Dh`, CL the words `Brute` moves and CH the offset 6Ch of `StretchDIBits` in the display driver's table. It is one of the five-byte entries of `GDI.EXE` seg13 that load CX and jump to [[fn:GDI.Brute]] (seg13 `0171`): for a memory bitmap, the display driver's own routine of the same offset is called with the same arguments; for any other device nothing is called and the answer is GDI's data segment in AX with the routine's offset in DX.

## Callers

[[read out]] None imports it (`kb/data/gdi-callers.json`).

## Implementation

`Brute`'s choice in both engines (`crates/winbox-win16/src/gdi/driver_helpers.rs`): the answer for a device that is not a bitmap as read out; for a memory bitmap nought, with nothing drawn, as WinBox's display driver's stubs answer -- WinBox draws with its own raster code and has not got the display driver's `StretchDIBits` for a bitmap in memory.

**Recommendation:** not applicable on the VGA, the EGA and the Hercules, whose drivers have no `StretchDIBits` (ordinal 28); as Windows does on the 256-colour driver (M).

## Not yet done

- The display driver's `StretchDIBits` on a memory bitmap. See [[topic:gdi-internals]].
