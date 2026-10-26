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
source: src/win16/mmsystem/auxiliary.ts
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] [[probe:mmdevs]]: 0 on both installations.

## Inside Windows

- [[read out]] seg8 `531`: the count MMSYSTEM keeps as it installs each `aux` driver.

## Implementation

Both engines, as read out: `src/win16/mmsystem/auxiliary.ts` and `crates/winbox-win16/src/mmsystem/auxiliary.rs`.
