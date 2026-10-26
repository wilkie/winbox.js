---
kind: function
module: KERNEL
name: GetWinDebugInfo
ordinal: 355
summary: FALSE in the retail Windows 3.1, which has no debugging options.
versions:
  '3.1': exact
probes: [ktask]
records: [debug]
source: src/win16/kernel/retail.ts
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `9f2a`: `SUB AX,AX` and return. The structure is neither read nor written.
- [[measured]] [[probe:ktask]]: nought.

## Implementation

`src/win16/kernel/retail.ts`, and the Rust engine's `kernel_calls/retail.rs`.
