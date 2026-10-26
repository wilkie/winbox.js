---
kind: function
module: KERNEL
name: SetTaskSignalProc
ordinal: 38
summary: The procedure KERNEL signals for a task, given; the one it had.
versions:
  '3.1': exact
probes: [ktask2]
records: [small]
source: src/win16/kernel/code-calls.ts
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `7dc5`-`7de0`: the double word at 2Ah of the task's database exchanged, the running task's for nought.
- [[measured]] [[probe:ktask2]]: the probe already has one, and the procedure given comes back.

## Nuances

- [[inferred]] The one a task has is USER's `SignalProc`, ordinal 314. winbox.js answers that export's address for a task that was given none.

## Implementation

`src/win16/kernel/code-calls.ts`, and the Rust engine's `crates/winbox-win16/src/kernel_calls/code.rs`.
