---
kind: function
module: USER
name: GetInternalWindowPos
ordinal: 460
summary: A window's show state, its normal place and its icon's point.
versions:
  '3.1': exact
probes: [intpos]
records: [get]
topics: [window-states]
source: crates/winbox-win16/src/window_state.rs
---

## Observed behaviour

- [[measured]] [[probe:intpos]], on an overlapped window made at (30, 40), 200 by 120:
  - It answers 1 for a window shown normally, 2 minimized, 3 maximized -- `SW_SHOWNORMAL`, `SW_SHOWMINIMIZED`, `SW_SHOWMAXIMIZED`.
  - The rectangle is its place restored: 30,40,230,160 while it is minimized or maximized too.
  - The point is -1,-1 until the window has been an icon. Minimized, it is where the icon is, (21, 408) on the VGA; restored and maximized after, it is still that, where the icon last was.

## Inside Windows

- [[read out]] `USER.EXE` seg14 `0a85`-`0aec`: a `WINDOWPLACEMENT` filled by seg14 `06a5` -- what [[fn:USER.GetWindowPlacement]] gives -- and its `showCmd` answered, its `rcNormalPosition` copied to the rectangle and its `ptMinPosition` to the point, each where given.

## Implementation

`crates/winbox-win16/src/window_state.rs`. The icon's point is kept as the window stops being an icon (`crates/winbox-win16/src/desktop.rs`). WinBox's `GetWindowPlacement` still answers -1,-1 for it.
