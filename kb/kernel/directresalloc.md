---
kind: function
module: KERNEL
name: DirectResAlloc
ordinal: 168
summary: A block for a resource of a module's, of the size and resource flags given: moveable, discardable for 1000h.
versions:
  '3.1': exact
probes: [reshand]
records: [direct]
source: crates/winbox-win16/src/resources.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `84b8`-`84e8`: the module found from the instance, nought for none; a block made as a segment is (`84eb`), its flags the resource flags given with moveable, its size the size given; the module's.
- [[measured]] [[probe:reshand]]: 64 bytes are 40h, not discardable for flags of nought, discardable for 1030h.

## Implementation

`src/win16/kernel/resource-handlers.ts`, and the Rust engine's `crates/winbox-win16/src/resources.rs`.
