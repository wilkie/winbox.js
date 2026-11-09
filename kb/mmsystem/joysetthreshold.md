---
kind: function
module: MMSYSTEM
name: joySetThreshold
ordinal: 107
summary: Sets the distance a joystick must move to be reported.
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

- [[read out]] seg8 `21d`: the checks, then the threshold kept.

## Implementation

As read out: `crates/winbox-win16/src/mmsystem/joystick.rs`.
