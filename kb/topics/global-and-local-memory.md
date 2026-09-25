---
kind: topic
name: Global and local memory
summary: What a global handle is, how the two heaps round a request, and what Windows 3.1 did and did not do to a block once it had one — as two probes recorded it.
probes: [memory, handles]
---

A Windows 3.1 program has two allocators: the global heap, whose blocks are whole segments reached through selectors, and the local heap inside its own data segment, whose blocks are near offsets. The two round differently, and the global one's handles have a precise relationship to the selectors that address them.

Handle values are the allocator's choice and need not repeat between runs, so neither probe records one. They record what can be derived from a handle instead: sizes, flags, offsets, and whether two values are equal or differ by a constant. Both fixtures record Windows 3.1 in standard mode. Every one of their 56 records agrees with winbox.js.

## A global handle is its selector at a lower privilege

- [[measured]] The selector in the pointer [[fn:KERNEL.GlobalLock]] returns is the handle plus one, for moveable, fixed and discardable blocks: 3 of 3 records of [[probe:handles]].
- [[measured]] The handle's low three bits are 6 and the selector's are 7, on the same three blocks.
- [[inferred]] So both have the table bit set and name the same entry in the local descriptor table. What separates them is the requested privilege level, 2 for the handle and 3 for the selector. Shifting either right by three gives the descriptor.
- [[measured]] [[fn:KERNEL.GlobalHandle]] turns the selector back into the handle, for moveable and fixed blocks: 2 of 2.
- [[measured]] [[probe:memory]] had already found that the selector is not the handle even for a fixed block. The common account says a fixed block's handle is its selector, and it is wrong by exactly one.

## Global sizes

- [[measured]] [[fn:KERNEL.GlobalAlloc]] rounds a request up to a multiple of 32 bytes, with 32 the least, and [[fn:KERNEL.GlobalSize]] reports the rounded size: 1 → 32, 17 → 32, 100 → 128, 1024 → 1024, 65536 → 65536. 17 records, fixed, moveable and `GMEM_ZEROINIT` alike.
- [[measured]] A request for zero bytes is honoured, not refused. It returns a real handle whose size reads 0, moveable or fixed.
- [[measured]] A locked block starts at offset 0 of its selector: 2 of 2.

## Local sizes

- [[measured]] The local heap works in four-byte units with a smallest block of eight. A fixed block's [[fn:KERNEL.LocalSize]] is `max(8, roundup(request, 4))`: 1 → 8, 9 → 12, 17 → 20, 100 → 100. 7 records.
- [[measured]] A moveable block reports `max(8, roundup(request + 2, 4)) - 2`: 1 → 6, 7 → 10, 15 to 18 → 18, 19 → 22, 100 → 102. 10 records.
- [[inferred]] The two bytes a moveable block does not report hold the link back to its handle.
- [[refused]] The first reading of 15, 16 and 17 all reporting 18 looked like the probe measuring reuse, since it freed each block before asking for the next. Holding every block until the end gave the same 17 numbers, so reuse was ruled out. Nine of the sizes were picked to break the model — on either side of a four-byte boundary, at the minimum, or exactly on a boundary — and none did.

## Flags and lock counts

- [[measured]] [[fn:KERNEL.GlobalFlags]] reports `0x0000` for new moveable and fixed blocks and `0x0100` for a discardable one. Being moveable is not reported.
- [[measured]] The lock count stays at 0 through two nested `GlobalLock` calls, on moveable and fixed blocks alike, and both calls return the same pointer.

## Nothing moved

- [[measured]] A moveable block unlocked, then surrounded by eight 4 KB allocations of which half were freed, then put through `GlobalCompact(0)`, locked at the same address again. So did a fixed block.
- [[measured]] [[fn:KERNEL.GlobalReAlloc]] kept the handle and the address when growing 256 bytes to 1024, shrinking 1024 to 256, and resizing 256 to 256, for a fixed block as well as moveable ones. [[fn:KERNEL.GlobalSize]] then reported the new size.
- [[inferred]] In protected mode none of these sizes requires a move: a descriptor's limit can change while its base stays. It also means a program that goes on using a moveable block's old pointer after unlocking it kept working on these recordings.

## Not yet measured

Discardable blocks actually being discarded, whether `GMEM_ZEROINIT` or `LMEM_ZEROINIT` zeroes anything, local requests for zero bytes, blocks and resizes beyond 64 KiB, freeing a locked block or freeing twice, what a freed handle turns into, and anything recorded in enhanced mode.

## In winbox.js

`src/win16/selectors.ts` states the encoding once, and the allocator works in descriptor indices, converting at the API boundary. Segments live in the LDT. Global blocks never move, and `GlobalFree` does not yet give memory back. `Heap.blockFor` in `src/win16/heap.ts` does the local rounding. How to record these probes again is in [[guide:reproducing]].
