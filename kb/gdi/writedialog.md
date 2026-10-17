---
kind: function
module: GDI
name: WriteDialog
ordinal: 242
summary: A driver's message for the user about a print job; a job straight to its port only has its buffer written, and answers nought.
versions:
  '3.1': partial
probes: [prspool]
source: src/win16/gdi/spooler.ts
topics: [printer-drivers]
---

## Observed behaviour

[[measured]] [[probe:prspool]]: nought for a job to a file. Nothing is shown. A handle from -5 to -1 is answered back as it is.

## Inside Windows

[[read out]] `GDI.EXE` seg28 `0e82`. For a job straight to its port, its buffer is written and the answer is nought. Print Manager's job keeps the message for Print Manager's own box, and the count is answered.

## Implementation

`src/win16/gdi/spooler.ts` and `crates/winbox-win16/src/gdi/spooler.rs`.

## Not yet done

Print Manager's job.
