---
kind: function
module: KERNEL
name: GlobalNotify
ordinal: 154
summary: Names the procedure KERNEL calls before it discards one of the task's notifying blocks to make room; answers nothing.
versions:
  '3.1': unrecorded
source: src/win16/kernel/misc.ts
topics: [global-and-local-memory]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` (seg1 `1171`, after the check at `034c` that the pointer is to code) keeps the far pointer in the current task's database, at offset `2Eh`, and returns with `retf 4`, answering nothing. A second call replaces the first.
- [[measured]] Paintbrush names one as it starts, just after loading its accelerators.

## Nuances

- [[documented]] The procedure is called only for a block allocated with `GMEM_NOTIFY`, when KERNEL discards it to make room.

## Implementation

The pointer is kept on the task. winbox.js never discards a block to make room: a block is discarded only when a program asks, with `GlobalReAlloc` to nothing. So the procedure is never called.
