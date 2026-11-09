---
kind: function
module: USER
name: LockWindowUpdate
ordinal: 294
summary: Keeps one window and those in it from drawing on the screen until it is unlocked, then has what was drawn over made due through the desktop.
versions:
  '3.1': partial
probes: [lockupd, vislock]
source: crates/winbox-win16/src/user_calls/lock_update.rs
topics: [painting, visible-regions]
---

## Observed behaviour

[[probe:lockupd]] locks one of two windows and draws a black square on each through [[fn:USER.GetDC]]. It reads the screen, and asks [[fn:USER.GetUpdateRect]] what is to be painted.

- [[measured]] Locking answers 1. Locking while a window is locked answers nought, whether it is the same window or another. Unlocking with nothing locked answers nought.
- [[measured]] What the locked window's device context draws does not show on the screen. The other window draws as usual.
- [[measured]] Nothing is made invalid while the window is locked. Unlocking makes invalid the rectangle that was drawn, 0,0 to 20,20, not the whole window. It is then painted as any invalid part is, so the window's background covers where the square would have been.
- [[measured]] After unlocking, drawing shows again.

[[probe:vislock]] locks a pop-up A, with a child K, between a pop-up C behind it and a pop-up B in front, and reads each window's update region and the screen. [[measured]]

- The locked window's `GetDC`, its `GetWindowDC` and its child's `GetDC` have an empty visible region and clip box, their origins as ever; `GetDCEx` with `DCX_LOCKWINDOWUPDATE` has the whole client area. What that one draws shows, and is not made due after.
- What A was due as it was locked is due no more while it is locked, and is due again after. What C was due, outside A's rectangle, is left alone.
- What A drew is due in A after; what K drew, in K and in A, which has no `WS_CLIPCHILDREN`. What B, in front, drew over A is due nowhere. What C, behind, drew where A lies is due in A, not in C.
- A's whole window drawn over through `GetWindowDC`: unlocking makes every window due all over.
- A made due all over while it is locked: painted, its `BeginPaint` rectangle and clip box are empty; unlocked, every window is due all over.

## Inside Windows

[[read out]] `USER.EXE` seg13 `2276`:

- A window's region is empty while it or a window it is in is locked, unless `DCX_LOCKWINDOWUPDATE` is given (seg1 `15c4`-`15df`). Locking and unlocking make the window's contexts stale (`22dd`, `2306`, seg1 `8aa0`).
- **The lock is kept as the bits a `CS_SAVEBITS` window saves are** (`1e72`, with flag 2 and no bits): the window's rectangle on the screen, and a region of what of it is still as it was, none -- all of it -- to start with. Off the screen, there is none.
- GDI keeps in every context the bounds of what it draws, Windows' own ([[fn:GDI.SetBoundsRect]] with 8000h), whatever shows. Locking empties them in every context USER lends (`1eaa`-`1ec3`). USER takes them back, emptying them, from a context it lends for another window (seg1 `8666`) or takes afresh (`868f`), from every context as a window is placed (seg7 `057a`), and as the window is unlocked (`22ee`); each cut to the context's window's rectangle (seg1 `06ff`).
- What is drawn counts against the lock (seg1 `087b`) where the window drawn in shows, the context has no `DCX_LOCKWINDOWUPDATE`, and the window is the locked window's parent; the locked window; one in it, where no window in front of it among its brothers covers the drawing one way across (`SubtractRect`); or one behind the locked window, where no window between them covers it. One in front does not count. What counts is taken out of what is still as it was (`079a`); where nothing is left, the lock lets go of its rectangle (`081c`).
- So is what is made due in a window there (seg1 `3f41`-`3f7c`), what a scroll moves over (seg13 `151f`-`159d`), and the places a window leaves and goes to (seg7 `09c2`-`09d5`, `05f0`-`0606`).
- **As it locks** (`2028`-`2063`), the parent and each window from the locked one back, with the windows in them, that is due within its rectangle and shows there has that part made due no more (`206b`: `RDW_VALIDATE | RDW_NOCHILDREN`) and counted as drawn.
- **Unlocking** (`22ee`-`2384`): the bounds taken back; the rectangle less what is still as it was made due through the desktop, `RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN` -- in the windows that show there, erased. Where the lock let go of its rectangle, or had none, everything is made due.
- [[read out]] Locking or unlocking while another task holds the lock answers nought (`2282`-`2294`). Not followed: WinBox does not ask whose task locked it.
- [[read out]] `BeginPaint`'s rectangle is its context's clip box (seg1 `78cd`): empty for the locked window.

## Nuances

- [[read out]] A window locked off the screen keeps no rectangle; unlocking it makes every window due. Not recorded.
- [[read out]] With `Edsun=` in `WIN.INI`'s `[Windows]` (`USER.EXE` seg3 `2236`-`2245`), the rectangle is two pixels wider each side (`1ee9`-`1ef7`). Not followed.

## Implementation

Both engines as read out: `src/win16/user/lock-window-update.ts` and `crates/winbox-win16/src/user_calls/lock_update.rs`, the bounds taken back where USER takes them (`dc-entries.ts`, `window-state.ts`, `InvalidateRect.ts`, and their twins). Both agree with all 14 records of [[probe:lockupd]] and all 58 of [[probe:vislock]]: its last three wait on [[fn:USER.InvalidateRect]] making a window's children due with it where it has no `WS_CLIPCHILDREN` (seg1 `40e8`-`4176`), [[fn:USER.UpdateWindow]] painting them after it (seg1 `444c`), and `BeginPaint`'s rectangle being its context's clip box (seg1 `78be`), empty for the locked window, as [[fn:USER.InvalidateRgn]] has them ([[probe:invchild]]). Before, the locked window's `GetDC` drew on a bitmap of its own to learn what was drawn, and answered its client area. The lock is one of USER's records, with the bits `CS_SAVEBITS` windows save (seg13 `1e72`; [[fn:USER.SetWindowPos]]): each is told what is drawn alike, `Kept` and `savesOf` (`Record` in Rust). [[fn:USER.RedrawWindow]] with `RDW_FRAME` tells the window's whole rectangle, not its client area's ([[probe:rdwmore]]).
