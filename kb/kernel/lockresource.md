---
kind: function
module: KERNEL
name: LockResource
ordinal: 62
summary: A resource's block locked; a discarded one loaded first by its type's handler, and what it answers locked.
versions:
  '3.1': exact
probes: [reshand]
records: [load, own]
source: crates/winbox-win16/src/resources.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `0191`-`019c`, `8755`-`8809`: `GlobalLock`; where it gives nothing, the resource whose block it is found in the module's table, its type's handler called with the block, and what the handler answers locked, the resource marked loaded; its block stays the one it was.
- [[measured]] [[probe:reshand]]: a discarded resource's handler is called as it is locked, given the block; a block the handler makes of its own is what is locked.

## Implementation

`src/win16/kernel/LockResource.ts` and `resource-handlers.ts`, and the Rust engine's `resources.rs`.
