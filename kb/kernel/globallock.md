---
kind: function
module: KERNEL
name: GlobalLock
ordinal: 18
summary: Returns a far pointer to the start of a global block, whose selector is the handle with its privilege bits raised by one, and counts a discardable block's lock.
versions:
  '3.1': exact
probes: [memory, handles, glock, glocks]
topics: [global-and-local-memory]
---

## Observed behaviour

- [[measured]] The pointer's offset is 0 for moveable and fixed blocks alike, and its selector is not the handle — 2 records of [[probe:memory]].
- [[measured]] The selector is the handle plus one, low bits 7 against the handle's 6, for moveable, fixed and discardable blocks — 6 records of [[probe:handles]].
- [[measured]] Locking twice gives the same pointer both times, for moveable and fixed blocks, and the lock count [[fn:KERNEL.GlobalFlags]] reports afterwards is still 0.
- [[measured]] A discardable block's lock is counted: [[fn:KERNEL.GlobalFlags]] reports a low byte of 1, then 2. A moveable or a fixed block locked three times still reports 0 — [[probe:glocks]].
- [[measured]] [[fn:KERNEL.GlobalHandle]] of the locked pointer's selector answers the block's handle, for a moveable block and a discardable one — [[probe:glocks]].
- [[measured]] A moveable or fixed block that is unlocked, has eight 4 KB blocks allocated around it, half of them freed, and `GlobalCompact(0)` called, locks at the same address again — 2 records.
- [[measured]] [[fn:KERNEL.GlobalReAlloc]] does not change the address it locks at, on 4 recorded resizes.

## Nuances

- [[inferred]] Since nothing moved, a program that keeps using a moveable block's pointer after unlocking it would have worked on these recordings. Whether Windows ever moves a block under memory pressure is not yet measured.
- [[measured]] A handle that names no block locks nothing ([[probe:glock]]); FFFFh locks the caller's own data segment.

## Inside Windows

- [[read out]] `KRNL386.EXE` seg1 `0f9d` reads the handle's access rights with `LAR`. A present block is answered at offset 0 of the handle with its lowest bit set; only where the descriptor's available bit marks it discardable (`0fc2`) is the byte at offset 14h of its arena counted up, with `INC`, so 255 locks and one more is 0 again.
- [[read out]] KERNEL's own [[fn:KERNEL.LockResource]] calls it (seg1 `8768`), so a discardable resource's lock is counted the same way.

## Implementation

`GlobalLock` answers `selectorFor(handle) << 16` and counts a discardable block's lock with the block. winbox.js's own modules take a block's address without counting (`globalPointer` in `src/win16/kernel/GlobalLock.ts`, `System::global_pointer` in the Rust engine), so a program sees only the locks it, or KERNEL for it, made. See [[topic:global-and-local-memory]].
