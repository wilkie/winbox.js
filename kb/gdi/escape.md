---
kind: function
module: GDI
name: Escape
ordinal: 38
summary: Asks a device's driver to do one of its own functions, by number; a printer's go to its driver's Control, but for those GDI keeps.
versions:
  '3.1': partial
probes: [pric, escapes, printing, prdoc, prabort]
source: src/win16/gdi/Escape.ts
topics: [printer-drivers]
---

## Observed behaviour

- [[measured]] [[probe:escapes]]: the display's escapes; see [[topic:display-drivers]].
- [[measured]] [[probe:pric]], the PostScript driver: `QUERYESCSUPPORT` answers 1 for escapes 1–3, 6, 8–14, 17, 19–23, 29–38, 128, 256, 258, 513, 3072, 4096–4102, 4104, 4105 and 4107–4109, nought for the rest asked; `GETPHYSPAGESIZE` 2550 by 3300, `GETPRINTINGOFFSET` 75, 33, `GETSCALINGFACTOR` 0, 0; `GETTECHNOLOGY` writes "PostScript"; `GETSETPRINTORIENT` with no input answers 1; an escape the driver has not got nought.
- [[measured]] `SETABORTPROC` answers the procedure's segment.
- [[measured]] [[probe:prdoc]]: the PostScript driver's `NEWFRAME` answers its job's handle. [[probe:prabort]]: a document printed by `STARTDOC`, `NEWFRAME` and `ENDDOC` asks the abort procedure as it goes, as one printed by the calls does.

## Inside Windows

[[read out]] `GDI.EXE` seg7 `0042`-`0526`: `SETABORTPROC` kept by GDI on the context, its answer the segment (`00fb`); `STARTDOC` preceded by a `SETABORTPROC` to the driver whose input is the context (`00c1`); 0Fh answers nought; 100h to BFFh GDI's own first; every other escape the driver's `Control`, with the `PDEVICE`, the escape, the input and the output — the count is not passed (`04f0`). See [[topic:printer-drivers]].

## Implementation

`driverEscape` in `src/win16/gdi/printer-driver.ts` and `driver_escape` in `crates/winbox-win16/src/gdi/printer_driver.rs`, for a driver from the drive. `NEXTBAND` marks the context as banding, which [[fn:GDI.EndPage]] reads. Not followed: GDI's own escapes 100h to BFFh, and the metafile GDI keeps for a banding driver's bands.
