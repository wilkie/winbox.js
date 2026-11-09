---
kind: function
module: USER
name: Hardware_Event
ordinal: 481
summary: Puts a driver's event in the system queue from registers, reading the queue's selector from DS: from a program, nought, nothing put.
versions:
  '3.1': exact
probes: [hwevent]
source: crates/winbox-win16/src/user_internals.rs
topics: [user-internals, system-queue]
---

## Observed behaviour

- [[measured]] [[probe:hwevent]], AX a message of the program's own, CX and DX two words, SI and DI the extra information, DS USER's data segment (ordinal 285's answer): nought, and nothing for `PeekMessage` to take, for each of three extra informations.

## Inside Windows

- [[read out]] `USER.EXE` seg1 `4d6c`: a near call of `4d70` and `retf`. That is the routine `keybd_event` and `mouse_event` put their events in with (`4c82`), whose DS is USER's segment 44: AX the message, CX `paramL`, DX `paramH`, SI and DI the extra information; the room checked (`4db8`, the queue's selector read from DS:0 at `4def`), the time from `GetSystemMsecCount`, and `5480` with the selector at DS:0 (`4d84`). No export names segment 44; a program's DS -- even USER's data segment, segment 45 -- holds no queue's selector at 0, the queue's read faults inside USER, and USER's own `__GP` handlers ([[fn:USER.__GP]]) answer: nought.

## Callers

- No file of the installations or the corpus imports it (`kb/data/user-callers.json`).

## Implementation

In both engines nought, nothing put: what a program finds (`src/win16/user/internals.ts`, `user_internals.rs`). WinBox's input is its own drivers', put in the system queue directly ([[topic:system-queue]]).
