---
kind: function
module: USER
name: LockWindowUpdate
ordinal: 294
summary: Keeps one window's drawing off the screen until it is unlocked, then has what it drew painted again.
versions:
  '3.1': exact
probes: [lockupd]
source: src/win16/user/lock-window-update.ts
topics: [painting]
---

## Observed behaviour

[[probe:lockupd]] locks one of two windows and draws a black square on each through [[fn:USER.GetDC]]. It reads the screen, and asks [[fn:USER.GetUpdateRect]] what is to be painted.

- [[measured]] Locking answers 1. Locking while a window is locked answers nought, whether it is the same window or another. Unlocking with nothing locked answers nought.
- [[measured]] What the locked window's device context draws does not show on the screen. The other window draws as usual.
- [[measured]] Nothing is made invalid while the window is locked. Unlocking makes invalid the rectangle that was drawn, 0,0 to 20,20, not the whole window. It is then painted as any invalid part is, so the window's background covers where the square would have been.
- [[measured]] After unlocking, drawing shows again.

winbox.js agrees with all 14 records. While a window is locked, `GetDC` gives it a bitmap of its own, the size of its client area, which keeps the rectangle drawn on.

## Nuances

- Not recorded: the locked window's children, and `BeginPaint` while it is locked.
