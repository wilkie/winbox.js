---
kind: function
module: KERNEL
name: GetCurPID
ordinal: 157
summary: Nought.
versions:
  '3.1': exact
probes: [ktask]
records: [memory]
source: crates/winbox-win16/src/kernel_calls/retail.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `4639`-`4647`: nought in DX and AX.
- [[measured]] [[probe:ktask]]: nought.

## Implementation

`src/win16/kernel/retail.ts`, and the Rust engine's `kernel_calls/retail.rs`.
