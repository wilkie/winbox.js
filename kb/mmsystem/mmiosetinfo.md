---
kind: function
module: MMSYSTEM
name: mmioSetInfo
ordinal: 1216
summary: Copies a file's MMIOINFO back in, after a program has used its buffer.
versions:
  '3.1': exact
probes: [mmio]
source: src/win16/mmsystem/mmio.ts
topics: [multimedia-files]
---

## Observed behaviour

- [[measured]] The whole structure, and `pchEndRead` moved up to `pchNext`. A flag answers 10.
- The rest, with what MMSYSTEM does inside, is [[topic:multimedia-files]].

## Implementation

As read out of `MMSYSTEM.DLL` seg7, the same in both engines: `src/win16/mmsystem/mmio.ts` and `crates/winbox-win16/src/mmsystem/mmio.rs`.
