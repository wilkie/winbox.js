---
kind: function
module: MMSYSTEM
name: joyGetPos
ordinal: 103
summary: A joystick's position and buttons: its driver's JDD_GETPOS.
versions:
  '3.1': exact
probes: [mmmisc]
records: [joy]
source: src/win16/mmsystem/joystick.ts
topics: [multimedia-services]
---

## Observed behaviour

- [[measured]] [[probe:mmmisc]], on both installations, neither with a joystick driver: `MMSYSERR_NODRIVER` (6) for joysticks 0, 1 and 2.

## Inside Windows

- [[read out]] seg8 `73`: as `joyGetDevCaps`, with `JDD_GETPOS` (901h).

## Implementation

Both engines, as read out: `src/win16/mmsystem/joystick.ts` and `crates/winbox-win16/src/mmsystem/joystick.rs`.
