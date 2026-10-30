---
kind: function
module: GDI
name: DMOutput
ordinal: 208
summary: A printer's driver's lines and shapes on a memory bitmap, handed to the display driver's Output.
versions:
  '3.1': unrecorded
source: src/win16/gdi/driver-helpers.ts
topics: [gdi-internals, printer-drivers]
---

## Observed behaviour

- [[read out]] `DMOutput(lpDestDev, wStyle, wCount, lpPoints, lpPPen, lpPBrush, lpDrawMode, lpClipRect)` takes 28 bytes of arguments, as the display driver's `Output` does. For a device that is not a memory bitmap -- its first word not nought -- nothing is drawn and the answer is GDI's data segment in AX and 1Ch in DX.
- [[read out]] For a memory bitmap it is the display driver's `Output` on that bitmap, its answer the answer.

## Inside Windows

[[read out]] `GDI.EXE` seg13 `0159`: `mov cx,1C12h`, CL the words `Brute` moves and CH the offset 1Ch of `Output` in the display driver's table. It is one of the five-byte entries of `GDI.EXE` seg13 that load CX and jump to [[fn:GDI.Brute]] (seg13 `0171`): for a memory bitmap, the display driver's own routine of the same offset is called with the same arguments; for any other device nothing is called and the answer is GDI's data segment in AX with the routine's offset in DX.

## Callers

[[read out]] `PSCRIPT.DRV` imports it by ordinal. No program of the corpus does.

## Implementation

`Brute`'s choice in both engines (`driver-helpers.ts`, `driver_helpers.rs`): the answer for a device that is not a bitmap as read out; for a memory bitmap nought, with nothing drawn, as WinBox's display driver's stubs answer -- WinBox draws with its own raster code and has not got the display driver's `Output` for a bitmap in memory.

**Recommendation:** as Windows does, with the VGA's physical pens and brushes (L).

## Not yet done

- The display driver's `Output` on a memory bitmap. See [[topic:gdi-internals]].
