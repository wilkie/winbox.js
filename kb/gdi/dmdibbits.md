---
kind: function
module: GDI
name: DMDibBits
ordinal: 217
summary: A memory bitmap's bits got or set as a DIB by the display driver's DeviceBitmapBits, its scans counted from the DIB's bottom.
versions:
  '3.1': partial
probes: [gdidmdrw, gdidmdib, gdidmrle]
records: [dibget, dibset]
source: crates/winbox-win16/src/gdi/driver_helpers.rs
topics: [gdi-internals, printer-drivers]
---

## Observed behaviour

- [[read out]] `DMDibBits(lpBitmap, fGet, iStart, cScans, lpDIBits, lpBitmapInfo, lpDrawMode, lpTranslate)` takes 26 bytes of arguments, as the display driver's `DeviceBitmapBits` does. For a device that is not a memory bitmap -- its first word not nought -- nothing is drawn and the answer is GDI's data segment in AX and 48h in DX.
- [[measured]] [[probe:gdidmdrw]], DIBs of 1, 4, 8 and 24 bits: the answer is the count of scans, from `iStart` as many as asked that the DIB's height leaves -- 2 for six of eight asked from 6. Scan nought is the bitmap's last row.
- [[measured]] Got: each pixel its colour's index; in a DIB of one bit, white for the colours a monochrome bitmap takes as white. The colour table is the VGA's sixteen, and for a DIB of one bit, or any DIB of a monochrome bitmap, black but the last entry, white.
- [[measured]] Set: each pixel's colour matched to the display's, and on a monochrome bitmap white where that colour is.
- [[measured]] The EGA's driver differs from the VGA's only by its ninth colour, 404040h.

- [[measured]] [[probe:gdidmrle]], a run-length encoded DIB set into a bitmap 16 by 8 of the display's format and of one plane, 64 bytes either side seen too: the answer 1, the stream walked to its end of bitmap, nothing clipped. On the VGA the first line is the bitmap's bottom row less the start, a run past the right edge goes on into the next plane's row and the last row's last plane past the bits, and lines past the top before them; a compression of 3 is read as four bits. On the 256-colour display the first line is the DIB's height less one, a run past the right edge goes on into the next row, a line above the bitmap ends the walk, and a compression of 3, or a monochrome bitmap, answers -1. The colour table on the 256-colour display is words, a palette's index each; eight bits go through it only where it is not the indices in order.

## Inside Windows

[[read out]] `GDI.EXE` seg13 `013b`: `mov cx,4811h`, CL the words `Brute` moves and CH the offset 48h of `DeviceBitmapBits` in the display driver's table, a jump to [[fn:GDI.Brute]] (seg13 `0171`).

[[read out]] `VGA.DRV` seg9 `0d1e`: a compressed DIB (its byte 10h) is handed to a routine of run lengths; a set with no buffer answers nought; a set goes to `0048`, a get to `0764`. The scans' count from the header's height less the start (`06c9`-`06eb`), nought where none is left. The get writes `biClrUsed` nought and `biSizeImage` the DIB's size (`0773`, `087a`-`089d`), checks for 1, 4, 8 or 24 bits (`078d`), and writes the colour table: black and white for a bit (`09cc`), the driver's sixteen at seg9 `0000` and noughts after (`09db`), or for a monochrome bitmap noughts and the last white. The monochrome flag of each index at seg9 `0754`.

[[read out]] `SVGA256.DRV` seg9 `0000`: a compressed DIB to routines of its own (`15ac`, `1a38`); no buffer for the bits answers the scans asked on a get, `biSizeImage` their bytes, and nought on a set; the scans the DIB's from its bottom, a row of the bitmap counted and laid out by the DIB's width and height (`00c9`). A set (`018c`) takes the colour table as words, a palette's index each: on a byte a pixel the low byte of each pixel's word, on a monochrome bitmap bit nought of the low byte for a DIB of a bit and of the high byte for the others; 24 bits matched by GDI's `DeviceColorMatch` (ordinal 449, found by `Enable`, seg3 `0050`-`006a`) with the translation table, red and blue swapped (`05ac`, `070a`). A get (`07b6`) goes through 256 bytes of the translation table (`0a1a`): a bit set where an index's byte is not nought, 4 bits its low four, 8 bits the index, 24 bits the table's first three bytes of four at the index; the colour table not written.

