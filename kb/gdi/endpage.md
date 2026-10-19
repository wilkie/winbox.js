---
kind: function
module: GDI
name: EndPage
ordinal: 380
summary: Ends a page of a printed document — the escape NEWFRAME's answer on a Windows driver's context, -1 where no page was started.
versions:
  '3.1': exact
probes: [printing, prdoc, prabort, prband]
source: src/win16/gdi/printing.ts
topics: [printing, printer-drivers]
---

## Observed behaviour

[[measured]] [[probe:printing]]: -1 before [[fn:GDI.StartDoc]] and after [[fn:GDI.AbortDoc]].

[[measured]] [[probe:prdoc]]: the PostScript driver's `NEWFRAME` answers its job's handle. Shifted back left, the handle names a block of 352 bytes, a job of GDI's spooler ([[fn:GDI.OpenJob]]).

[[measured]] [[probe:prabort]]: -2 where the abort procedure stopped the document.

## Inside Windows

[[read out]] `GDI.EXE` seg31 `0017`, then `02e0` for a Windows driver's DC. It answers -1 on a DC [[fn:GDI.StartPage]] has not marked. Otherwise the answer is the escape `NEWFRAME`'s, through [[fn:GDI.Escape]]. Where the escape `NEXTBAND` has marked the DC as banding (seg7 `0137`), the answer is 1 instead. Both marks are cleared. The marks are bits of the DC's byte 0Bh, which [[fn:GDI.SaveDC]] saves and [[fn:GDI.RestoreDC]] puts back with the rest of the DC (seg1 `0a84`, `06e2`).

On the context of a driver that bands, `NEWFRAME` plays the page GDI kept, band by band ([[topic:printer-drivers]]). [[measured]] [[probe:prband]]: `EndPage` on such a context answered 1, and the driver was asked for its bands and given the page's figures in each.

## Implementation

`src/win16/gdi/printing.ts` and `printer-driver.ts`; in Rust, `crates/winbox-win16/src/gdi/printing.rs` and `printer_driver.rs`.

## Not yet done

See [[topic:printer-drivers]].
