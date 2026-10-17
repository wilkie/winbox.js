---
kind: function
module: GDI
name: StartPage
ordinal: 379
summary: Starts a page of a printed document; on a Windows driver's context it only marks the context and answers 1.
versions:
  '3.1': exact
probes: [printing, prdoc, prabort]
source: src/win16/gdi/printing.ts
topics: [printing, printer-drivers]
---

## Observed behaviour

[[measured]] [[probe:printing]]: 1, even before [[fn:GDI.StartDoc]]. [[probe:prabort]]: 1 after a `StartDoc` the abort procedure stopped.

## Inside Windows

[[read out]] `GDI.EXE` seg31 `0068`, then `02ae` for a Windows driver's DC. The DC is marked and the answer is 1. Nothing reaches the driver. [[fn:GDI.EndPage]] reads the mark.

## Implementation

`src/win16/gdi/printing.ts` and `printer-driver.ts`; in Rust, `crates/winbox-win16/src/gdi/printing.rs` and `printer_driver.rs`.
