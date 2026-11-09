---
kind: function
module: KERNEL
name: SetWinDebugInfo
ordinal: 356
summary: FALSE in the retail Windows 3.1, which has no debugging options.
versions:
  '3.1': exact
probes: [ktask]
records: [debug]
source: crates/winbox-win16/src/kernel_calls/retail.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `9f36`: `SUB AX,AX` and return. The structure is neither read nor written.
- [[measured]] [[probe:ktask]]: nought.

## Implementation

`crates/winbox-win16/src/kernel_calls/retail.rs`.
