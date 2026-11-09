---
kind: function
module: USER
name: Bear182
ordinal: 182
summary: KillTimer for a system timer.
versions:
  '3.1': exact
probes: [systimer]
source: crates/winbox-win16/src/queue.rs
topics: [user-internals]
---

## Observed behaviour

- [[measured]] [[probe:systimer]]: 1 for a system timer there, nought once it is gone; `KillTimer` of the same identifier does not stop it, nor it a `WM_TIMER` timer.

## Inside Windows

- [[read out]] `USER.EXE` seg1 `74f4`: `mov cx,1` and into `KillTimer`'s body at `74f7` (`KillTimer` enters at `74f0` with CX nought): the entry found by window, identifier and flag (`759c`), emptied (`753d`), and the last entries trimmed (`751a`).

## Callers

- No file of the installations or the corpus imports it (`kb/data/user-callers.json`).

## Implementation

`src/win16/user/SetTimer.ts`; `crates/winbox-win16/src/queue.rs` (`kill_timer_as`).
