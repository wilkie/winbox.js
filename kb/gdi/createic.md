---
kind: function
module: GDI
name: CreateIC
ordinal: 153
summary: Makes an information context for a device: as CreateDC, for asking about the device without drawing on it, its driver enabled with the IC's styles.
versions:
  '3.1': partial
probes: [pric, prdlg]
source: src/win16/gdi/CreateDC.ts
topics: [printer-drivers]
---

## Observed behaviour

- [[measured]] [[probe:pric]]: `CreateIC` of `pscript`, the Apple LaserWriter Plus and `LPT1:` gave an IC; the same again gave another, and on `LPT2:` another.
- [[measured]] COMMDLG's Print dialog makes an IC of the printer as it starts and asks it `QUERYESCSUPPORT` of `SETCOPYCOUNT` ([[probe:prdlg]]); with no IC the dialog fails with `PDERR_CREATEICFAILURE`.

## Nuances

- [[read out]] The driver's `Enable` is given a style of 8001h for the `GDIINFO` and 8000h for the `PDEVICE`, where a DC's are 1 and nought.
- [[read out]] An IC may be made on the null port.

## Inside Windows

[[read out]] `GDI.EXE` seg1 `47d8`, into seg1 `0078` with a flag of 80h. See [[topic:printer-drivers]].

## Implementation

As [[fn:GDI.CreateDC]]'s.
