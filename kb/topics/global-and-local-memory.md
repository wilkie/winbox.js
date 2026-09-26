---
kind: topic
name: Global and local memory
summary: What a global handle is, how the two heaps round a request, and what Windows 3.1 did and did not do to a block once it had one — as two probes recorded it.
probes: [memory, handles, localgro]
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

## A local heap that runs out

- [[measured]] [[probe:localgro]] starts with a data segment of 12,160 bytes and a 1,024-byte heap. It asks [[fn:KERNEL.LocalAlloc]] for fixed blocks that do not fit: three of 1,000 bytes, one of 3,072, then 4,096 at a time until one fails. Each request that does not fit grows the data segment. It grows by **the request plus 544, rounded up to 32**: 1,568 for 1,000, 3,616 for 3,072 and 4,640 for 4,096. The heap is at the end of the segment, so it grows with it.
- [[measured]] The growth ignores the room the heap already had, so the slack it leaves can take the next request whole. The second 1,000-byte block and the sixth 4,096-byte one needed no growth.
- [[measured]] A growth that would pass 64 KiB grows the segment to exactly 64 KiB instead, if the block then fits. If it still does not fit, the segment does not grow at all and `LocalAlloc` returns NULL. The first recording ended at 65,536 with the block made. The second ended at 65,312 and returned NULL.
- [[measured]] Each fixed block starts four bytes after the previous one ends.
- [[refused]] The first recording asked only for multiples of 32. On those, "the block, its four-byte header and 540" and "the same with 512, rounded up to 32" both fit every growth. The 1,000-byte requests were added to split them, and they refuted both: 1,544 and 1,536 against the 1,568 recorded.
- This is what Notepad hits first. Its heap is 2,048 bytes, and it asks for 3,072 before it opens its window.

## Flags and lock counts

- [[measured]] [[fn:KERNEL.GlobalFlags]] reports `0x0000` for new moveable and fixed blocks and `0x0100` for a discardable one. Being moveable is not reported.
- [[measured]] The lock count stays at 0 through two nested `GlobalLock` calls, on moveable and fixed blocks alike, and both calls return the same pointer.

## Nothing moved

- [[measured]] A moveable block unlocked, then surrounded by eight 4 KB allocations of which half were freed, then put through `GlobalCompact(0)`, locked at the same address again. So did a fixed block.
- [[measured]] [[fn:KERNEL.GlobalReAlloc]] kept the handle and the address when growing 256 bytes to 1024, shrinking 1024 to 256, and resizing 256 to 256, for a fixed block as well as moveable ones. [[fn:KERNEL.GlobalSize]] then reported the new size.
- [[inferred]] In protected mode none of these sizes requires a move: a descriptor's limit can change while its base stays. It also means a program that goes on using a moveable block's old pointer after unlocking it kept working on these recordings.

## Locking and resizing a local block

- [[documented]] `LocalLock` answers a local block's address: for a moveable block, the address its handle holds; for a fixed block, the pointer itself.
- [[documented]] `LocalReAlloc` gives a block a new size and keeps the bytes that fit:
  - a moveable block keeps its handle;
  - a fixed block moves only with `LMEM_MOVEABLE`;
  - nought with `LMEM_MOVEABLE` discards a moveable block, leaving its handle standing for nothing until it is given a size again;
  - `LMEM_MODIFY` changes only the flags.
- [[documented]] `GlobalReAlloc` to nought with `GMEM_MOVEABLE` discards a block. Its handle stays, `GlobalLock` answers NULL, `GlobalFlags` has `GMEM_DISCARDED`, and a later size gives it memory again. With `GMEM_MODIFY`, only whether it may be discarded changes. Program Manager discards its groups' blocks, and reads a group back in when the lock answers NULL.
- [[documented]] `LocalAlloc` of nought bytes, moveable, gives a handle to a block already discarded, which `LocalReAlloc` gives a size to later. Calendar makes its blocks this way.
- [[measured]] Notepad reads a file into a block grown with `LocalReAlloc` and addressed with `LocalLock` ([[topic:multi-line-edit-controls]]). Both were stubs before, and every file was "too large".

## Not yet measured

`LocalReAlloc` and `LocalLock` at all: their rounding here is `LocalAlloc`'s, and no lock count is kept. Discardable blocks actually being discarded, whether `GMEM_ZEROINIT` or `LMEM_ZEROINIT` zeroes anything, local requests for zero bytes, blocks and resizes beyond 64 KiB, freeing a locked block or freeing twice, what a freed handle turns into, and anything recorded in enhanced mode.

## In winbox.js

`src/win16/selectors.ts` states the encoding once, and the allocator works in descriptor indices, converting at the API boundary. Segments live in the LDT. Global blocks never move, and `GlobalFree` does not yet give memory back. `Heap.blockFor` in `src/win16/heap.ts` does the local rounding, and `Heap.grow` the growth of a moveable data segment's heap. winbox.js keeps a two-byte header rather than Windows' four, so its block offsets do not match [[probe:localgro]]'s, and it does not report the data segment's size; `test/win16/task_test.ts` holds the growth rule instead. How to record these probes again is in [[guide:reproducing]].
