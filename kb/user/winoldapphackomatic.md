---
kind: function
module: USER
name: WinOldAppHackomatic
ordinal: 322
summary: For WINOLDAP: a flag of USER's menus set; nought answered.
versions:
  '3.1': exact
probes: [userint]
records: [winoldap]
topics: [menus]
source: src/win16/user/small-calls.ts
---

## Observed behaviour

- [[measured]] [[probe:userint]]: nought for nought and 1, and for 5 and 5.

## Inside Windows

- [[read out]] `USER.EXE` seg41 `0e6e`: with nought and 1, `[170h]` set to 1, which USER's menu code reads (seg10 `065f`, `1aa3`); DX:AX nought.

## Implementation

`src/win16/user/small-calls.ts`; the Rust engine's `crates/winbox-win16/src/small_calls.rs`. The flag is kept; WinBox has no DOS program's window for it to matter to.
