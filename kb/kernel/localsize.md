---
kind: function
module: KERNEL
name: LocalSize
ordinal: 10
summary: Reports how many bytes a local block actually holds, which is usually more than was asked for.
versions:
  '3.1': exact
probes: [memory]
topics: [global-and-local-memory]
---

## Observed behaviour

- [[measured]] For a fixed block it reports the whole block, `max(8, roundup(request, 4))`: 1 → 8, 9 → 12, 17 → 20 — 7 records of [[probe:memory]].
- [[measured]] For a moveable block it reports two less than the block the request occupies, `max(8, roundup(request + 2, 4)) - 2`: 1 → 6, 7 → 10, 15, 16, 17 and 18 → 18, 100 → 102 — 10 records.
- [[measured]] So a moveable block reports a size that is two more than a multiple of four, and never less than 6. All 17 records agree with winbox.js.

## Nuances

- [[inferred]] The two bytes a moveable block does not report are the link from the block back to its handle; the rounding is otherwise the same as a fixed block's. See [[topic:global-and-local-memory]].
- [[documented]] It works on the heap of the current `DS`, like [[fn:KERNEL.LocalAlloc]].
- Not yet measured: the size of a discarded block, of a block after `LocalReAlloc`, and of an invalid handle.

## Implementation

`Heap#sizeOf` accepts a handle or a pointer: a handle is recognised because the heap remembers handing it out, and it is followed to the block it points at. The size reported is the size the block was allocated with, so the rounding happens once, in `Heap.blockFor`.
