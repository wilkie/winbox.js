---
kind: function
module: MMSYSTEM
name: joyGetThreshold
ordinal: 104
summary: The distance a joystick must move to be reported, as MMSYSTEM keeps it.
versions:
  '3.1': exact
probes: [mmmisc]
records: [joy]
source: src/win16/mmsystem/joystick.ts
topics: [multimedia-services]
---

## Observed behaviour

- [[measured]] [[probe:mmmisc]], on both installations, neither with a joystick driver: `MMSYSERR_NODRIVER` (6) for joysticks 0, 1 and 2.
- [[measured]] The word asked for is left as it was.

## Inside Windows

- [[read out]] seg8 `b5`: the checks as `joyGetDevCaps`'s; then the threshold MMSYSTEM keeps, nought to begin with, written.

## Implementation

Both engines, as read out: `src/win16/mmsystem/joystick.ts` and `crates/winbox-win16/src/mmsystem/joystick.rs`.
