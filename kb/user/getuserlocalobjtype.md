---
kind: function
module: USER
name: GetUserLocalObjType
ordinal: 480
summary: What kind of USER object a local handle is: nought, whatever it is.
versions:
  '3.1': exact
probes: [userint]
records: [objtype]
topics: [small-queries]
source: src/win16/user/small-calls.ts
---

## Observed behaviour

- [[measured]] [[probe:userint]]: nought for 1234h.

## Inside Windows

- [[read out]] `USER.EXE` seg1 `1d38`: `XOR AX, AX` and return, popping the word. The debugging USER's tells; the retail one does not.

## Implementation

`src/win16/user/small-calls.ts`; the Rust engine's `crates/winbox-win16/src/small_calls.rs`.
