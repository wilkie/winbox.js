---
kind: function
module: KERNEL
name: AllocAlias
ordinal: 172
summary: A code selector for a segment's memory; the selector given in DX.
versions:
  '3.1': exact
probes: [ktask]
records: [selector]
source: crates/winbox-win16/src/modules_kernel.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `21fb`-`2220`: a descriptor allocated and made an alias of the one given. DX is left holding the selector given.
- [[measured]] [[probe:ktask]]: code, `LAR` FB00h, the block's base and limit. DX holds the selector given.

## Implementation

`crates/winbox-win16/src/modules_kernel.rs`.
