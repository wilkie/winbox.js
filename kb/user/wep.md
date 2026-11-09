---
kind: function
module: USER
name: WEP
ordinal: 8
summary: USER's exit procedure: 1.
versions:
  '3.1': unrecorded
source: crates/winbox-win16/src/user.rs
---

## Inside Windows

- [[read out]] `USER.EXE` seg3 `0232`: `MOV AX, 1`, popping the word. Not recorded.

## Implementation

`src/win16/user.ts`'s table; the Rust engine's `user.rs`.
