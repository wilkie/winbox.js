---
kind: function
module: MMSYSTEM
name: joyReleaseCapture
ordinal: 105
summary: Stops sending a window a joystick's messages.
versions:
  '3.1': exact
probes: [mmmisc]
records: [joy]
source: crates/winbox-win16/src/mmsystem/joystick.rs
topics: [multimedia-services]
---

## Observed behaviour

- [[measured]] [[probe:mmmisc]], on both installations, neither with a joystick driver: `MMSYSERR_NODRIVER` (6) for joysticks 0, 1 and 2.

## Inside Windows

- [[read out]] seg8 `ec`: the checks; with a window capturing, its timer killed and the capture forgotten.

## Implementation

Both engines, as read out: `src/win16/mmsystem/joystick.ts` and `crates/winbox-win16/src/mmsystem/joystick.rs`.
