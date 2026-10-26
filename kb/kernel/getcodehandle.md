---
kind: function
module: KERNEL
name: GetCodeHandle
ordinal: 93
summary: The handle of the code segment a procedure is in, in AX, and its selector in DX.
versions:
  '3.1': exact
probes: [ktask2]
records: [code]
source: src/win16/kernel/code-calls.ts
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `48fa`-`4924`. A thunk from `MakeProcInstance`, `MOV AX` then `JMP FAR`, is followed to its procedure (`4865`-`4883`). The segment is found in its module's table and loaded, and its handle and selector are answered.
- [[measured]] [[probe:ktask2]]: the probe's code segment's handle in AX and its selector in DX, for a procedure and for its thunk alike.

## Implementation

`src/win16/kernel/code-calls.ts`, and the Rust engine's `crates/winbox-win16/src/kernel_calls/code.rs`.
