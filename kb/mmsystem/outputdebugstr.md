---
kind: function
module: MMSYSTEM
name: OutputDebugStr
ordinal: 30
summary: In the retail MMSYSTEM, nothing: it returns at once.
versions:
  '3.1': exact
probes: [mmmisc]
records: [debugstr]
source: src/win16/mmsystem.ts
topics: [multimedia-services]
---

## Observed behaviour

- [[measured]] [[probe:mmmisc]]: it comes back.

## Inside Windows

- [[read out]] seg1 `30a`: `retf 4`, AX as it was.

## Implementation

Both engines do nothing and leave AX.
