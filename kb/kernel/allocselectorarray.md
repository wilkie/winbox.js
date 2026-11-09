---
kind: function
module: KERNEL
name: AllocSelectorArray
ordinal: 206
summary: Selectors one after another, each data at nought with no limit; the first.
versions:
  '3.1': exact
probes: [ktask]
records: [selector]
source: crates/winbox-win16/src/modules_kernel.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `1df5`-`1e28`: as many free descriptors one after another as asked, each given access byte F3h and byte 6 nought. The first selector is answered, or nought.
- [[measured]] [[probe:ktask]]: three, 8 apart, each `LAR` F300h with base and limit nought.

## Implementation

`src/win16/kernel/selector-aliases.ts`, and the Rust engine's `modules_kernel.rs (Descriptors::blank_run)`.
