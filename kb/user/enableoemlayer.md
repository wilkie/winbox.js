---
kind: function
module: USER
name: EnableOEMLayer
ordinal: 3
summary: Takes the screen and the input back after a full-screen DOS program: the key states cleared, every window repainted, the cursor shown.
versions:
  '3.1': exact
probes: [oemlayer]
source: src/win16/user/internals.ts
topics: [user-internals]
---

## Observed behaviour

- [[measured]] [[probe:oemlayer]], called right after [[fn:USER.DisableOEMLayer]]: `ShowCursor`'s count is back where it was; every window -- the probe's and its child -- is sent `WM_NCPAINT`, `WM_ERASEBKGND` and `WM_PAINT` once each as the probe dispatches; no key is down after (`GetKeyState(VK_SHIFT)` nought); a message posted to the probe before `DisableOEMLayer` is still in its queue.

## Inside Windows

- [[read out]] `USER.EXE` seg5 `0165`-`01a1`: GDI's `Resurrection` (GDI 122) on USER's screen context with six noughts; USER's own enabling, seg5 `0000`-`00be`; `RedrawWindow`'s body (seg1 `3e1e`) for the desktop, its window at `[0F0h]`, with `RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN | RDW_FRAME` (485h); then [[fn:USER.ShowCursor]] with TRUE (seg1 `150c`).
- [[read out]] The enabling (seg5 `0000`): `EnableSystemTimers` (SYSTEM 4); the 256 bytes at 246h -- the key state table [[fn:USER.GetKeyState]] reads -- and the words from 6 to 46h of the segment at `[46h]` cleared (`000a`-`0040`); [[fn:KEYBOARD.Enable]] with `keybd_event` (seg1 `4b59`) and the table; seg1 `17aa`; `MOUSE`'s `Enable` with `mouse_event` (seg1 `507a`) where a mouse is there (`[69Ch]`); the sound driver's `enable`, found by name with `GetModuleHandle("sound")` and `GetProcAddress`; the procedure at 50h of the record at `[362h]`, where there is one; and every installable driver sent `DRV_ENABLE` (seg2 `04cc`, message 2, flags 4).
- [[read out]] `RepaintScreen` (seg1 `77a7`) is the same redraw of the desktop without `RDW_FRAME`.

## Callers

- [[read out]] Standard mode's `WINOLDAP.MOD` imports it (`kb/data/user-callers.json`), to take the screen back from a DOS program it ran full screen. No corpus program does.

## Implementation

`src/win16/user/internals.ts`; the Rust engine's `crates/winbox-win16/src/user_internals.rs`. WinBox's display was never turned off and its drivers are its own: the key states are cleared, every window is marked for its frame, background and client as `RepaintScreen` marks them but with the frames (`repaintAll(true)`, `repaint_all_frames(true)`), and the cursor's count goes up. Not followed: installable drivers' `DRV_ENABLE` (WinBox's USER loads none of its own at start).
