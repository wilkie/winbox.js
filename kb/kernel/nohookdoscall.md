---
kind: function
module: KERNEL
name: NoHookDosCall
ordinal: 101
summary: A DOS call, made past what KERNEL hooks of INT 21h.
versions:
  '3.1': exact
probes: [ktask2]
records: [dos]
source: src/win16/kernel/Dos3Call.ts
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `1d92`, calling `1cf9`.
- [[measured]] [[probe:ktask2]]: function 19h, the current drive, answers as `Dos3Call` does.

## Nuances

- winbox.js answers DOS once, so the call is `Dos3Call`'s.

## Implementation

`src/win16/kernel/Dos3Call.ts`, and the Rust engine's `crates/winbox-win16/src/kernel_calls/code.rs`.
