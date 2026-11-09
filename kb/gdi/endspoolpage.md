---
kind: function
module: GDI
name: EndSpoolPage
ordinal: 247
summary: Ends a page of a print job; Print Manager is handed the page, and a job straight to its port answers 1.
versions:
  '3.1': partial
probes: [prspool]
source: crates/winbox-win16/src/gdi/spooler.rs
topics: [printer-drivers]
---

## Observed behaviour

[[measured]] [[probe:prspool]]: 1 for a job to a file. A handle from -5 to -1 is answered back as it is.

## Inside Windows

[[read out]] `GDI.EXE` seg28 `1112`. The answer is 1 for a job straight to its port or through the communications driver. Print Manager's page is ended and handed to Print Manager.

## Implementation

`crates/winbox-win16/src/gdi/spooler.rs`.

## Not yet done

Print Manager's pages.
