---
kind: function
module: GDI
name: DMSetDibToDev
ordinal: 219
summary: A DIB's scans asked of a memory bitmap through the display driver's DIBToDevice (the VGA's DIBScreenBlt), which draws only on the screen.
versions:
  '3.1': partial
probes: [gdidmdrw]
records: [dibtodev]
source: crates/winbox-win16/src/gdi/driver_helpers.rs
topics: [gdi-internals, printer-drivers]
---

## Observed behaviour

- [[read out]] `DMSetDibToDev(lpDestDev, X, Y, iScan, cScans, lpClipRect, lpDrawMode, lpDIBits, lpBitmapInfo, lpTranslate)` takes 32 bytes of arguments, as the display driver's `DIBToDevice` does. For a device that is not a memory bitmap -- its first word not nought -- nothing is drawn and the answer is GDI's data segment in AX and 50h in DX.
- [[measured]] [[probe:gdidmdrw]]: on a memory bitmap, colour or monochrome, clipped or not, nothing is drawn and nought is answered, on the VGA, the Super VGA and the EGA.

## Inside Windows

[[read out]] `GDI.EXE` seg13 `0145`: `mov cx,5014h`, CL the words `Brute` moves and CH the offset 50h of `DIBToDevice` in the display driver's table, a jump to [[fn:GDI.Brute]] (seg13 `0171`). In `VGA.DRV` that entry is `DIBScreenBlt`, ordinal 21, seg9 `0e2a`.

[[read out]] `SVGA256.DRV` seg9 `0dba`, into its `StretchDIBits` (`0e1d`): a destination whose first word is nought, a memory bitmap, answers -1 and draws nothing (`0eae`-`0eb4`).

## Callers

[[read out]] None imports it (`kb/data/gdi-callers.json`).

## Implementation

Nought, nothing drawn (`crates/winbox-win16/src/gdi/driver_bitmap.rs`). [[probe:gdidmdrw]] agrees.

On the 256-colour display its own (`crates/winbox-win16/src/gdi/driver_vga256.rs`), [[probe:gdidmdrw]] agreeing.

## Not yet done

- Nothing on a memory bitmap: every display WinBox has answers as recorded.
