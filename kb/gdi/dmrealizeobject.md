---
kind: function
module: GDI
name: DMRealizeObject
ordinal: 210
summary: A pen, brush or font realized for a memory bitmap by the display driver's RealizeObject, for a printer's driver.
versions:
  '3.1': unrecorded
source: src/win16/gdi/driver-helpers.ts
topics: [gdi-internals, printer-drivers]
---

## Observed behaviour

- [[read out]] `DMRealizeObject(lpDestDev, wStyle, lpInObj, lpOutObj, lpTextXForm)` takes 18 bytes of arguments, as the display driver's `RealizeObject` does. For a device that is not a memory bitmap -- its first word not nought -- nothing is drawn and the answer is GDI's data segment in AX and 24h in DX.
- [[read out]] For a memory bitmap it is the display driver's `RealizeObject` on that bitmap, its answer the answer.

## Inside Windows

[[read out]] `GDI.EXE` seg13 `015e`: `mov cx,240Dh`, CL the words `Brute` moves and CH the offset 24h of `RealizeObject` in the display driver's table. It is one of the five-byte entries of `GDI.EXE` seg13 that load CX and jump to [[fn:GDI.Brute]] (seg13 `0171`): for a memory bitmap, the display driver's own routine of the same offset is called with the same arguments; for any other device nothing is called and the answer is GDI's data segment in AX with the routine's offset in DX.

## Callers

[[read out]] `PSCRIPT.DRV` imports it by ordinal. No program of the corpus does.

## Implementation

`Brute`'s choice in both engines (`driver-helpers.ts`, `driver_helpers.rs`): the answer for a device that is not a bitmap as read out; for a memory bitmap nought, with nothing drawn, as WinBox's display driver's stubs answer -- WinBox draws with its own raster code and has not got the display driver's `RealizeObject` for a bitmap in memory.

**Recommendation:** as Windows does: the VGA's physical pen and brush as its `RealizeObject` lays them out (M), the first step before `DMOutput` and `DMBitBlt`.

## Not yet done

- The display driver's `RealizeObject` on a memory bitmap. See [[topic:gdi-internals]].
