---
kind: function
module: KERNEL
name: GetLPErrMode
ordinal: 99
summary: A far pointer to the byte in KERNEL's data that is one while KERNEL makes a DOS call for a program.
versions:
  '3.1': exact
probes: [kmore]
records: [errmode]
source: crates/winbox-win16/src/kernel_calls/more.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `0bc5`-`0bcd`: DX is KERNEL's data segment's selector, AX 32Ah. The byte there is set to one as KERNEL passes a program's DOS call on (seg1 `1d00`), and put back from 32Bh after (`1d36`-`1d39`), so that a critical error in the call is taken as the program's; it is nought otherwise. Despite its name it is not the mode `SetErrorMode` sets (that call is seg3 `0132`).
- [[measured]] [[probe:kmore]]: the selector is KERNEL's instance, the offset 32Ah, and the byte nought.

## Nuances

- WinBox keeps the byte at nought: a program's DOS calls are answered by the engine, not passed on by KERNEL, and no critical error can come of them.

## Implementation

`src/win16/kernel/more-calls.ts`, and the Rust engine's `crates/winbox-win16/src/kernel_calls/more.rs`.
