---
kind: function
module: KERNEL
name: SetSwapAreaSize
ordinal: 106
summary: The room for code to be swapped through, given in paragraphs; the room had in AX, its most in DX.
versions:
  '3.1': exact
probes: [ktask2]
records: [small]
source: crates/winbox-win16/src/kernel_calls/code.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `2ede`-`2f25`. The size given is clipped to the most, the word at 24Fh of KERNEL's data. Unless nought, it is made the room, kept at 3Ch of a segment of KERNEL's, if a call in seg3 can grow to it; otherwise the room it had stays. AX is the room, DX the most.
- [[measured]] [[probe:ktask2]]: nought given, nought in AX and FFFFh in DX.

## Nuances

- winbox.js swaps no code. It answers FFFFh as the most, and keeps a size given as the room, which no probe has measured.

## Implementation

`src/win16/kernel/code-calls.ts`, and the Rust engine's `crates/winbox-win16/src/kernel_calls/code.rs`.
