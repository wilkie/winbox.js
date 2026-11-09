---
kind: function
module: GDI
name: DMColorInfo
ordinal: 202
summary: A colour made physical for a memory bitmap, or a physical colour made logical, by the display driver's ColorInfo -- for a printer's driver.
versions:
  '3.1': partial
probes: [gdidm, gdidmdrw]
records: [colorinfo, colorback, notbitmap]
source: crates/winbox-win16/src/gdi/driver_helpers.rs
topics: [gdi-internals, printer-drivers, brush-dithering]
---

## Observed behaviour

[[probe:gdidm]] calls it, by number, on a `BITMAP` laid out in the probe's own memory, of four planes and of one, on the VGA.

- [[measured]] With a buffer, the colour's physical colour is written there: red, green and blue of the colour the VGA draws it as, then a top byte of its index and two flags -- 10h for a colour a monochrome bitmap takes as white, 20h for black and white. White is `3FFFFFFF`, black `20000000`, red `090000FF`, green `1A00FF00`, light grey `18C0C0C0`. The same is written for either bitmap.
- [[measured]] The answer is the physical colour's red, green and blue for the bitmap of four planes -- the colour the VGA has, `0000FFFF` for `000080C0` -- and white `00FFFFFF` or black for the monochrome one, by the flag.
- [[measured]] The colour's top byte is not looked at: `PALETTEINDEX(5)` is black, `PALETTERGB` the colour.
- [[measured]] With no buffer, the colour given is taken as a physical one and answered the same way: its low three bytes for four planes, white or black by its flag for one.
- [[measured]] On the Hercules ([[probe:gdidmdrw]]) a colour is white where its red, green and blue come to 17Eh or more: `00808080` is white and `000000FF` black, and the answer is white or black whatever the bitmap. The physical colour is each of red, green and blue FFh at 80h or more and nought below, and a top byte of a bit for each so made, 10h for white and 20h for black and for white with all three: red `010000FF`, yellow `1300FFFF`, `00808080` `37FFFFFF`.
- [[measured]] For a device whose first word is not nought, or one marked `DI`, the answer's high word is 4, `ColorInfo`'s offset in a driver's table.

- [[measured]] On the 256-colour display the physical colour is the nearest of the palette's twenty static colours, its index in the low byte, then a flag -- 80h matched exactly, 1 white on a monochrome bitmap, 2 black -- nought and FFh: black `FF008200`, red `FF0080F9`, `00C0C0C0` `FF008107`. The answer is the static's colour, whatever the bitmap.

## Inside Windows

[[read out]] `GDI.EXE` seg13 `014f`: `mov cx,040Ah` and a jump to [[fn:GDI.Brute]], which calls the display driver's `ColorInfo` for a memory bitmap. `VGA.DRV`'s (seg1 `18f8`) matches the colour with the routine at `1956` that its `RealizeObject` shares ([[topic:brush-dithering]]) and writes the result; then it looks at the device's word 8, the planes and the bits a pixel: 104h answers the physical colour with its top byte cleared, anything else white or black by bit 4 of the top byte (`191d`-`1930`). The physical colour is the index's red, green and blue from the table at seg1 `003c` and the flags from `002c` (`19f4`-`1a0b`).

[[read out]] `HERCULES.DRV` seg1 `2d44`, into `2bb6`: the sum of the three bytes against 17Eh, then each byte shifted right by 8 so that its sign fills it, its bit 7 kept as the flag; the answer from bit 4 of the top byte, or of the colour given with no buffer.

[[read out]] `SVGA256.DRV` seg1 `1ae0`: with a buffer the colour made physical by `0990` -- the sum of the squares of the differences from each static (data `0022`), the first of any alike, an exact one at once with 8000h, the index and flag from data `005e` -- unless its top byte is negative or 1; its low word and FF00h written; the answer the static's three bytes. With none, an index between the statics is answered as it is with FF00h above, a static's colour from the palette's table at `0384`.

## Callers

[[read out]] `PSCRIPT.DRV` imports it by ordinal. No program of the corpus does.

## Implementation

As the VGA's driver has it (`crates/winbox-win16/src/gdi/driver_helpers.rs`): the match is `crates/winbox-raster/src/colour_match.rs`'s, the colours and flags named constants from the read-out. On the Super VGA and the EGA as on the VGA -- [[probe:gdidm]] recorded on each gives every record the VGA's but the EGA's ninth colour, 404040h, which is not white on a monochrome bitmap. On the Hercules as its own driver has it (`crates/winbox-win16/src/gdi/driver_hercules.rs`), [[probe:gdidmdrw]] agreeing. On the 256-colour display its own (`crates/winbox-win16/src/gdi/driver_vga256.rs`), [[probe:gdidmdrw]] agreeing. [[probe:gdidm]] agrees.

**Recommendation:** done for the VGA, the Super VGA, the EGA, the Hercules and the 256-colour display.

## Not yet done

- On the 256-colour display, a palette's index (a top byte of 1), kept as it is (`1afe`): no probe asks one.
