---
kind: function
module: MMSYSTEM
name: auxSetVolume
ordinal: 353
summary: Sets an auxiliary device's volume: its driver's message, by its number.
versions:
  '3.1': exact
probes: [mmnodev]
records: [id]
source: crates/winbox-win16/src/mmsystem/auxiliary.rs
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] [[probe:mmnodev]]: with no auxiliary device -- neither installation has one -- device 0 and device 5 answer 2 and the mapper's number 6; capabilities with a size of nought answer nought.

## Inside Windows

- [[read out]] seg8 `5bd`: `AUXDM_SETVOLUME` (6).

## Implementation

As read out: `crates/winbox-win16/src/mmsystem/auxiliary.rs`.
