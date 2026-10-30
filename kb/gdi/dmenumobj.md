---
kind: function
module: GDI
name: DMEnumObj
ordinal: 207
summary: The display's pens or brushes, each handed to a driver's procedure, as the display driver's EnumObj walks them for a memory bitmap.
versions:
  '3.1': partial
probes: [gdidm]
records: [enumobj, stopped, notbitmap]
source: src/win16/gdi/driver-helpers.ts
topics: [gdi-internals, printer-drivers]
---

## Observed behaviour

[[probe:gdidm]] walks them for a `BITMAP` of four planes and of one, on the VGA.

- [[measured]] `DMEnumObj(lpDestDev, wStyle, lpCallbackFunc, lpClientData)` hands the procedure each object and the data, a far pointer: for `OBJ_PEN` the 80 pens and for `OBJ_BRUSH` the 221 brushes [[fn:GDI.EnumObjects]] hands a program, in the same order, whatever the bitmap.
- [[measured]] The answer is the procedure's last; a procedure answering nought stops the walk, and nought is answered. Any other style hands nothing and answers 1.

## Inside Windows

[[read out]] `GDI.EXE` seg13 `0169`: `mov cx,180Bh` and a jump to [[fn:GDI.Brute]]. `VGA.DRV`'s `EnumObj` (seg5 `01d2`) lays each object on its own stack at its frame's -10h and calls the procedure (`0201`): the pens through `027e`, sixteen colours from the table at seg5 `0040`, last first, for each style; the solid brushes from levels at `022c`, red slowest; the hatched through `027e` again. The device is not looked at. So the object is 16h bytes up the stack from the procedure's entry for a pen and a hatched brush, 14h for a solid one.

## Callers

[[read out]] None imports it (`kb/data/gdi-callers.json`).

## Implementation

In both engines as the VGA's driver has it, the objects `EnumObjects`'s, laid where the VGA lays them. On a display whose driver is not `VGA.DRV` a memory bitmap answers nought. [[probe:gdidm]] agrees in both.

**Recommendation:** done for the VGA.
