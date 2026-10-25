---
kind: function
module: USER
name: GetMouseEventProc
ordinal: 337
summary: The procedure the mouse driver tells USER of events by: mouse_event's own address.
versions:
  '3.1': exact
probes: [userint]
records: [mouseproc]
topics: [mouse-input]
source: src/win16/user/small-calls.ts
---

## Observed behaviour

- [[measured]] [[probe:userint]]: the address `GetProcAddress` answers for `mouse_event`.

## Inside Windows

- [[read out]] `USER.EXE` seg1 `530a`: DX its code segment, AX 507Ah, where [[fn:USER.Mouse_Event]] starts.

## Implementation

`src/win16/user/small-calls.ts`; the Rust engine's `crates/winbox-win16/src/small_calls.rs`.
