---
kind: function
module: GDI
name: DMEnumObj
ordinal: 207
summary: The display's pens or brushes, each handed to a driver's procedure, as the display driver's EnumObj walks them for a memory bitmap.
versions:
  '3.1': partial
probes: [gdidm, gdidmpx]
records: [enumobj, stopped, notbitmap]
source: crates/winbox-win16/src/gdi/driver_helpers.rs
topics: [gdi-internals, printer-drivers]
---

## Observed behaviour

[[probe:gdidm]] walks them for a `BITMAP` of four planes and of one, on the VGA.

- [[measured]] `DMEnumObj(lpDestDev, wStyle, lpCallbackFunc, lpClientData)` hands the procedure each object and the data, a far pointer: for `OBJ_PEN` the 80 pens and for `OBJ_BRUSH` the 221 brushes [[fn:GDI.EnumObjects]] hands a program, in the same order, whatever the bitmap.
- [[measured]] The answer is the procedure's last; a procedure answering nought stops the walk, and nought is answered. Any other style hands nothing and answers 1.
- [[measured]] [[probe:gdidmpx]] on the Hercules: the VGA's pens and brushes in its two colours, white first -- ten pens, and 137 brushes, the 125 solid ones of five levels each and the six hatches in white and black.
- [[measured]] On the 256-colour display: 100 pens, the five styles in each of twenty colours, and twenty solid brushes, no hatched one; the colours FF0000h's red first -- the last seven of the driver's twenty -- then black and the first thirteen.

## Inside Windows

[[read out]] `GDI.EXE` seg13 `0169`: `mov cx,180Bh` and a jump to [[fn:GDI.Brute]]. `VGA.DRV`'s `EnumObj` (seg5 `01d2`) lays each object on its own stack at its frame's -10h and calls the procedure (`0201`): the pens through `027e`, sixteen colours from the table at seg5 `0040`, last first, for each style; the solid brushes from levels at `022c`, red slowest; the hatched through `027e` again. The device is not looked at. So the object is 16h bytes up the stack from the procedure's entry for a pen and a hatched brush, 14h for a solid one.

## Callers

[[read out]] None imports it (`kb/data/gdi-callers.json`).

[[read out]] `HERCULES.DRV` seg3 `0178`: the VGA's routine, its two colours a table at seg3 `0000` (black, then white, handed white first, `0224`-`0244`), its levels at `01d3`; the objects laid where the VGA lays them.

[[read out]] `SVGA256.DRV` seg4 `0086`: pens of styles nought to four (`00cc`-`00e3`) and brushes of style nought, hatch nought (`00ea`), each colour from the driver's data segment's table at 22h of three bytes, red, green and blue: the seven from 13 on, then the thirteen from nought (`00fa`-`0149`). Each object 1Ch up the stack from the procedure's entry, the routine pushing ES before its arguments (`00b7`); any other style answers 1.

## Implementation

As the VGA's driver has it, the objects `EnumObjects`'s, laid where the VGA lays them. On the Super VGA and the EGA as on the VGA -- [[probe:gdidm]] recorded on each gives every record the VGA's but the EGA's ninth colour, 404040h, which is not white on a monochrome bitmap. [[probe:gdidm]] agrees.

**Recommendation:** done for the VGA, the Super VGA, the EGA, the Hercules and the 256-colour display.

On the Hercules the VGA's routine, in the display's two colours; on the 256-colour display its own (`enumerated_colours` in `crates/winbox-win16/src/gdi/driver_vga256.rs`). [[probe:gdidmpx]] agrees on all three displays.
