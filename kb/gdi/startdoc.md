---
kind: function
module: GDI
name: StartDoc
ordinal: 377
summary: Starts a document on a printer's device context; with StartPage, EndPage and EndDoc it prints, each page as it ends.
versions:
  '3.1': exact
probes: [printing]
source: src/win16/gdi/printing.ts
topics: [printing]
---

## Observed behaviour

[[measured]] [[probe:printing]] prints two documents of two pages each, by the calls and by the escapes, and abandons a third. With Windows' PostScript driver, every call of a document succeeds, and each document is written. Before `StartDoc`, [[fn:GDI.StartPage]] answers 1, [[fn:GDI.EndPage]] -1 and [[fn:GDI.EndDoc]] 1. See [[topic:printing]].

winbox.js agrees with all 24 records, printing with its own printer. `StartDoc` was a stub, as were the rest.

- Not recorded: `StartDoc` of a device context that is not a printer's, which winbox.js answers -1, and the job's number, of which only the sign is kept.
