---
kind: function
module: GDI
name: CloseJob
ordinal: 243
summary: Ends a print job — its buffer written, its file closed and the job freed — and broadcasts that it closed.
versions:
  '3.1': partial
probes: [prspool, prlpt]
source: src/win16/gdi/spooler.ts
topics: [printer-drivers, printing]
---

## Observed behaviour

[[measured]] [[probe:prspool]]: `CloseJob` answers 1, and the file then holds everything written, 314 bytes. Every top-level window is sent message 40h with 2, and with 2 in the low word of the long and the job's handle in the high. By the time the window is sent it, the job's block has been freed. A handle from -5 to -1 is answered back as it is. [[probe:prlpt]]'s job through the communications driver also closes with 1.

## Inside Windows

[[read out]] `GDI.EXE` seg28 `1292`. A job straight to its port has its buffer written, its file closed and its blocks freed. A job through the communications driver has its port closed and its block freed (seg30 `015d`). Then comes the broadcast, `SendMessage(HWND_BROADCAST, 40h, 2, MAKELONG(2, job))`, and the answer 1. Print Manager's job is marked done and left to Print Manager.

## Implementation

`src/win16/gdi/spooler.ts` and `crates/winbox-win16/src/gdi/spooler.rs`.

## Not yet done

Print Manager's job.
