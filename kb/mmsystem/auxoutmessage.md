---
kind: function
module: MMSYSTEM
name: auxOutMessage
ordinal: 354
summary: Sends an auxiliary device's driver any message, by its number: a doubleword.
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

- [[read out]] seg8 `4df`: the number found across the drivers (seg8 `492`); past them 2 with a high word of nought, a place with no driver 6; else the driver's answer.

## Implementation

Both engines, as read out: `src/win16/mmsystem/auxiliary.ts` and `crates/winbox-win16/src/mmsystem/auxiliary.rs`.
