---
kind: function
module: KERNEL
name: AllocResource
ordinal: 66
summary: A block for a resource: the size given in the resource table's units, or the resource's own; moveable, discardable as the resource is.
versions:
  '3.1': exact
probes: [reshand]
records: [alloc]
source: src/win16/kernel/resource-handlers.ts
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `015d`-`0174`, `851e`-`85c3`: the module found from the instance, nought for none; the size given rounded up to the resource table's unit (one shifted by its alignment), or the resource's own length; where the resource has a block already, that block given the size (`GlobalReAlloc`); else a block made as a segment is (`84eb`): moveable, discardable where the resource is (its flag 1000h), the module's.
- [[measured]] [[probe:reshand]]: for a resource of 2Ch bytes, 40h; for 100 bytes, 80h; discardable (`GlobalFlags` 100h); a handle, not a selector.

## Implementation

`src/win16/kernel/resource-handlers.ts`, and the Rust engine's `crates/winbox-win16/src/resources.rs`.
