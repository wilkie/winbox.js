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
source: crates/winbox-win16/src/gdi/driver_helpers.rs
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

[[read out]] `HERCULES.DRV` seg1 `2b08`: a pen of 6 bytes, a brush of 16h, a font of nought, style nought the word before the sizes, 2CC1h. The pen as the VGA's, its colour the Hercules's ([[fn:GDI.DMColorInfo]]). A brush (`2b73`) is eight rows of its pattern, its style word at 8, its flags at 0Ah and eight more rows at 0Eh, turned to its origin unless hollow (`2b8e`): solid (`2bf0`) a dither of the colour's grey -- the three bytes a third each taken to a level of 0 to 64, a pattern of four rows for each group of four levels laid twice (seg1 `307f`), a pixel more for each level past the group's start (`305f`), the greys at 16, 32 and 48 patterns of their own (`2c34`), black and white flagged 80h -- with the colour's white flag; hatched (`2c68`) the hatch's rows at 0Eh and the pattern the hatch against the background where one is white and the other not, else the background; a pattern (`2c3c`) its bitmap's first byte of eight rows, twice, FFFFh at 0Bh; hollow E0h. [[probe:gdidmdrw]] records each on the Hercules.

[[read out]] `SVGA256.DRV` seg1 `05b4`: sizes 6, 53h and nought at `098a`, style nought `094b`, the font's routine. A pen (`05fb`) its physical colour -- left as it is with a top byte of FFh -- and style as the VGA's. A brush (`062a`) is 8 by 8 bytes of indices, a monochrome plane at 40h, its style at 48h, flags at 4Ah and the hatch's rows at 4Bh: solid (`0666`) a colour flagged in its top byte but 10h taken as a physical one, black and white every byte nought or FFh flagged 0Ah, an exact static every byte its index flagged 8, anything else dithered (`1e02`), the monochrome plane from its grey `((red + blue) / 2 + green) / 2` (`0406`, a pattern of four rows for each four levels of 64, a pixel or two more for the rest, the levels 16, 32 and 48 rows of their own at `0707`); hatched (`0791`) the colour where the hatch is set and the background where not, the monochrome plane each byte's flag of white (table at data `0784`); a pattern (`0729`) its bitmap's first eight bytes of eight rows, or of a monochrome bitmap its first byte of each row as the monochrome plane alone, flagged 4; hollow flagged 0Ah. Unless flagged 0Ah each row is turned right by the origin's x and the rows down by its y, the 64 bytes not for one colour (`0833`, `08ab`).

## Callers

[[read out]] `PSCRIPT.DRV` imports it by ordinal. No program of the corpus does.

## Implementation

`crates/winbox-win16/src/gdi/driver_bitmap.rs` on the VGA, the Super VGA and the EGA: each object laid out from named constants of the read-out; the colour matched by `colour-match.ts` and dithered by `dither.ts`, as the display's brushes are. [[probe:gdidmdrw]] agrees in both engines on the three. On the Hercules its own (`crates/winbox-win16/src/gdi/driver_hercules.rs`), [[probe:gdidmdrw]] agreeing. On the 256-colour display its own (`crates/winbox-win16/src/gdi/driver_vga256.rs`), [[probe:gdidmdrw]] agreeing. The solid brush's dither is the one its brushes have on the screen ([[topic:brush-dithering]], `dither.ts`), which [[probe:gdidmdrw]] finds alike byte for byte.

## Not yet done

- The 256-colour display's monochrome plane of a solid brush (seg1 `0406`), read out and laid down, which shows only drawn on a monochrome bitmap: no probe records it.
