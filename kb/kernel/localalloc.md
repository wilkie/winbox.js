---
kind: function
module: KERNEL
name: LocalAlloc
ordinal: 5
summary: Takes a block from the local heap of the current data segment, returning a handle for a moveable block and a near pointer for a fixed one.
versions:
  '3.1': exact
probes: [memory]
topics: [global-and-local-memory]
---

## Observed behaviour

- [[measured]] A block is sized in four-byte units and is never smaller than eight bytes. A fixed request for 1, 5 or 8 bytes gets 8, 9 gets 12, 16 gets 16, 17 gets 20 and 100 gets 100, as [[fn:KERNEL.LocalSize]] reports it — 7 records of [[probe:memory]].
- [[measured]] A moveable block gives two of its bytes to the link back to its handle, so what it reports is `max(8, roundup(request + 2, 4)) - 2`: requests of 1, 2 and 6 report 6, 7 reports 10, 15 to 18 all report 18, 19 reports 22 and 100 reports 102 — 10 records.
- [[measured]] All 17 sizes were recorded with every earlier block still held, so none of them is a freed block being reused. Nine were chosen to break the model rather than confirm it. See [[topic:global-and-local-memory]].

## Nuances

- [[documented]] The block comes from the local heap of whatever data segment `DS` names at the time of the call.
- Not yet measured: a request for zero bytes, `LMEM_DISCARDABLE`, `LMEM_ZEROINIT` contents, the handle and pointer values themselves, and what happens when the heap is full and has to grow.

## Implementation

`LocalAlloc` finds the heap belonging to `DS >> 3` and asks it for `Heap.blockFor(request, moveable)` bytes, which is the formula above. A request for zero bytes is refused with `NULL`, which no recording yet supports or contradicts. The flags beyond moveable are passed along but not acted on.
