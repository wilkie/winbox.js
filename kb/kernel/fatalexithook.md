---
kind: function
module: KERNEL
name: FatalExitHook
ordinal: 318
summary: The procedure KERNEL calls as a program fails, set; the one there before.
versions:
  '3.1': exact
probes: [ktask]
records: [debug]
source: src/win16/kernel/retail.ts
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `9ecf`-`9ee8`: the double word at 304h of KERNEL's data exchanged for the one given.
- [[measured]] [[probe:ktask]]: nought the first time, then the procedure given.

## Nuances

- Not yet done: [[fn:KERNEL.FatalExit]] calling the hook.

## Implementation

`src/win16/kernel/retail.ts`, and the Rust engine's `kernel_calls/retail.rs`.
