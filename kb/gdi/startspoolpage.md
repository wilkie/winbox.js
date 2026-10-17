---
kind: function
module: GDI
name: StartSpoolPage
ordinal: 246
summary: Starts a page of a print job; for a job straight to its port it only notes where the page begins.
versions:
  '3.1': partial
probes: [prspool, prlpt]
source: src/win16/gdi/spooler.ts
topics: [printer-drivers]
---

## Observed behaviour

[[measured]] [[probe:prspool]] and [[probe:prlpt]]: 1 for a job to a file and for one to `LPT1`. A handle from -5 to -1 is answered back as it is.

## Inside Windows

[[read out]] `GDI.EXE` seg28 `06a1`. The answer is 1. With Print Manager's window there, a job straight to its port notes the bytes written so far. Print Manager's job starts each page in a file of its own.

## Implementation

`src/win16/gdi/spooler.ts` and `crates/winbox-win16/src/gdi/spooler.rs`.

## Not yet done

Print Manager's pages.
