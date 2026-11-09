---
kind: function
module: USER
name: RepaintScreen
ordinal: 275
summary: The whole screen painted again.
versions:
  '3.1': exact
probes: [usermisc]
records: [repaint]
topics: [painting]
source: crates/winbox-win16/src/small_calls.rs
---

## Observed behaviour

- [[measured]] [[probe:usermisc]]: a window validated is then to be painted, its whole client area.

## Inside Windows

- [[read out]] `USER.EXE` seg1 `77a7`: the desktop invalidated, with erasing, and every window in it (`3ed7` with `RDW_INVALIDATE`, `RDW_ERASE` and `RDW_ALLCHILDREN`).

## Implementation

`crates/winbox-win16/src/small_calls.rs`. The desktop and every window shown marked to be erased and painted, their frames left, as `RDW_FRAME` is not among the flags: the desktop's own marking for the system colours changed (`desktop.ts`'s `repaintAll`, `crates/winbox-win16/src/desktop.rs`'s `repaint_all_frames`) without the frames.
