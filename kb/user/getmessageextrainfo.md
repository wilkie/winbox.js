---
kind: function
module: USER
name: GetMessageExtraInfo
ordinal: 288
summary: The extra information of the hardware event the task last took: nought here.
versions:
  '3.1': partial
probes: [usermisc]
records: [extra]
topics: [system-queue]
source: crates/winbox-win16/src/small_calls.rs
---

## Observed behaviour

- [[measured]] [[probe:usermisc]]: nought after a posted message is taken.

## Inside Windows

- [[read out]] `USER.EXE` seg1 `81bb`: the task's queue's double word at 18h, which a look sets from the event it takes from the system's queue (seg1 `3037`) -- the extra information the keyboard or mouse driver gave the event.

## Implementation

`src/win16/user/small-calls.ts`; the Rust engine's `crates/winbox-win16/src/small_calls.rs`. Nought: WinBox's input events carry no extra information.
