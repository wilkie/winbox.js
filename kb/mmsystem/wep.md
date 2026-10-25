---
kind: function
module: MMSYSTEM
name: WEP
ordinal: 1
summary: MMSYSTEM's exit procedure: 1, and nothing done.
versions:
  '3.1': exact
probes: [mmmisc]
records: [wep]
source: src/win16/mmsystem.ts
topics: [multimedia-services]
---

## Observed behaviour

- [[measured]] [[probe:mmmisc]], asking for it by name: 1.

## Inside Windows

- [[read out]] seg2 `14`: `mov ax,1; retf 2`.

## Implementation

Both engines answer 1.
