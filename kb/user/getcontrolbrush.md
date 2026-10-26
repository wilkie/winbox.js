---
kind: function
module: USER
name: GetControlBrush
ordinal: 326
summary: The brush a control of a kind paints with, asked of its parent with WM_CTLCOLOR.
versions:
  '3.1': exact
probes: [usermisc]
records: [brush]
topics: [standard-controls]
source: src/win16/user/small-calls.ts
---

## Observed behaviour

- [[measured]] [[probe:usermisc]]: a child's parent is sent `WM_CTLCOLOR` with the device context, the child and the type, and its brush is answered; a pop-up's owner is asked; a top-level window asks the desktop.

## Inside Windows

- [[read out]] `USER.EXE` seg6 `02d2`: the window's owner for a pop-up, else its parent, itself where it has neither; then `028c`: `WM_CTLCOLOR` sent, and `DefWindowProc`'s answer where the answer is no GDI object ([[topic:standard-controls]]).

## Implementation

`src/win16/user/small-calls.ts`; the Rust engine's `crates/winbox-win16/src/small_calls.rs`.
