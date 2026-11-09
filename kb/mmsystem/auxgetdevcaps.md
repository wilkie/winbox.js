---
kind: function
module: MMSYSTEM
name: auxGetDevCaps
ordinal: 351
summary: An auxiliary device's capabilities, asked of its driver by its number.
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

- [[read out]] seg8 `53c`: a size of nought answers nought, a buffer not writable 11, else `AUXDM_GETDEVCAPS` (4) through `auxOutMessage`.

## Implementation

As read out: `crates/winbox-win16/src/mmsystem/auxiliary.rs`.
