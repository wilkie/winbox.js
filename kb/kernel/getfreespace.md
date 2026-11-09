---
kind: function
module: KERNEL
name: GetFreeSpace
ordinal: 169
summary: The bytes free in the global heap, counting what DPMI could still give and what could be discarded; on WinBox, the oracle's machine as a program found it.
versions:
  '3.1': partial
probes: [galimit, freemem]
source: src/win16/kernel/GetFreeSpace.ts
topics: [global-and-local-memory]
---

## Observed behaviour

- [[measured]] [[probe:galimit]], under DOSBox in standard mode: EBB4E0h as the probe starts. A block held makes it less by the block's size as given, 20h for one byte, 101000h for 100001h, and once the block is freed it answers as before. A request [[fn:KERNEL.GlobalAlloc]] refuses leaves it as it was. At the probe's end, everything freed, it answers EBB4E0h again.
- [[measured]] In 386 enhanced mode, [[probe:galimit]] is told 38F5C60h as it starts, about 56 MB on the same 16 MB machine: WIN386 gives KERNEL virtual memory, its swap file's pages with the machine's. [[probe:freemem]] is told 58,328K, and [[probe:enhmode]] 58,324K. A WinBox machine made in enhanced mode starts from 38F5C60h ([[topic:global-and-local-memory]], "How much there is").
- [[measured]] [[probe:freemem]]: 15,086K, against [[probe:galimit]]'s 15,085K. `freemem`'s code and data segments are 3A0h and 80h bytes smaller, 420h together, which is the difference: EBB4E0h and 420h is 15,086K and a quarter.

## Nuances

- The figure is the machine's: how much DPMI has and how much of it Windows has used. WinBox answers the oracle's machine as [[probe:galimit]] found it, less what has been held since a program first asked for memory or how much there is (see How much there is, in [[topic:global-and-local-memory]]). A program's own segments are not counted, so a program larger or smaller than `galimit` is told what `galimit` was told: [[probe:freemem]] is told 15,085K, a K under Windows' 15,086K, in both modes (58,327K in enhanced mode, against 58,328K). The Rust replay holds those records as a known gap ([[guide:retire-typescript]]).
- [[read out]] Discardable blocks that are not locked count as free, so allocating one leaves the figure as it was. WinBox takes every block held from it. Not yet measured.

## Inside Windows

[[read out]] `KRNL386.EXE` seg1 `0404` checks the flags against EFFDh only to report a bad parameter, and goes on to `12ae`. That starts from what DPMI's function 0500h says is free (`1333`), and walks the global heap's arenas, adding each free one and, unless flag 2 is given, each discardable block whose lock count is nought. Without flag 2 it takes away a reserve KERNEL keeps, then 10000h in any case, and answers nought rather than less.

## Implementation

`src/win16/kernel/GetFreeSpace.ts` and `src/win16/kernel/memory-model.ts`; the Rust engine's `pointers.rs` and `GlobalHeap` in `crates/winbox-machine/src/global.rs`.
