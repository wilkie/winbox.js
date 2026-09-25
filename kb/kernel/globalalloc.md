---
kind: function
module: KERNEL
name: GlobalAlloc
ordinal: 15
summary: Allocates a block of the global heap and returns a handle that is its own selector at a lower privilege level.
versions:
  '3.1': exact
probes: [memory, handles]
topics: [global-and-local-memory]
---

## Observed behaviour

- [[measured]] The size is rounded up to a multiple of 32, with 32 the least: requests of 1, 2, 15, 16, 17 and 32 bytes all come back as 32, 100 as 128, and 1024, 4096 and 65536 unchanged, as [[fn:KERNEL.GlobalSize]] reports it — 17 records of [[probe:memory]].
- [[measured]] Fixed and moveable blocks round alike (fixed 1 and 16 → 32, 1024 → 1024), and `GMEM_ZEROINIT` does not change the size (100 → 128 either way).
- [[measured]] A request for zero bytes succeeds, moveable and fixed alike, and gets a real handle whose size reads 0.
- [[measured]] The handle is one less than the selector [[fn:KERNEL.GlobalLock]] returns for it, with low three bits 6 against 7, for moveable, fixed and discardable blocks — 6 records of [[probe:handles]].

## Nuances

- [[inferred]] Both values name the same local-descriptor-table entry, the handle at requested privilege level 2 and the selector at 3. A fixed block's handle is therefore not its selector, which the common account says it is.
- Not yet measured: whether `GMEM_ZEROINIT` actually zeroes the block, discardable blocks being discarded, `GMEM_DDESHARE`, and blocks larger than 64 KiB.
- [[measured]] Both fixtures record Windows 3.1 running in standard mode. Enhanced mode has not been recorded.

## Implementation

The allocator rounds to 32 bytes, keeps zero as zero, and takes one 64 KiB selector per 64 KiB or part of it. It records the flags and the selector count, which [[fn:KERNEL.GlobalFlags]] and [[fn:KERNEL.GlobalReAlloc]] read back. What the caller gets is `handleFor(index)` from `src/win16/selectors.ts`. See [[topic:global-and-local-memory]].
