---
kind: function
module: GDI
name: EndDoc
ordinal: 378
summary: Ends a printed document; on a Windows driver's context, the driver's Control with ENDDOC, which closes the driver's job.
versions:
  '3.1': exact
probes: [printing, prdoc, prabort]
source: src/win16/gdi/printing.ts
topics: [printing, printer-drivers]
---

## Observed behaviour

[[measured]] [[probe:printing]]: 1, even before [[fn:GDI.StartDoc]] and after [[fn:GDI.AbortDoc]]. [[probe:prdoc]]: the file is complete once `EndDoc` has answered. [[probe:prabort]]: by the escape `ENDDOC`, the abort procedure has been asked 46 times over the document.

## Inside Windows

[[read out]] `GDI.EXE` seg31 `002e`, then `0234` for a Windows driver's DC: the driver's `Control` with `ENDDOC`. The PostScript driver writes its trailer and closes its job ([[fn:GDI.CloseJob]]).

## Implementation

`src/win16/gdi/printing.ts` and `printer-driver.ts`; in Rust, `crates/winbox-win16/src/gdi/printing.rs` and `printer_driver.rs`.
