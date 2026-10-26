---
kind: function
module: KERNEL
name: SwitchStackBack
ordinal: 109
summary: Back to the stack SwitchStackTo left, the words that found it cleared.
versions:
  '3.1': exact
probes: [kmore]
records: [stack]
source: src/win16/kernel/more-calls.ts
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `123c`-`127d`: SS:SP are taken from the words at 4 and 2 of the stack's segment, which are cleared; the task's database's SS:SP are the old ones; BP is popped from the old stack, and the call returns there. AX is left; BX is the old SS and CX the old SP.
- [[measured]] [[probe:kmore]]: SS, SP and BP as they were before `SwitchStackTo`, AX as it was given (7777h), and the header's words at 2 and 4 nought.

## Implementation

`src/win16/kernel/more-calls.ts`, and the Rust engine's `crates/winbox-win16/src/kernel_calls/more.rs`.
