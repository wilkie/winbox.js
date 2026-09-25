---
kind: function
module: KERNEL
name: GlobalSize
ordinal: 20
summary: Reports the size a global block was actually given, rounded up from what was asked for.
versions:
  '3.1': exact
probes: [memory, handles]
topics: [global-and-local-memory]
---

## Observed behaviour

- [[measured]] It reports the request rounded up to a multiple of 32, at least 32: 1, 2, 15, 16, 17 and 32 → 32, 100 → 128, and 1024, 4096 and 65536 unchanged — 17 records of [[probe:memory]], moveable, fixed and `GMEM_ZEROINIT` alike.
- [[measured]] A block allocated with zero bytes reports 0, moveable or fixed.
- [[measured]] After [[fn:KERNEL.GlobalReAlloc]] it reports the new size: 1024 and 256 on 4 records of [[probe:handles]].

## Nuances

- [[inferred]] So a program that asks for a byte and writes up to 32 is within its block on Windows 3.1, and relies on the rounding without knowing it.
- Not yet measured: the size of a discarded block, of a freed or invalid handle, and whether it accepts a selector in place of a handle.

## Implementation

The allocator keeps the rounded size for each descriptor and `GlobalSize` looks it up through `indexFor(handle)`, which is `handle >> 3`, so a selector gives the same answer as the handle. It returns 0 for a descriptor that has no block.
