---
kind: function
module: GDI
name: AbortDoc
ordinal: 382
summary: Drops a printed document; on a Windows driver's context, the escape ABORTDOC.
versions:
  '3.1': exact
probes: [printing, prabort]
source: src/win16/gdi/printing.ts
topics: [printing, printer-drivers]
---

## Observed behaviour

[[measured]] [[probe:prabort]]: a document dropped partway answers 1. The PostScript driver had by then written 11365 bytes to its file, and they stay there; the driver does not delete its job for `ABORTDOC`. The abort procedure had been asked 45 times. Afterwards [[fn:GDI.EndPage]] answers -1 and [[fn:GDI.EndDoc]] 1.

## Inside Windows

[[read out]] `GDI.EXE` seg31 `0000`: the escape `ABORTDOC` (2) through [[fn:GDI.Escape]], which goes to the driver's `Control`.

## Implementation

`src/win16/gdi/printing.ts` and `printer-driver.ts`; in Rust, `crates/winbox-win16/src/gdi/printing.rs` and `printer_driver.rs`.
