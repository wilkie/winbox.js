---
kind: function
module: GDI
name: DMColorInfo
ordinal: 202
summary: A colour made physical for a memory bitmap, or a physical colour made logical, by the display driver's ColorInfo -- for a printer's driver.
versions:
  '3.1': partial
probes: [gdidm]
records: [colorinfo, colorback, notbitmap]
source: src/win16/gdi/driver-helpers.ts
topics: [gdi-internals, printer-drivers, brush-dithering]
---

## Observed behaviour

[[probe:gdidm]] calls it, by number, on a `BITMAP` laid out in the probe's own memory, of four planes and of one, on the VGA.

- [[measured]] With a buffer, the colour's physical colour is written there: red, green and blue of the colour the VGA draws it as, then a top byte of its index and two flags -- 10h for a colour a monochrome bitmap takes as white, 20h for black and white. White is `3FFFFFFF`, black `20000000`, red `090000FF`, green `1A00FF00`, light grey `18C0C0C0`. The same is written for either bitmap.
- [[measured]] The answer is the physical colour's red, green and blue for the bitmap of four planes -- the colour the VGA has, `0000FFFF` for `000080C0` -- and white `00FFFFFF` or black for the monochrome one, by the flag.
- [[measured]] The colour's top byte is not looked at: `PALETTEINDEX(5)` is black, `PALETTERGB` the colour.
- [[measured]] With no buffer, the colour given is taken as a physical one and answered the same way: its low three bytes for four planes, white or black by its flag for one.
- [[measured]] For a device whose first word is not nought, or one marked `DI`, the answer's high word is 4, `ColorInfo`'s offset in a driver's table.

## Inside Windows

[[read out]] `GDI.EXE` seg13 `014f`: `mov cx,040Ah` and a jump to [[fn:GDI.Brute]], which calls the display driver's `ColorInfo` for a memory bitmap. `VGA.DRV`'s (seg1 `18f8`) matches the colour with the routine at `1956` that its `RealizeObject` shares ([[topic:brush-dithering]]) and writes the result; then it looks at the device's word 8, the planes and the bits a pixel: 104h answers the physical colour with its top byte cleared, anything else white or black by bit 4 of the top byte (`191d`-`1930`). The physical colour is the index's red, green and blue from the table at seg1 `003c` and the flags from `002c` (`19f4`-`1a0b`).

## Callers

[[read out]] `PSCRIPT.DRV` imports it by ordinal. No program of the corpus does.

## Implementation

In both engines as the VGA's driver has it (`driver-helpers.ts`, `driver_helpers.rs`): the match is `colour-match.ts`'s, the colours and flags named constants from the read-out. On the Super VGA and the EGA as on the VGA -- [[probe:gdidm]] recorded on each gives every record the VGA's but the EGA's ninth colour, 404040h, which is not white on a monochrome bitmap. On the Hercules and the 256-colour display a memory bitmap answers nought. [[probe:gdidm]] agrees in both engines.

**Recommendation:** done for the VGA, the Super VGA and the EGA.

## Not yet done

- The Hercules's and the 256-colour display's own, whose physical colours are not the VGA's ([[topic:gdi-internals]]).
