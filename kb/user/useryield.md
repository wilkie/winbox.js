---
kind: function
module: USER
name: UserYield
ordinal: 332
summary: Messages other tasks sent answered, and the processor given to the others.
versions:
  '3.1': exact
probes: [usermisc]
records: [idle]
topics: [several-programs]
source: crates/winbox-win16/src/small_calls.rs
---

## Observed behaviour

- [[measured]] [[probe:usermisc]]: it returns.

## Inside Windows

- [[read out]] `USER.EXE` seg1 `3df2`: while the queue says a message was sent it, answered (`3b7a`); KERNEL's `OldYield`; the same again.

## Implementation

`src/win16/user/small-calls.ts`; the Rust engine's `crates/winbox-win16/src/small_calls.rs`.
