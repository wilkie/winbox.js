---
kind: function
module: KERNEL
name: SwitchStackTo
ordinal: 108
summary: The stack moved into a segment of the program's own, the caller's frame copied.
versions:
  '3.1': exact
probes: [kmore]
records: [stack]
source: src/win16/kernel/more-calls.ts
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `11c6`-`123b`. The return address and the three arguments -- the segment, the stack pointer and the top -- are taken off, and the old BP pushed on the old stack. The new segment's header is written: the old SP at 2 and SS at 4, the top at 0Ah, and the pointer at 0Ch and 0Eh. SS:SP and BP become the segment and the pointer; a nought is pushed, then the words of the caller's frame from BP-4 down to SP are copied, so that the caller's locals are where BP finds them, all but BP-2. The task's database's SS:SP (TDB 4, 2) are the new ones. AX is nought, BX the pointer, CX nought and DX the segment as it returns.
- [[measured]] [[probe:kmore]]: from a frame of three words, SS is the segment, SP EFAh for a pointer of F00h, BP F00h; through BP the frame reads nought, 2222h and 3333h; the header holds 0, the old SP less two, the old SS, 0, 0, 100h, F00h and F00h.

## Nuances

- The frame copied is from the caller's BP down to SP: code that keeps no frame in BP gets as many words copied as lie between the two.

## Implementation

`src/win16/kernel/more-calls.ts`, and the Rust engine's `crates/winbox-win16/src/kernel_calls/more.rs`.
