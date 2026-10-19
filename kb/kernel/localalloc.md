---
kind: function
module: KERNEL
name: LocalAlloc
ordinal: 5
summary: Takes a block from the local heap of the current data segment, returning a handle for a moveable block and a near pointer for a fixed one.
versions:
  '3.1': exact
probes: [memory, lheapseg]
topics: [global-and-local-memory]
---

## Observed behaviour

- [[measured]] A block is sized in four-byte units and is never smaller than eight bytes. A fixed request for 1, 5 or 8 bytes gets 8, 9 gets 12, 16 gets 16, 17 gets 20 and 100 gets 100, as [[fn:KERNEL.LocalSize]] reports it — 7 records of [[probe:memory]].
- [[measured]] A moveable block gives two of its bytes to the link back to its handle, so what it reports is `max(8, roundup(request + 2, 4)) - 2`: requests of 1, 2 and 6 report 6, 7 reports 10, 15 to 18 all report 18, 19 reports 22 and 100 reports 102 — 10 records.
- [[measured]] All 17 sizes were recorded with every earlier block still held, so none of them is a freed block being reused. Nine were chosen to break the model rather than confirm it. See [[topic:global-and-local-memory]].

## Nuances

- [[documented]] The block comes from the local heap of whatever data segment `DS` names at the time of the call.
- A heap that is full grows, its segment or block with it ([[topic:global-and-local-memory]], [[probe:localgro]], [[probe:lheapseg]]).
- [[read out]] A moveable block's handle is an entry of one of the heap's handle tables, a fixed block of 32 entries made when a handle is wanted and none is free; the block itself goes at the top of the last free block it fits, a fixed one at the bottom of the first (`KRNL386.EXE` seg1 `8ab6`, `9283`). A moveable block of nought bytes is a handle standing for a discarded block; a fixed one is refused. [[measured]] [[probe:lheapseg]] records the handles and where the heap grows ([[topic:global-and-local-memory]]).
- Not yet measured: `LMEM_DISCARDABLE`, and `LMEM_ZEROINIT` contents.

## Implementation

`LocalAlloc` finds the heap belonging to `DS >> 3` and asks it, `Heap.localAlloc` (`LocalHeap::local_alloc`), which follows KERNEL's routine: the handle from the tables, the block rounded as above and placed, the heap compacted and grown where it does not fit. The heap is kept in the segment, as KERNEL keeps it.
