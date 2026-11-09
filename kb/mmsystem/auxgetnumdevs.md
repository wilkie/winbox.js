---
kind: function
module: MMSYSTEM
name: auxGetNumDevs
ordinal: 350
summary: How many auxiliary devices there are.
versions:
  '3.1': exact
probes: [mmdevs]
records: [count]
source: crates/winbox-win16/src/mmsystem/wave.rs
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] [[probe:mmdevs]]: 0 on both installations.

## Inside Windows

- [[read out]] seg8 `531`: the count MMSYSTEM keeps as it installs each `aux` driver.

## Implementation

As read out: `crates/winbox-win16/src/mmsystem/auxiliary.rs`.
