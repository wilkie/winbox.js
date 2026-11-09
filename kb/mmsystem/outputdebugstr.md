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
source: crates/winbox-win16/src/mmsystem/mod.rs
topics: [multimedia-services]
---

## Observed behaviour

- [[measured]] [[probe:mmmisc]]: it comes back.

## Inside Windows

- [[read out]] seg1 `30a`: `retf 4`, AX as it was.

## Implementation

WinBox does nothing and leaves AX.
