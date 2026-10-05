---
kind: function
module: KERNEL
name: GlobalFlags
ordinal: 22
summary: Reports a global block's lock count in its low byte and its flags in its high byte.
versions:
  '3.1': exact
probes: [memory, handles, misc, glocks]
topics: [global-and-local-memory]
---

## Observed behaviour

- [[measured]] A new 64-byte block reports `0x0000` when it is moveable and when it is fixed, and `0x0100` when it is moveable and discardable — 3 records of [[probe:memory]]. Being moveable is not among the flags it reports.
- [[measured]] A discardable block counts its locks in the low byte: `0x0100` new, `0x0101` after one [[fn:KERNEL.GlobalLock]], `0x0102` after two, and `0x0101` again after one `GlobalUnlock` — [[probe:glocks]].
- [[measured]] A moveable block that is not discardable, and a fixed block, keep a low byte of 0 through one, two and three locks, and through unlocks past the locks — [[probe:glocks]] and 2 records of [[probe:handles]].
- [[measured]] After `GlobalWire` of a moveable block, the low byte is 1; after `GlobalUnWire`, 0 again — 2 records of [[probe:misc]].

## Nuances

- [[documented]] The high byte carries bits such as discardable and discarded, and the low byte is the lock count.
- [[inferred]] So a program can use the lock count to tell whether a discardable block is locked, but not any other block, which `GlobalLock` does not count.
- Not yet measured: `GMEM_DISCARDED` after a discard, and flags such as `GMEM_DDESHARE`.

## Inside Windows

- [[read out]] `KRNL386.EXE` seg1 `0f85` swaps the two bytes the block-finding routine at `2519` gives: its arena flags, with discardable from the descriptor, and its lock count, the byte at offset 14h of its arena. That routine gives the count only for a block whose handle is not its selector (`2580`), so a fixed block always shows 0.
- [[read out]] The count is shared: `GlobalLock` and `GlobalUnlock` count only a discardable block, `GlobalWire`, `GlobalUnWire`, `GlobalFix` and `GlobalUnfix` any block that is not fixed, and `LockSegment` and `UnlockSegment` a discardable one. See [[topic:global-and-local-memory]].

## Implementation

`GlobalFlags` returns the flags the block was allocated with, masked to `0x0100`, `GMEM_DISCARDED` for a discarded block, and in the low byte the block's lock count, for a block allocated moveable or discardable. The count is kept with the block, and goes when it is freed. See [[topic:global-and-local-memory]].
