---
kind: function
module: GDI
name: IsDCCurrentPalette
ordinal: 412
summary: Answers whether a device context's palette is GDI's foreground palette.
versions:
  '3.1': exact
probes: [dcinner]
topics: [palettes]
---

## Observed behaviour

- [[measured]] Nought for a new memory context: no palette is GDI's foreground palette until one is selected for it ([[probe:dcinner]]).
- [[measured]] 1 for any context whose palette is the foreground palette, whichever context it was selected into for the foreground.
- [[measured]] DX on return is not the call's.

## Inside Windows

[[read out]] `GDI.EXE` seg22 `0b0c` compares the context's palette at 1Ah with `[480h]`.

## Implementation

In both engines as read out. [[probe:dcinner]] agrees in both, on the VGA and the 256-colour display.
