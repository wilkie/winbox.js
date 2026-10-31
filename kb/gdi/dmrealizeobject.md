---
kind: function
module: GDI
name: DMRealizeObject
ordinal: 210
summary: A pen, brush or font realized for a memory bitmap by the display driver's RealizeObject, for a printer's driver -- the VGA's 6-byte pens and 54-byte brushes.
versions:
  '3.1': partial
probes: [gdidmdrw]
records: [size, pen, brush, font]
source: src/win16/gdi/driver-bitmap.ts
topics: [gdi-internals, printer-drivers, brush-dithering]
---

## Observed behaviour

- [[read out]] `DMRealizeObject(lpDestDev, wStyle, lpInObj, lpOutObj, lpTextXForm)` takes 18 bytes of arguments, as the display driver's `RealizeObject` does. For a device that is not a memory bitmap -- its first word not nought -- nothing is drawn and the answer is GDI's data segment in AX and 24h in DX.
- [[measured]] [[probe:gdidmdrw]]: with no object to fill the answer is the size -- 6 for a pen, 54 for a brush, nought for a font. A style below nought answers 1; past 3, nought. Style nought answers 11067 on the VGA and 11039 on the EGA, a word of the driver's code.
- [[measured]] A pen is its physical colour, then its style: solid for a pen wider than a pixel, or of a style past `PS_NULL`. A null pen's colour is not matched: nought, then 24h.
- [[measured]] A brush: four planes of eight rows at 00h, a byte a row, a plane a bit of the colour's index; the monochrome plane at 20h; the style at 28h -- 0 solid, 1 hollow, 2 hatched, 3 a colour pattern, 4 a monochrome one -- and the brush's flags at 2Ah.
- [[measured]] A solid brush of a colour the device has: each plane all set or all clear, flagged with its physical colour's top byte and 80h. Of one it lacks: the planes the VGA's pattern of it, flagged with the nearest colour's top byte. White is FFh in every byte, flagged FFh; black nought, flagged E0h. The monochrome plane is the colour's pattern on a monochrome bitmap: red is two diagonal pixels in eight, grey a checkerboard.
- [[measured]] A hatched brush: each plane, and the monochrome one, the hatch where the brush's colour and the background colour differ in it, else the bit they share; at 2Eh the hatch's background set. The background colour comes after the logical brush, at 8. A hatch past 5 is a solid brush.
- [[measured]] A pattern brush, its logical colour a far pointer to a bitmap: the first byte of its first eight rows, a plane each for four planes and the monochrome plane made from each pixel's colour; a monochrome bitmap's rows in every plane. Bytes 2Bh and 2Ch are FFh.
- [[measured]] The `TEXTXFORM` pointer is the brush's origin: x in its low word turns each byte right, y in its high word turns the rows down. A brush of one colour has only its monochrome plane turned.
- [[measured]] A font answers nought and fills nothing.
- [[measured]] The Super VGA's driver gives every record the VGA's. The EGA's differs only by its colours: its ninth is 404040h, not white on a monochrome bitmap, so light grey is a pattern of grey and white; and it has no case for 10E0E0E0h.

## Inside Windows

[[read out]] `GDI.EXE` seg13 `015e`: `mov cx,240Dh`, CL the words `Brute` moves and CH the offset 24h of `RealizeObject` in the display driver's table. It is one of the five-byte entries of `GDI.EXE` seg13 that load CX and jump to [[fn:GDI.Brute]] (seg13 `0171`): for a memory bitmap, the display driver's own routine of the same offset is called with the same arguments; for any other device nothing is called and the answer is GDI's data segment in AX with the routine's offset in DX.

[[read out]] `VGA.DRV` seg1 `286e`: a negative style answers 1; the style less one indexes a table of routines at `2bd6` and of sizes at `2bdc` -- `6`, `36h`, `0` -- so style nought reads the word before the sizes, `2b3b`, the font's routine. The routines: the pen `28b6`, the brush `28db`, the font `2b3b` (a bare `ret`). The brush's own routines by its style at `2b9e`: solid `292a`, hollow `2b36`, hatched `2ab9`, pattern `2a20`. Solid: white and black at `2930`-`2942`; the special colour 10E0E0E0h at `2957`; the colour matched (`1956`), an exact one at `2992`, any other dithered (`24a1`); the monochrome plane from `210e`. Hatched: the colour's and the background's flags, plane by plane (`2b16`), the hatches at `2ba6`. The turning: bytes at `2b3c`, rows at `2b63`.

## Callers

[[read out]] `PSCRIPT.DRV` imports it by ordinal. No program of the corpus does.

## Implementation

`driver-bitmap.ts` and `driver_bitmap.rs` on the VGA, the Super VGA and the EGA: each object laid out from named constants of the read-out; the colour matched by `colour-match.ts` and dithered by `dither.ts`, as the display's brushes are. [[probe:gdidmdrw]] agrees in both engines on the three.

## Not yet done

- The Hercules's (a 22-byte brush) and the 256-colour display's own `RealizeObject`, which answer nought here (known gaps of [[probe:gdidmdrw]]).
