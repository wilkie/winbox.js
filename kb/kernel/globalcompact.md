---
kind: function
module: KERNEL
name: GlobalCompact
ordinal: 25
summary: The largest block DPMI could still give, compacting first where it is too small; on WinBox, the oracle's machine as a program found it.
versions:
  '3.1': partial
probes: [freemem, galimit]
source: crates/winbox-win16/src/pointers.rs
topics: [global-and-local-memory]
---

## Observed behaviour

- [[measured]] [[probe:freemem]]: `GlobalCompact(0)` and `GlobalCompact(-1)` both answer 14,480K, a little less than [[fn:KERNEL.GetFreeSpace]]'s 15,086K.
- [[measured]] [[probe:galimit]]: E24000h, and the largest block [[fn:KERNEL.GlobalAlloc]] then grants is E34000h, 10000h more.
- [[measured]] In 386 enhanced mode, [[probe:galimit]] and [[probe:freemem]]: FF0000h, the most it answers, where the machine has more than that free ([[guide:enhanced-mode]]).

## Nuances

- WinBox answers the oracle's machine as [[probe:galimit]] found it, less what has been held since a program first asked (see How much there is, in [[topic:global-and-local-memory]]). It never compacts: nothing in WinBox needs moving to make room.
- [[probe:freemem]]'s `free` records hold [[fn:KERNEL.GetFreeSpace]]'s figure beside `GlobalCompact`'s, and WinBox answers that 1K under Windows' (a known gap of the Rust replay); its `GlobalCompact` records agree.

## Inside Windows

[[read out]] `KRNL386.EXE` seg1 `1105`: the largest block DPMI has (`1333`, function 0500h), rounded down to 32 bytes and through `3fde`, so never more than FF0000h. Where that is less than asked for, or less than 80000h, it compacts the heap and discards what it can and asks again, answering the larger.

## Implementation

`crates/winbox-win16/src/pointers.rs` and `GlobalHeap` in `crates/winbox-machine/src/global.rs`.
