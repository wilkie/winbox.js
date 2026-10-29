---
kind: function
module: KERNEL
name: GetWinOldApHooks
ordinal: 344
summary: The head of the chain of records RegisterWinOldApHook keeps, as a far pointer; standard mode's WinOldAp calls each record's procedure around a DOS session.
topics: [kernel-internals, task-list]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg2 `06f3`-`0705` (the same offset in `KRNL286.EXE`). No arguments. DX:AX is the far pointer at 336h of KERNEL's data, the first record [[fn:KERNEL.RegisterWinOldApHook]] linked, or nought.
- Not yet measured.

## Callers

- [[read out]] `WINOLDAP.MOD` imports it by ordinal. Its routine at seg1 `323a` takes one word, a code. It walks the chain from the head this answers, calling each record's procedure (the far pointer at 4 of the record) with that word, and follows the record's first four bytes to the next. With a code not nought it stops at the first procedure that answers anything but nought, and answers that. It answers nought at the end of the chain (WINOLDAP seg1 `3240`-`326b`). No other file of the installations or the corpus imports it (`kb/data/kernel-callers.json`).

## Implementation

A stub in both engines, which leaves DX:AX as they were.

**Recommendation: implement as Windows does, with [[fn:KERNEL.RegisterWinOldApHook]].** It answers the head of the chain that call keeps, or nought when none is kept. That is a few lines once the chain is there. See [[topic:kernel-internals]].
