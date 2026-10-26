---
kind: function
module: USER
name: GetWindowPlacement
ordinal: 370
summary: A window's placement from USER's checkpoint: how it is shown, its icon's and maximized points as they are or last were, its normal rectangle.
versions:
  '3.1': exact
probes: [wplace]
records: [place]
source: src/win16/user/placement.ts
---

## Observed behaviour

- [[read out]] `USER.EXE` seg14 `0fde`-`100b`, `06a5`-`0738`: the window's checkpoint (`0664`) copied: `showCmd` 2 for a minimized window, 3 for a maximized one, else 1; the icon's point and the maximized one; the flags `WPF_SETMINPOSITION` where the checkpoint says, and `WPF_RESTORETOMAXIMIZED` where it says or the window is maximized; the normal rectangle.
- [[measured]] [[probe:wplace]]: -1,-1 for each point until the window has been an icon or maximized, then where it is or last was, as [[fn:USER.GetInternalWindowPos]] gives the icon's; the flags 2 while maximized.

## Implementation

`src/win16/user/placement.ts`, and the Rust engine's `window_state.rs`.
