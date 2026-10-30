---
kind: function
module: GDI
name: DMBitBlt
ordinal: 201
summary: A printer's driver's block transfer on a memory bitmap, handed to the display driver's BitBlt; the one helper whose source is a device too.
versions:
  '3.1': unrecorded
source: src/win16/gdi/driver-helpers.ts
topics: [gdi-internals, printer-drivers]
---

## Observed behaviour

- [[read out]] `DMBitBlt(lpDestDev, DestX, DestY, lpSrcDev, SrcX, SrcY, Xext, Yext, Rop3, lpPBrush, lpDrawMode)` takes 32 bytes of arguments, as the display driver's `BitBlt` does. For a device that is not a memory bitmap -- its first word not nought -- nothing is drawn and the answer is GDI's data segment in AX and 00h in DX.
- [[read out]] For a memory bitmap it is the display driver's `BitBlt` on that bitmap, its answer the answer.

## Inside Windows

[[read out]] `GDI.EXE` seg13 `014a`: `mov cx,0014h`, CL the words `Brute` moves and CH the offset 00h of `BitBlt` in the display driver's table. It is one of the five-byte entries of `GDI.EXE` seg13 that load CX and jump to [[fn:GDI.Brute]] (seg13 `0171`): for a memory bitmap, the display driver's own routine of the same offset is called with the same arguments; for any other device nothing is called and the answer is GDI's data segment in AX with the routine's offset in DX.

[[read out]] Of all the helpers only this one looks at a second device: with an offset of nought, `Brute` takes the source too (`01b2`-`01c0`), and for a source that is a memory bitmap sets its `bmlpPDevice` for the call and puts it back after (`01ce`-`01e6`). A source of nought is left alone. The driver called is the last device's: a bitmap source makes it the display's whatever the destination.

## Callers

[[read out]] `PSCRIPT.DRV` imports it by ordinal. No program of the corpus does.

## Implementation

`Brute`'s choice in both engines (`driver-helpers.ts`, `driver_helpers.rs`): the answer for a device that is not a bitmap as read out; for a memory bitmap nought, with nothing drawn, as WinBox's display driver's stubs answer -- WinBox draws with its own raster code and has not got the display driver's `BitBlt` for a bitmap in memory.

**Recommendation:** as Windows does, once WinBox has the VGA's `BitBlt` for a bitmap in memory and its physical brushes (L). WinBox hands the PostScript driver memory bitmaps only where GDI stretches for a driver that cannot, which the PostScript driver can.

## Not yet done

- The display driver's `BitBlt` on a memory bitmap. See [[topic:gdi-internals]].
