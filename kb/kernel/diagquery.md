---
kind: function
module: KERNEL
name: DiagQuery
ordinal: 339
summary: Whether Windows is keeping a log of its start: nought.
versions:
  '3.1': exact
probes: [ktask]
records: [debug]
source: src/win16/kernel/retail.ts
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `a70e`-`a71c`: the word at D50h of KERNEL's data, its diagnostic mode. That is set when Windows is started to log its boot.
- [[measured]] [[probe:ktask]]: nought.

## Implementation

`src/win16/kernel/retail.ts`, and the Rust engine's `kernel_calls/retail.rs`.
