---
kind: function
module: KERNEL
name: GlobalHandle
ordinal: 21
summary: Turns the selector of a global block back into the block's handle.
versions:
  '3.1': exact
probes: [handles]
topics: [global-and-local-memory]
---

## Observed behaviour

- [[measured]] Given the selector of a pointer from [[fn:KERNEL.GlobalLock]], it returns the handle that block was allocated as, for a moveable and for a fixed block — 2 of 2 records of [[probe:handles]].

## Nuances

- [[documented]] The result is a doubleword whose low word is the handle and whose high word is the selector.
- [[measured]] The probe compares only the low word. The high word is not recorded.
- [[inferred]] Because a handle and its selector differ only in their privilege bits (see [[topic:global-and-local-memory]]), the answer can be computed from the selector without searching any table.
- Not yet measured: a discardable block, a selector nothing was allocated behind, and a selector from `AllocSelector`.

## Implementation

`GlobalHandle` computes both words from the selector with the conversions in `src/win16/selectors.ts`. It returns 0 when the descriptor has neither a size nor flags, which also makes it return 0 for a block allocated with zero bytes and no flags. Nothing has measured that case.
