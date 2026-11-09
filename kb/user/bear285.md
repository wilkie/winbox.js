---
kind: function
module: USER
name: Bear285
ordinal: 285
summary: USER's data segment's selector, left in AX.
versions:
  '3.1': exact
probes: [userint]
records: [bear]
topics: [small-queries]
source: crates/winbox-win16/src/small_calls.rs
---

## Observed behaviour

- [[measured]] [[probe:userint]]: one more than the desktop window's instance. The desktop window's instance, as `GetWindowWord` reads it, is USER's: one below its data segment's selector, as a moveable data segment's handle is.

## Inside Windows

- [[read out]] `USER.EXE` seg41 `1736`: DS saved, USER's data segment's selector loaded into AX and DS, DS put back, and return popping four bytes: nothing else is done, and AX is left as the selector.

## Implementation

`src/win16/user/small-calls.ts`; the Rust engine's `crates/winbox-win16/src/small_calls.rs`. The desktop window's instance is answered by `window-words.ts` and `window_queries.rs`.
