---
kind: function
module: MMSYSTEM
name: mmioDescend
ordinal: 1223
summary: Finds a RIFF chunk and reads its header.
versions:
  '3.1': exact
probes: [mmio]
source: src/win16/mmsystem/mmio.ts
topics: [multimedia-files]
---

## Observed behaviour

- [[measured]] By its id, or as a `RIFF` or `LIST` of a type, or the next; within a parent, whose end it does not pass.
- [[measured]] Not found answers 109h, the structure holding the last chunk passed.
- The rest, with what MMSYSTEM does inside, is [[topic:multimedia-files]].

## Implementation

As read out of `MMSYSTEM.DLL` seg7, the same in both engines: `src/win16/mmsystem/mmio.ts` and `crates/winbox-win16/src/mmsystem/mmio.rs`.
