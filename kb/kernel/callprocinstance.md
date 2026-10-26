---
kind: function
module: KERNEL
name: CallProcInstance
ordinal: 53
summary: A procedure jumped to through an instance, as a MakeProcInstance thunk jumps: ES:BX the instance and the procedure.
versions:
  '3.1': exact
probes: [kmore]
records: [cpi]
source: src/win16/kernel/more-calls.ts
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `4927`-`4938`. ES:BX points at a word, the instance, and the procedure's far address after it. AX is the instance's selector -- the word itself where it is odd, one more where it is a handle -- or DS where it is nought; DS is left as it was; and the procedure is jumped to, so that it returns straight to the caller. The registers are its arguments; nothing is taken from the stack.
- [[measured]] [[probe:kmore]]: through nought the procedure finds AX the caller's DS; through 1234h and 1235h, AX 1235h; DS the caller's each time.

## Implementation

`src/win16/kernel/more-calls.ts`, and the Rust engine's `crates/winbox-win16/src/kernel_calls/more.rs`.
