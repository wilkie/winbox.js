---
kind: function
module: GDI
name: DMDibBits
ordinal: 217
summary: A memory bitmap's bits got or set as a DIB by the display driver's DeviceBitmapBits, its scans counted from the DIB's bottom.
versions:
  '3.1': partial
probes: [gdidmdrw, gdidmdib]
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

[[read out]] `SVGA256.DRV` seg9 `0000`: a compressed DIB to routines of its own (`15ac`, `1a38`); no buffer for the bits answers the scans asked on a get, `biSizeImage` their bytes, and nought on a set; the scans the DIB's from its bottom, a row of the bitmap counted and laid out by the DIB's width and height (`00c9`). A set (`018c`) takes the colour table as words, a palette's index each: on a byte a pixel the low byte of each pixel's word, on a monochrome bitmap bit nought of the low byte for a DIB of a bit and of the high byte for the others; 24 bits matched by GDI's `DeviceColorMatch` (ordinal 449, found by `Enable`, seg3 `0050`-`006a`) with the translation table, red and blue swapped (`05ac`, `070a`). A get (`07b6`) goes through 256 bytes of the translation table (`0a1a`): a bit set where an index's byte is not nought, 4 bits its low four, 8 bits the index, 24 bits the table's first three bytes of four at the index; the colour table not written.

## Callers

[[read out]] None imports it (`kb/data/gdi-callers.json`).

## Implementation

`driver-bitmap.ts` and `driver_bitmap.rs` on the VGA, the Super VGA and the EGA, as read out; a compressed DIB answers nought. [[probe:gdidmdrw]] agrees in both engines on the three.

On the 256-colour display its own (`driver-vga256.ts`, `driver_vga256.rs`), [[probe:gdidmdrw]] agreeing. A null translation table is read as noughts. [[probe:gdidmdib]], a translation table of its own, agrees in both engines: a get of 1, 4, 8 and 24 bits from both formats, and a set of 24 bits through `DeviceColorMatch`.

## Not yet done

- A compressed DIB, which the driver reads through a routine of its own.
- [[probe:gdidmdrw]]'s records on the 256-colour display of a DIB got of 1, 4 or 24 bits, and of one set of 24: it hands a null translation table, which Windows would fault on and DOSBox reads as its real-mode vectors (known gaps). [[probe:gdidmdib]] records the same paths with a table of its own.
