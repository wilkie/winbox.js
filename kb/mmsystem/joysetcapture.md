---
kind: function
module: MMSYSTEM
name: joySetCapture
ordinal: 106
summary: Sends a window a joystick's moves and buttons, polled on a timer.
versions:
  '3.1': exact
probes: [mmmisc]
records: [joy]
source: src/win16/mmsystem/joystick.ts
topics: [multimedia-services]
---

## Observed behaviour

- [[measured]] [[probe:mmmisc]]: for no window, `JOYERR_PARMS` (A5h), before the driver is looked for; for the probe's window, 6, there being no driver.

## Inside Windows

- [[read out]] seg8 `13e`: no window, or one that is none, A5h; no driver 6; past the count A5h; a capture by a window still there `JOYERR_NOCANDO` (A6h), one gone released. The capabilities and the position asked, the period kept between the driver's least and most, and a timer set whose procedure (seg8 `30b`) posts `MM_JOY1BUTTONDOWN` or `UP` for each button changed and `MM_JOY1MOVE` -- every time, or, asked for changes only, past the threshold, else `MM_JOY1ZMOVE`.

## Implementation

Both engines, as read out: `src/win16/mmsystem/joystick.ts` and `crates/winbox-win16/src/mmsystem/joystick.rs`.
