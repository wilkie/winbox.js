---
kind: function
module: KERNEL
name: GetCodeInfo
ordinal: 104
summary: A segment's entry in its module's table: where it is in the file, its size, flags, memory and handle.
versions:
  '3.1': exact
probes: [ktask2]
records: [code]
source: src/win16/kernel/code-calls.ts
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `48bd`-`48f7`. The procedure can be an address, through a thunk, or a module's handle with a segment number. Ten bytes of the module's table are copied: the segment's sector in the file, its size there, its flags, its memory and its handle. The file's sector shift follows. For the module's data segment, the heap and stack are added to the memory. AX is left holding the shift, or for the data segment the heap and stack.
- [[measured]] [[probe:ktask2]]: the probe's segments as its file gives them, the code segment's handle, a shift of 1, and 2400h in AX for the data segment.

## Nuances

- KERNEL keeps bits of its own in its copy of the flags, which the probe does not record. winbox.js gives the file's flags.

## Implementation

`src/win16/kernel/code-calls.ts`, and the Rust engine's `crates/winbox-win16/src/kernel_calls/code.rs`.