[[read out]] `VGA.DRV` export 501 (seg9 `12ec`), the set from `13ff`: `DeviceBitmapBits` hands it the bitmap's rectangle and the same to clip to, so the clip flag (20h) is clear (`1325`-`134a`); the first line `Y + cy - 1 - start` (`13e6`-`13f6`), the count kept for the get only. A table of up to 256 colours, `biClrUsed` or 256 (`1449`-`1459`), each matched (`2915`) and for a monochrome bitmap its flag 10h made all or nothing (`1dd9`). Then a pair at a time (`14fe`): a run (`1556`), of four bits drawn in its high digit and then its low over every second pixel by a mask of AAh or 55h from the run's column (`1966`-`19e6`); nought and nought, the first column and a line up (`1586`); nought and 1, the end (`1592`, answering 1 at `15ac`); nought and 2, across and up by the next two bytes (`1573`); else that many pixels as they are (`151d`), of four bits by a digit's flag at `[bp-2Ch]` (`1d7e`, `1d66`), and a byte more where the next is at an odd offset (`154b`). Each pixel's byte the row's start, `y` by the planes' bytes, and the eighth of `x` (`1ad8`), each plane's row the width's bytes on (`1a6a`, `19f6`). Nothing ends the walk but the end's escape. The get (`15b2`) encodes the bitmap as runs and is not followed here.

[[read out]] `SVGA256.DRV` seg9 `15ac`: a compression past 2 answers -1 (`169d`), a monochrome bitmap -1 (`16d9`), any other not of a byte a pixel nought. The table from `biClrUsed` words or as many as the bits give, the low byte of each, and flag 8 where the sum of each low byte less its place and each high byte is not nought (`176f`-`179e`): an eight-bit DIB goes through the table only with it (`157c`, `159c`). With no clipping rectangle -- `DeviceBitmapBits` hands none (`0041`-`0051`) -- the DIB's own rectangle at `X, Y` (`17e3`-`17fc`), its first line `Y` plus its height less one (`1691`-`1697`). The pairs as the VGA's (`15c0`-`1661`), an end of line or a delta up ending the walk at a line above the rectangle's top (`164a`-`1650`, `1626`-`1631`), the padding by the offset (`15f3`); each byte at the row's start and `x`, a row the width's bytes on (`1738`-`1763`, `1811`). The get (`1a38`) encodes and is not followed here.

## Callers

[[read out]] None imports it (`kb/data/gdi-callers.json`).

## Implementation

`crates/winbox-win16/src/gdi/driver_bitmap.rs` on the VGA, the Super VGA and the EGA, as read out; a compressed DIB set as export 501 sets it (`rleSet`, `rle_set`, walking as `crates/winbox-win16/src/gdi/rle_runs.rs` walk), and got answers nought. [[probe:gdidmdrw]] agrees in both engines on the three, and [[probe:gdidmrle]] on the VGA.

On the 256-colour display its own (`crates/winbox-win16/src/gdi/driver_vga256.rs`), [[probe:gdidmdrw]] agreeing. A null translation table is read as noughts. [[probe:gdidmdib]], a translation table of its own, agrees in both engines: a get of 1, 4, 8 and 24 bits from both formats, and a set of 24 bits through `DeviceColorMatch`. A compressed DIB set by `15ac`'s walk (`rleSet`, `rle_set`), [[probe:gdidmrle]] agreeing in both engines.

## Not yet done

- A compressed DIB got, `BI_RLE4` or `BI_RLE8`, which WinBox answers nought: the drivers encode the bitmap as runs (`VGA.DRV` seg9 `15b2`-`1852`, `SVGA256.DRV` `1a38`-`1c33`), not read out to the end, and no probe asks.
- A compressed DIB set on the Hercules, which WinBox answers nought: its driver's routine is not read out.
- [[probe:gdidmdrw]]'s records on the 256-colour display of a DIB got of 1, 4 or 24 bits, and of one set of 24: it hands a null translation table, which Windows would fault on and DOSBox reads as its real-mode vectors (known gaps). [[probe:gdidmdib]] records the same paths with a table of its own.
