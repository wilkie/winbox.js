---
kind: function
module: GDI
name: DMStrBlt
ordinal: 211
summary: DMExtTextOut with no widths, no opaque rectangle and no options -- a printer's driver's plain text on a memory bitmap.
versions:
  '3.1': partial
probes: [gdidmdrw]
records: [strblt]
source: crates/winbox-win16/src/gdi/driver_helpers.rs
topics: [gdi-internals, printer-drivers]
---

## Observed behaviour

- [[read out]] `DMStrBlt(lpDestDev, DestX, DestY, lpClipRect, lpString, wCount, lpFontInfo, lpDrawMode, lpTextXForm)` takes 30 bytes and answers what [[fn:GDI.DMExtTextOut]] answers for the same arguments.
- [[measured]] [[probe:gdidmdrw]]: a string drawn as `DMExtTextOut` draws it, and a negative count's extent, on the VGA, the Super VGA and the EGA.

## Inside Windows

[[read out]] `GDI.EXE` seg13 `00df`: it pushes its own fifteen words again and then five words of nought -- the character widths, the opaque rectangle and the options -- and calls `DMExtTextOut` (seg13 `0000`), returning by `retf 1Eh`. The display drivers' own `StrBlt` is the same push in front of their `ExtTextOut` ([[topic:display-drivers]]).

## Callers

[[read out]] `PSCRIPT.DRV` imports it by ordinal. No program of the corpus does.

## Implementation

`DMExtTextOut` with nought for the last three, in both engines (`crates/winbox-win16/src/gdi/driver_helpers.rs`). [[probe:gdidmdrw]] agrees.

On the 256-colour display its own (`crates/winbox-win16/src/gdi/driver_vga256.rs`), [[probe:gdidmdrw]] agreeing.

## Not yet done

- As [[fn:GDI.DMExtTextOut]]'s.
