---
kind: function
module: KERNEL
name: GlobalUnlock
ordinal: 19
summary: Counts a discardable global block's lock down and answers the count left; any other block answers 0.
versions:
  '3.1': exact
probes: [glocks, glock]
source: src/win16/kernel/GlobalUnlock.ts
topics: [global-and-local-memory]
---

## Observed behaviour

- [[measured]] A discardable block locked twice and unlocked once answers 1, and [[fn:KERNEL.GlobalFlags]] then reports a low byte of 1 — [[probe:glocks]].
- [[measured]] A moveable block that is not discardable answers 0 to every unlock: after one lock, after two or three, and unlocked once more than it was locked. A fixed block answers 0 too — [[probe:glocks]].
- [[measured]] A handle that names no block answers 0 — [[probe:glock]].

## Nuances

- [[documented]] The answer is nonzero while the block is still locked, and a program should not count on it to know how many unlocks are left.
- [[inferred]] Since only a discardable block's locks are counted, a moveable or fixed block always reads as unlocked, however often it was locked.
- Not yet measured: unlocking a discardable block more times than it was locked. The read-out below says the count stays at 0 and the answer is 0.

## Inside Windows

- [[read out]] `KRNL386.EXE` seg1 `0fe6` takes FFFFh as the caller's data segment, as [[fn:KERNEL.GlobalLock]] does, and answers 0 for a block that is not present or whose descriptor does not mark it discardable. For a discardable block it counts the byte at offset 14h of the arena down and answers what is left (`1025`). A count of 0, or of FFh, is left as it is and answers 0, so the count never wraps below nought.

## Implementation

The count is kept with the block, shared with [[fn:KERNEL.GlobalWire]] and the others that count it (see [[fn:KERNEL.GlobalFlags]]). winbox.js's own modules do not lock or unlock a program's blocks through it. See [[topic:global-and-local-memory]].
