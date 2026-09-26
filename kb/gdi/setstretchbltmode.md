---
kind: function
module: GDI
name: SetStretchBltMode
ordinal: 7
summary: Sets how StretchBlt shrinks into a device context, and answers the mode before.
versions:
  '3.1': exact
probes: [stretch]
source: src/win16/gdi/StretchBlt.ts
---

## Observed behaviour

- [[measured]] A new device context's mode is `BLACKONWHITE`, 1.
- [[measured]] Any value is kept, and answered by [[fn:GDI.GetStretchBltMode]]: 0, 4 and 5 as well as 1 and 3.
- [[read out]] [[fn:GDI.StretchBlt]] takes a mode outside 1 to 3 as `WHITEONBLACK`, 2 (`GDI.EXE` seg32 `04e1`).

[[probe:stretch]] records six answers on the VGA, and winbox.js agrees with all of them. What each mode does is under [[fn:GDI.StretchBlt]].
