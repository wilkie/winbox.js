---
kind: function
module: GDI
name: QueryAbort
ordinal: 155
summary: Asks a device context's abort procedure whether to go on printing — 1 with none set, nought for no device context.
versions:
  '3.1': exact
probes: [prspool]
source: src/win16/gdi/spooler.ts
topics: [printing]
---

## Observed behaviour

[[measured]] [[probe:prspool]]: with no device context the answer is nought. With the screen's DC or a printer's that has no abort procedure, it is 1. Once [[fn:GDI.SetAbortProc]] has given the printer's DC a procedure, the answer is the procedure's own (3 in the probe). The procedure is called with the DC and the code given.

## Inside Windows

[[read out]] `GDI.EXE` seg7 `052d`. Nought for no device context. Otherwise, the answer of the procedure `SETABORTPROC` kept on the context (+A6h), called with the context and the code, or 1 with none. GDI's spooler asks it before each write of a job's buffer ([[fn:GDI.WriteSpool]]).

## Implementation

`src/win16/gdi/spooler.ts` and `crates/winbox-win16/src/gdi/spooler.rs`.
