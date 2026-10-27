---
kind: function
module: KERNEL
name: GlobalReAlloc
ordinal: 16
summary: Resizes a global block, and on the recorded cases hands back the same handle with the block still at the same address.
versions:
  '3.1': exact
probes: [handles, grround, galimit]
topics: [global-and-local-memory]
---

## Observed behaviour

- [[measured]] Growing a moveable block from 256 to 1024 bytes, shrinking one from 1024 to 256, growing a fixed block from 256 to 1024, and resizing a moveable block from 256 to 256 all return the handle they were given, and [[fn:KERNEL.GlobalLock]] gives the same address afterwards as before — 4 of 4 records of [[probe:handles]].
- [[measured]] [[fn:KERNEL.GlobalSize]] reports the new size afterwards: 1024, 256, 1024 and 256.
- [[measured]] A fixed block grows in place just as a moveable one does.
- [[measured]] [[probe:galimit]], blocks of 40h bytes, moveable and fixed, given a size with `GMEM_MOVEABLE`: 1, FFFFh and 10000h keep the handle; 100000h and 100001h move the block, a new handle answered, and its size is 100000h and 101000h, rounded past 1 MiB to a 4 KiB page as [[fn:KERNEL.GlobalAlloc]] rounds it. FE0000h and FF0000h, with too little memory for them, and FF0001h, FFFFFFh, 1000000h, 1000001h, 68000000h and FFFFFFFFh, past what any block can be, answer `NULL`, and the block is left at 40h bytes.
- [[measured]] [[probe:galimit]]: a size of nought with `GMEM_MOVEABLE` answers `NULL` for a moveable block that is not discardable, and for a fixed one, and the block is left at 40h bytes. Only a discardable block is discarded.
- [[measured]] The new size is rounded up to 32 bytes, as [[fn:KERNEL.GlobalAlloc]] rounds one: [[probe:grround]] grows blocks of 100h, moveable and fixed, to 101h, 110h, 111h and 120h, all 120h; 130h, 140h; 2FF0h, 3000h; 3510h and 3511h, 3520h.

## Nuances

- [[inferred]] In protected mode nothing has to move for these sizes: the descriptor's limit can change while its base stays put, which is consistent with what was recorded.
- Not yet measured: `GMEM_MODIFY` and the other flags, a discardable block discarded by a size of nought, and the largest size a block can be grown to (`20a8` takes no more than FEh selectors, but the oracle's machine has too little memory to reach it).
- [[read out]] `KRNL386.EXE` seg1 `40f9`: a block asked for nought bytes, to be discarded, is not discarded while its lock count is not 0 (`4129`), and `NULL` is answered. Only a discardable block's locks are counted by [[fn:KERNEL.GlobalLock]], and a wired block's by [[fn:KERNEL.GlobalWire]]. Nor is it discarded without `GMEM_MOVEABLE` among the flags (`413f`), or where its descriptor does not mark it discardable (`2da9`). winbox.js does the same.

## Inside Windows

[[read out]] `KRNL386.EXE` seg1. The export (`028c`) goes on to `0d68`, which takes the size through `0c7c` as [[fn:KERNEL.GlobalAlloc]] does: more than FF0000h becomes 7FFFFFFFh. `40f9` rounds it with `3fde`, which makes anything past FF0000h FF0000h. A block that must grow past its selectors asks `20a8` for more, which refuses FFh or more, so such a size is refused, `ERR_GREALLOC` logged through `LogError` and nought answered. Within that, a block that cannot grow where it is is moved (`379e`, with the same search, DPMI request, compaction and discarding as `GlobalAlloc`), and refused when no room is found.

## Implementation

The allocator rounds the new size as [[fn:KERNEL.GlobalAlloc]] does and keeps the block where it is. Every block already has a whole 64 KiB selector behind it, so a size that still fits in the selectors it was given changes only the bookkeeping. One that needs more selectors moves the block ([[probe:grow]]). A size `0c7c` does not let through is refused, and so is a growth the modelled machine has no room for: the whole new size where the block moves, what it grows by where it stays (see How much there is, in [[topic:global-and-local-memory]]).
