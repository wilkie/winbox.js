---
kind: function
module: GDI
name: StartDoc
ordinal: 377
summary: Starts a document on a printer's device context; with StartPage, EndPage and EndDoc it prints, each page as it ends.
versions:
  '3.1': exact
probes: [printing, prdoc, prabort]
source: src/win16/gdi/printing.ts
topics: [printing, printer-drivers]
---

## Observed behaviour

[[measured]] [[probe:printing]] prints two documents of two pages each, one by the calls and one by the escapes, and abandons a third. With Windows' PostScript driver, every call of a document succeeds, and each document is written. Before `StartDoc`, [[fn:GDI.StartPage]] answers 1, [[fn:GDI.EndPage]] -1 and [[fn:GDI.EndDoc]] 1. See [[topic:printing]].

[[measured]] [[probe:prdoc]] prints a page through the PostScript driver to a file, and records each line of PostScript the driver wrote. Both engines run the driver and agree with all 223 records.

[[measured]] [[probe:prabort]]:

- An abort procedure that answers nought stops `StartDoc`, which answers -1. The procedure was asked 5 times, and no file is left.
- `StartDoc` on an information context answers -1.
- By the escape `STARTDOC`, the abort procedure is asked 43 times as the driver writes its prolog.

## Inside Windows

[[read out]] `GDI.EXE` seg31 `0045`, then `0196` for a Windows driver's DC. First the driver's `Control` is given `SETABORTPROC`, with the DC as its input from a word of GDI's stack. Then it is given `STARTDOC` with the document's name, and the `DOCINFO` as its output where the driver's `GDIINFO` is newer than 300h. The answer is the driver's. The PostScript driver opens its job there ([[fn:GDI.OpenJob]]) and writes its prolog through [[fn:GDI.WriteSpool]].

## Implementation

`src/win16/gdi/printing.ts` routes a driver's DC to `printer-driver.ts`. In Rust, `crates/winbox-win16/src/gdi/printing.rs` routes it to `printer_driver.rs`. WinBox's own printer (`printer.ts`, `printer.rs`) starts its job itself.

- Not recorded: `StartDoc` of a device context that is not a printer's, which winbox.js answers -1.
