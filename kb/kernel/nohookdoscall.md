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
source: crates/winbox-win16/src/kernel_calls/file_cdr.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `1d92`, calling `1cf9`.
- [[measured]] [[probe:ktask2]]: function 19h, the current drive, answers as `Dos3Call` does.

## Nuances

- winbox.js answers DOS once, so the call is `Dos3Call`'s.

## Implementation

`crates/winbox-win16/src/kernel_calls/code.rs`.
