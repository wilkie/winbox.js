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
- [[measured]] [[probe:kintrnl]]: nought before any record is added, then the record added last, and nought again once all are taken out.

## Callers

- [[read out]] `WINOLDAP.MOD` imports it by ordinal. Its routine at seg1 `323a` takes one word, a code. It walks the chain from the head this answers, calling each record's procedure (the far pointer at 4 of the record) with that word, and follows the record's first four bytes to the next. With a code not nought it stops at the first procedure that answers anything but nought, and answers that. It answers nought at the end of the chain (WINOLDAP seg1 `3240`-`326b`). No other file of the installations or the corpus imports it (`kb/data/kernel-callers.json`).

## Implementation

Both engines answer the head of the chain that [[fn:KERNEL.RegisterWinOldApHook]] keeps: `src/win16/kernel/internals.ts` and `crates/winbox-win16/src/kernel_calls/internals.rs`. See [[topic:kernel-internals]].
