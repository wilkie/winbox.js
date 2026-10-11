---
kind: function
module: MMSYSTEM
name: mmioGetInfo
ordinal: 1215
summary: Copies a file's MMIOINFO out, its buffer pointers among it.
versions:
  '3.1': exact
probes: [mmio]
source: src/win16/mmsystem/mmio.ts
topics: [multimedia-files]
---

## Observed behaviour

- [[measured]] The whole structure, 42h bytes. A flag answers 10, a handle not open 5.
- The rest, with what MMSYSTEM does inside, is [[topic:multimedia-files]].

## Implementation

As read out of `MMSYSTEM.DLL` seg7, the same in both engines: `src/win16/mmsystem/mmio.ts` and `crates/winbox-win16/src/mmsystem/mmio.rs`.
