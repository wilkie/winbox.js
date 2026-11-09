---
kind: function
module: GDI
name: DMEnumDFonts
ordinal: 206
summary: GDI's walk of a memory bitmap's fonts for a printer's driver -- there are none -- answering 1.
versions:
  '3.1': exact
probes: [gdicopy]
records: [enumdfonts]
topics: [printer-drivers, gdi-internals]
---

## Observed behaviour

- [[measured]] 1, asked by a program with nothing to walk ([[probe:gdicopy]]).

## Inside Windows

[[read out]] `GDI.EXE` seg13 `0163`: `mov ax,1` and `retf 10h`. Its neighbours, the other `DM` exports a driver hands its work on a memory bitmap to (`DMBitBlt`, `DMOutput`, `DMPixel`, `DMStrBlt` and the rest), each load CX with a code and go to [[fn:GDI.Brute]] (`0171`), which calls the display driver's routine of that name on the bitmap; this one walks nothing, a bitmap having no fonts of its own.

## Implementation

As read out. [[probe:gdicopy]] agrees in both.

## Not yet done

- The other `DM` exports' drawing on a memory bitmap ([[topic:gdi-internals]]).
