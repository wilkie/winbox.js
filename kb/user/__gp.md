---
kind: function
module: USER
name: __GP
ordinal: 484
summary: USER's table of its own fault handlers, which KERNEL reads: data, not a function. WinBox's is its end alone.
versions:
  '3.1': exact
probes: [ugaps]
records: [gp]
source: src/win16/exported-data.ts
topics: [user-internals]
---

## Observed behaviour

- [[measured]] [[probe:ugaps]]: `GetProcAddress` gives an address for it.

## Inside Windows

- [[read out]] `USER.EXE` seg1 `b664`: a table of USER's code ranges and the handlers that take a fault in them, which KERNEL's [[fn:KERNEL.HasGPHandler]] reads for a module USER trusts ([[topic:kernel-internals]]). [[fn:USER.Hardware_Event]]'s nought from a program is one of them at work.

## Callers

- No file of the installations or the corpus imports it (`kb/data/user-callers.json`).

## Implementation

**Implemented (b), data.** In both engines the export is a table of its end alone, a selector of nought, laid where its stub would be (`exported-data.ts`): WinBox's USER has no code of Windows' to fault in, and [[fn:KERNEL.HasGPHandler]] answers nought. See [[topic:user-internals]].
