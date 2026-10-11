---
kind: function
module: MMSYSTEM
name: mmioAscend
ordinal: 1224
summary: Leaves a RIFF chunk: its pad byte and its size written where it was written to, and the file sought past it.
versions:
  '3.1': exact
probes: [mmio]
source: src/win16/mmsystem/mmio.ts
topics: [multimedia-files]
---

## Observed behaviour

- [[measured]] A chunk marked dirty is made even with a nought, and its size written back where it changed.
- The rest, with what MMSYSTEM does inside, is [[topic:multimedia-files]].

## Implementation

As read out of `MMSYSTEM.DLL` seg7, the same in both engines: `src/win16/mmsystem/mmio.ts` and `crates/winbox-win16/src/mmsystem/mmio.rs`.
