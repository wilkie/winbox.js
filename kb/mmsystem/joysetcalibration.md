---
kind: function
module: MMSYSTEM
name: joySetCalibration
ordinal: 109
summary: Passes a joystick's calibration to its driver, and gives back the driver's.
versions:
  '3.1': exact
probes: [mmmisc]
records: [joy]
source: crates/winbox-win16/src/mmsystem/joystick.rs
topics: [multimedia-services]
---

## Observed behaviour

- [[measured]] [[probe:mmmisc]], on both installations, neither with a joystick driver: `MMSYSERR_NODRIVER` (6) for joysticks 0, 1 and 2.
- [[measured]] The six words are left as they were.

## Inside Windows

- [[read out]] seg8 `251`: the checks; the six words copied into MMSYSTEM's frame, sent as `JDD_SETCALIBRATION` (902h), and the six the driver writes copied back.

## Implementation

As read out: `crates/winbox-win16/src/mmsystem/joystick.rs`.
