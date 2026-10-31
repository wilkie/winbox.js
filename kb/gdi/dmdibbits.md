---
kind: function
module: GDI
name: DMDibBits
ordinal: 217
summary: A memory bitmap's bits got or set as a DIB by the display driver's DeviceBitmapBits, its scans counted from the DIB's bottom.
versions:
  '3.1': partial
probes: [gdidmdrw]
records: [dibget, dibset]
source: src/win16/gdi/driver-bitmap.ts
topics: [gdi-internals, printer-drivers]
---

## Observed behaviour

- [[read out]] `DMDibBits(lpBitmap, fGet, iStart, cScans, lpDIBits, lpBitmapInfo, lpDrawMode, lpTranslate)` takes 26 bytes of arguments, as the display driver's `DeviceBitmapBits` does. For a device that is not a memory bitmap -- its first word not nought -- nothing is drawn and the answer is GDI's data segment in AX and 48h in DX.
- [[measured]] [[probe:gdidmdrw]], DIBs of 1, 4, 8 and 24 bits: the answer is the count of scans, from `iStart` as many as asked that the DIB's height leaves -- 2 for six of eight asked from 6. Scan nought is the bitmap's last row.
- [[measured]] Got: each pixel its colour's index; in a DIB of one bit, white for the colours a monochrome bitmap takes as white. The colour table is the VGA's sixteen, and for a DIB of one bit, or any DIB of a monochrome bitmap, black but the last entry, white.
- [[measured]] Set: each pixel's colour matched to the display's, and on a monochrome bitmap white where that colour is.
- [[measured]] The EGA's driver differs from the VGA's only by its ninth colour, 404040h.

## Inside Windows

[[read out]] `GDI.EXE` seg13 `013b`: `mov cx,4811h`, CL the words `Brute` moves and CH the offset 48h of `DeviceBitmapBits` in the display driver's table, a jump to [[fn:GDI.Brute]] (seg13 `0171`).

[[read out]] `VGA.DRV` seg9 `0d1e`: a compressed DIB (its byte 10h) is handed to a routine of run lengths; a set with no buffer answers nought; a set goes to `0048`, a get to `0764`. The scans' count from the header's height less the start (`06c9`-`06eb`), nought where none is left. The get writes `biClrUsed` nought and `biSizeImage` the DIB's size (`0773`, `087a`-`089d`), checks for 1, 4, 8 or 24 bits (`078d`), and writes the colour table: black and white for a bit (`09cc`), the driver's sixteen at seg9 `0000` and noughts after (`09db`), or for a monochrome bitmap noughts and the last white. The monochrome flag of each index at seg9 `0754`.

## Callers

[[read out]] None imports it (`kb/data/gdi-callers.json`).

## Implementation

`driver-bitmap.ts` and `driver_bitmap.rs` on the VGA, the Super VGA and the EGA, as read out; a compressed DIB answers nought. [[probe:gdidmdrw]] agrees in both engines on the three.

## Not yet done

- A compressed DIB, which the driver reads through a routine of its own.
- The Hercules's and the 256-colour display's own `DeviceBitmapBits` (known gaps of [[probe:gdidmdrw]]).
