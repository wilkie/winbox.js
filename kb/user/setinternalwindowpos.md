---
kind: function
module: USER
name: SetInternalWindowPos
ordinal: 461
summary: A window's normal place and its icon's point set, then shown as asked.
versions:
  '3.1': partial
probes: [intpos]
records: [set, get]
topics: [window-states]
source: crates/winbox-win16/src/window_state.rs
---

## Observed behaviour

- [[measured]] [[probe:intpos]]:
  - With a rectangle, for a window shown normally: the window moved there; 1. The point not given, it has none: -1,-1 after.
  - With a point and `SW_SHOWMINIMIZED`: the window minimized with its icon at the point, (100, 400), 36 square.
  - Restored with neither: the window back at the rectangle given before, and the point where its icon was.

## Inside Windows

- [[read out]] `USER.EXE` seg14 `0aef`-`0bef`: the rectangle, where given, copied as its normal place; the point, where given and its x not -1, kept as the icon's, else -1,-1 and none (`0b3c`-`0b5e`). An icon with a point is moved there (`SWP_NOSIZE`, `SWP_NOZORDER`, `SWP_NOACTIVATE`); a window neither an icon nor maximized is moved to the rectangle (`SWP_NOZORDER`). Then it is shown as asked (seg14 `0bf2`), and 1 answered.

## Implementation

`src/win16/user/placement.ts`; the Rust engine's `window_state.rs`. Not followed: seg1 `6e25`, called round the showing, which was not read out.
