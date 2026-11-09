---
kind: function
module: MMSYSTEM
name: joyGetNumDevs
ordinal: 101
summary: How many joysticks the joystick driver has: 0 with none.
versions:
  '3.1': exact
probes: [mmmisc]
records: [joy]
source: crates/winbox-win16/src/mmsystem/joystick.rs
topics: [multimedia-services]
---

## Observed behaviour

- [[measured]] [[probe:mmmisc]]: 0 on both installations.

## Inside Windows

- [[read out]] seg8 `5d`: nought with no driver, else the count `JDD_GETNUMDEVS` (801h) gave as MMSYSTEM loaded (seg2 `886`).

## Implementation

Both engines, as read out: `src/win16/mmsystem/joystick.ts` and `crates/winbox-win16/src/mmsystem/joystick.rs`.
