---
kind: function
module: KERNEL
name: GlobalLRUOldest
ordinal: 163
summary: A block moved in the list of the least recently used; its handle, nought for no block.
versions:
  '3.1': exact
probes: [ktask2]
records: [small]
source: crates/winbox-win16/src/kernel_calls/code.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `0338`, `11b0`/`11bb`: the block found from its handle and moved, and the handle answered.
- [[measured]] [[probe:ktask2]]: the handle, for a discardable block, and nought for 1234h.

## Nuances

- winbox.js keeps no such list, and only answers.

## Implementation

`src/win16/kernel/code-calls.ts`, and the Rust engine's `crates/winbox-win16/src/kernel_calls/code.rs`.
