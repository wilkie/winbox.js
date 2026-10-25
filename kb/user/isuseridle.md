---
kind: function
module: USER
name: IsUserIdle
ordinal: 333
summary: Whether the user is idle: nought with a mouse button down; the screen saver started where its time has come.
versions:
  '3.1': exact
probes: [usermisc]
records: [idle]
topics: [system-parameters]
source: src/win16/user/small-calls.ts
---

## Observed behaviour

- [[measured]] [[probe:usermisc]]: 1, with no button down.

## Inside Windows

- [[read out]] `USER.EXE` seg1 `334e`-`33ff`: nought where `GetAsyncKeyState` has the left, right or middle button down; else, with no window system-modal, the screen saver's delay set and input noted, more than the delay gone since, and a window active -- not a DOS program's in 386 enhanced mode -- that window posted `WM_SYSCOMMAND` with `SC_SCREENSAVE` and the input forgotten; 1. It is USER's own look every ten seconds (seg1 `3400`; [[topic:system-parameters]]).

## Implementation

`src/win16/user/small-calls.ts`; the Rust engine's `crates/winbox-win16/src/small_calls.rs`. The screen saver's look the timer runs (`screen-saver.ts`, `screen_saver.rs`).
