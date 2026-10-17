---
kind: function
module: GDI
name: DeleteJob
ordinal: 244
summary: Abandons a print job — its file closed and deleted, unwritten — without broadcasting.
versions:
  '3.1': partial
probes: [prspool, prabort]
source: src/win16/gdi/spooler.ts
topics: [printer-drivers, printing]
---

## Observed behaviour

[[measured]] [[probe:prspool]]: a job given 300 bytes and then deleted answers 1 and leaves no file. Nothing is broadcast. A handle from -5 to -1 is answered back as it is.

[[measured]] [[probe:prabort]]: where the abort procedure stops `StartDoc`, the PostScript driver deletes its job, and no file is left.

## Inside Windows

[[read out]] `GDI.EXE` seg28 `13e0`. A job straight to its port has its file closed and deleted and its blocks freed. A job through the communications driver has its port flushed, reset and closed (seg30 `018a`). The answer is 1.

## Implementation

`src/win16/gdi/spooler.ts` and `crates/winbox-win16/src/gdi/spooler.rs`.

## Not yet done

Print Manager's job.
