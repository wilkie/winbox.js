---
kind: function
module: MMSYSTEM
name: mmsystemGetVersion
ordinal: 5
summary: MMSYSTEM's version: 101h.
versions:
  '3.1': exact
probes: [mmmisc]
records: [version]
source: src/win16/mmsystem.ts
topics: [multimedia-services]
---

## Observed behaviour

- [[measured]] [[probe:mmmisc]]: 101h.

## Inside Windows

- [[read out]] seg2 `2b0`: 101h in AX.

## Implementation

Both engines answer 101h.
