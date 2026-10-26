---
kind: function
module: USER
name: SetEventHook
ordinal: 321
summary: A procedure for USER's keyboard events to go through before they are queued.
versions:
  '3.1': partial
probes: [userint]
records: [eventhook]
topics: [keyboard-input]
source: src/win16/user/small-calls.ts
---

## Observed behaviour

- [[measured]] [[probe:userint]]: nought, the procedure before, the first time; the procedure set, when the first is put back; a pointer to no code refused, nought answered and nothing set.

## Inside Windows

- [[read out]] `USER.EXE` seg1 `5028`: exchanged with the far pointer at E2h of USER's fixed data, the old answered. A pointer that is not nought must be code (`LAR`, then a byte read), else `HandleParamError` and nought (`aeca`). The keyboard event's path calls it, an event refused where it sets the carry (seg1 `4b95`).

## Implementation

`src/win16/user/small-calls.ts`; the Rust engine's `crates/winbox-win16/src/small_calls.rs`. Not followed: calling it, as WinBox's keyboard input does not go through USER's event procedure.
