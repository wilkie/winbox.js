---
kind: function
module: KERNEL
name: GlobalLock
ordinal: 18
summary: Returns a far pointer to the start of a global block, whose selector is the handle with its privilege bits raised by one.
versions:
  '3.1': exact
probes: [memory, handles]
topics: [global-and-local-memory]
---

## Observed behaviour

- [[measured]] The pointer's offset is 0 for moveable and fixed blocks alike, and its selector is not the handle — 2 records of [[probe:memory]].
- [[measured]] The selector is the handle plus one, low bits 7 against the handle's 6, for moveable, fixed and discardable blocks — 6 records of [[probe:handles]].
- [[measured]] Locking twice gives the same pointer both times, for moveable and fixed blocks, and the lock count [[fn:KERNEL.GlobalFlags]] reports afterwards is still 0.
- [[measured]] A moveable or fixed block that is unlocked, has eight 4 KB blocks allocated around it, half of them freed, and `GlobalCompact(0)` called, locks at the same address again — 2 records.
- [[measured]] [[fn:KERNEL.GlobalReAlloc]] does not change the address it locks at, on 4 recorded resizes.

## Nuances

- [[inferred]] Since nothing moved, a program that keeps using a moveable block's pointer after unlocking it would have worked on these recordings. Whether Windows ever moves a block under memory pressure is not yet measured.
- Not yet measured: locking a zero-byte block, a discarded block, or a freed handle.

## Implementation

`GlobalLock` returns `selectorFor(handle) << 16` and keeps no count. It does not check that the handle names an allocated block. See [[topic:global-and-local-memory]].
