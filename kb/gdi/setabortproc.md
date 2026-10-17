---
kind: function
module: GDI
name: SetAbortProc
ordinal: 381
summary: Gives a printer's device context the procedure GDI asks whether to go on printing; answers the procedure's segment.
versions:
  '3.1': exact
probes: [printing, prspool, prabort]
source: src/win16/gdi/printing.ts
topics: [printing, printer-drivers]
---

## Observed behaviour

[[measured]] [[probe:printing]]: the answer is above nought. [[probe:prspool]]: it is the procedure's segment, and [[fn:GDI.QueryAbort]] then answers what the procedure answers.

[[measured]] [[probe:prabort]]: the procedure is called with the DC and nought, once for each buffer the spooler writes. A procedure that answers nought stops the document.

## Inside Windows

[[read out]] `GDI.EXE` seg31 `007c`: the escape `SETABORTPROC` (9), which is GDI's own (seg7 `00fb`). The procedure is kept on the context (+A6h), and the answer is its segment. [[fn:GDI.StartDoc]] gives the driver the DC by `SETABORTPROC` too, so the driver can ask [[fn:GDI.QueryAbort]] through GDI.

## Implementation

`src/win16/gdi/printing.ts` and `printer-driver.ts`; in Rust, `crates/winbox-win16/src/gdi/printing.rs` and `printer_driver.rs`.
