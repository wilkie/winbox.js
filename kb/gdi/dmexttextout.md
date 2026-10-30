---
kind: function
module: GDI
name: DMExtTextOut
ordinal: 214
summary: Text drawn on a memory bitmap by the display driver's ExtTextOut, with the emboldening and italics the display can make taken off where another device cannot.
versions:
  '3.1': unrecorded
source: src/win16/gdi/driver-helpers.ts
topics: [gdi-internals, printer-drivers]
---

## Observed behaviour

- [[read out]] `DMExtTextOut(lpDestDev, DestX, DestY, lpClipRect, lpString, wCount, lpFontInfo, lpDrawMode, lpTextXForm, lpCharWidths, lpOpaqueRect, wOptions)` takes 40 bytes of arguments, as the display driver's `ExtTextOut` does. For a device that is not a memory bitmap -- its first word not nought -- nothing is drawn and the answer is GDI's data segment in AX and 34h in DX.
- [[read out]] For a memory bitmap it is the display driver's `ExtTextOut` on that bitmap, its answer the answer.

## Inside Windows

[[read out]] `GDI.EXE` seg13 `0000`: `mov cx,3418h`, CL the words `Brute` moves and CH the offset 34h of `ExtTextOut` in the display driver's table. It is one of the five-byte entries of `GDI.EXE` seg13 that load CX and jump to [[fn:GDI.Brute]] (seg13 `0171`): for a memory bitmap, the display driver's own routine of the same offset is called with the same arguments; for any other device nothing is called and the answer is GDI's data segment in AX with the routine's offset in DX.

[[read out]] Before the call, `DMExtTextOut` looks at the `TEXTXFORM`'s word at 0Fh (seg13 `0011`-`0072`). Where it has `TC_EA_DOUBLE` (200h), the display's `GDIINFO` has it in `dpText` (22h) and the `GDIINFO` of GDI's `[063Eh]` has not, the weight at 8 is made 400 and the bit cleared; likewise for `TC_IA_ABLE` (400h), the italic byte at 0Ah made nought. Each is put back after the call (`00b9`-`00d4`). Then it calls `Brute` with its own arguments by a near call to `012a`, `mov cx,3418h`.

## Callers

[[read out]] None imports it (`kb/data/gdi-callers.json`).

## Implementation

`Brute`'s choice in both engines (`driver-helpers.ts`, `driver_helpers.rs`): the answer for a device that is not a bitmap as read out; for a memory bitmap nought, with nothing drawn, as WinBox's display driver's stubs answer -- WinBox draws with its own raster code and has not got the display driver's `ExtTextOut` for a bitmap in memory.

**Recommendation:** as Windows does, the VGA's text on a bitmap in memory from the driver's `FONTINFO` (M-L).

## Not yet done

- The display driver's `ExtTextOut` on a memory bitmap. See [[topic:gdi-internals]].
