---
kind: function
module: MMSYSTEM
name: joyGetDevCaps
ordinal: 102
summary: A joystick's capabilities: its driver's JDD_GETDEVCAPS.
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

- [[read out]] seg8 `1a`: 6 with no driver; a joystick past the count `JOYERR_PARMS` (A5h); else `JDD_GETDEVCAPS` (802h) to the joystick's driver, with the buffer and its size, nothing checked of either.

## Implementation

As read out: `crates/winbox-win16/src/mmsystem/joystick.rs`.
