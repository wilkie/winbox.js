---
kind: function
module: KERNEL
name: GlobalDosFree
ordinal: 185
summary: A block from GlobalDosAlloc freed, as GlobalFree frees one: nought.
versions:
  '3.1': exact
probes: [kmore]
records: [dos]
source: src/win16/kernel/more-calls.ts
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `13d4`-`13e6`: `GlobalFree`'s own call (seg1 `0de5`) on the selector.
- [[measured]] [[probe:kmore]]: nought, and nought again for a selector already freed.

## Implementation

`src/win16/kernel/more-calls.ts`, and the Rust engine's `crates/winbox-win16/src/kernel_calls/more.rs`.
