---
kind: function
module: USER
name: GetMessage2
ordinal: 323
summary: The function GetMessage and PeekMessage are made of: a message looked for, waiting or not.
versions:
  '3.1': exact
probes: [usermisc]
records: [getmessage2]
topics: [system-queue]
source: src/win16/user/small-calls.ts
---

## Observed behaviour

- [[measured]] [[probe:usermisc]]: not waiting, as [[fn:USER.PeekMessage]] with its flags: 1 and the message, left or taken; nought with none. Waiting, as [[fn:USER.GetMessage]]: 1 and the message. `WM_QUIT` is 1 not waiting and nought waiting.

## Inside Windows

- [[read out]] `USER.EXE` seg1 `244f`-`25d5`: the message, the window, the range and the flags as `PeekMessage` takes them, then whether to wait. `PeekMessage` jumps to it with nought for that (`2440`), `GetMessage` with 1 and `PM_REMOVE` (`2446`). Waiting, `WM_QUIT` answers nought (`25bc`-`25cf`).

## Implementation

`src/win16/user/small-calls.ts`; the Rust engine's `crates/winbox-win16/src/small_calls.rs`. Not waiting, `PeekMessage`; waiting and removing, `GetMessage`; waiting and not removing, the queue's look waiting without taking.
