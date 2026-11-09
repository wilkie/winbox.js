---
kind: function
module: KERNEL
name: LimitEmsPages
ordinal: 156
summary: Nought, in standard mode's KERNEL.
versions:
  '3.1': exact
probes: [ktask]
records: [memory]
source: crates/winbox-win16/src/kernel_calls/retail.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `4632`: `XOR AX,AX; CWD; RETF 4`.
- [[measured]] [[probe:ktask]]: nought.

## Implementation

`src/win16/kernel/retail.ts`, and the Rust engine's `kernel_calls/retail.rs`.
