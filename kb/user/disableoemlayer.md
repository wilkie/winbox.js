---
kind: function
module: USER
name: DisableOEMLayer
ordinal: 4
summary: Gives the screen and the input up to a full-screen DOS program: the cursor hidden, the drivers disabled, the system queue emptied.
versions:
  '3.1': exact
probes: [oemlayer]
source: src/win16/user/internals.ts
topics: [user-internals]
---

## Observed behaviour

- [[measured]] [[probe:oemlayer]]: `ShowCursor`'s count one less after it; a message the probe posted to its own window before is still in its queue after [[fn:USER.EnableOEMLayer]]. The display is turned off and on again under the recorder, and nothing else of it shows.

## Inside Windows

- [[read out]] `USER.EXE` seg5 `01a2`-`01c0`: [[fn:USER.ShowCursor]] with FALSE (seg1 `150c`); USER's own disabling, seg5 `00d4`-`0164`; GDI's `Death` (GDI 121) on USER's screen context.
- [[read out]] The disabling (seg5 `00d4`): every installable driver sent `DRV_DISABLE` (seg2 `04cc`, message 5, flags 6); the procedure at 54h of the record at `[362h]`; the sound driver's `disable`; `MOUSE`'s `Disable` where a mouse is there; [[fn:KEYBOARD.Disable]]; `DisableSystemTimers` (SYSTEM 5); then the queue whose selector is at 0 of the segment at `[4A4h]` read empty with `PM_REMOVE` (`0143`-`0160`) -- not the program's own, which keeps its message.

## Callers

- [[read out]] Standard mode's `WINOLDAP.MOD` imports it (`kb/data/user-callers.json`). No corpus program does.

## Implementation

`src/win16/user/internals.ts`; `crates/winbox-win16/src/user_internals.rs`. The cursor's count goes down and the system queue -- the keyboard's and the mouse's input not yet taken -- is emptied. WinBox's display is not turned off and its keyboard, mouse and timers are its own, so nothing else is done; GDI's [[fn:GDI.Death]] answers as the display's driver would and changes nothing either.
