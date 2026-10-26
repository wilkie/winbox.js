---
kind: function
module: KERNEL
name: LoadResource
ordinal: 61
summary: A resource's block: loaded by its type's handler, the same block while it is used; a discardable one loaded only as it is locked.
versions:
  '3.1': exact
probes: [findres, reshand]
records: [load, loads, own]
source: src/win16/kernel/LoadResource.ts
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `8928`-`8a23`. Used already, its uses are counted and its block answered. Its block there, loaded once (flag 4 of its entry) and not discarded, the same. A discardable resource with no block yet is given one, empty and discarded, and nothing is loaded (`8982`-`89be`): [[fn:KERNEL.LockResource]] loads it. Otherwise its type's handler ([[fn:KERNEL.SetResourceHandler]]) is called with the block, the module and the resource, DS, ES and AX the stack's segment; what it answers is the resource's block.
- [[measured]] [[probe:findres]]: a resource loaded twice is one handle, and 20,000 times never fails. [[probe:reshand]]: with a handler of the probe's set, a discardable resource's block is discarded until it is locked, and the handler is called only then; loaded again, and after it is freed, the same block, the handler not called.

## Nuances

- With KERNEL's own handler WinBox loads the resource at once.

## Implementation

`src/win16/kernel/LoadResource.ts` and `resource-handlers.ts`, and the Rust engine's `resources.rs`.
