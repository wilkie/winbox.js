---
kind: function
module: KERNEL
name: LocalHandleDelta
ordinal: 310
summary: How many handles the running data segment's local heap makes room for at a time — 32 until set; nought asks without setting.
source: crates/winbox-win16/src/pointers.rs
topics: [kernel-internals, global-and-local-memory]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg2 `2a0c` (`KRNL286.EXE` seg2 `2a00`). One word, popped. It acts on the local heap of DS: a delta not nought becomes the number of handles the heap's next handle table is made with, and the delta in force is answered.
- The source notes [[probe:freemem]] recorded it: 32 until it is set.
- [[read out]] No file of the installations or the corpus imports it, and no SDK header in the census's source declares it (`kb/data/kernel-callers.json`).

## Implementation

`LocalHandleDelta` in `src/win16/kernel/memory-info.ts`, kept with each heap. See [[topic:kernel-internals]].
