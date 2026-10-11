---
kind: function
module: MMSYSTEM
name: mmioAdvance
ordinal: 1219
summary: Writes out a file's buffer and fills it again, for a program that reads and writes the buffer itself.
versions:
  '3.1': exact
probes: [mmio]
source: src/win16/mmsystem/mmio.ts
topics: [multimedia-files]
---

## Observed behaviour

- [[measured]] Bytes put in the buffer without `MMIO_DIRTY` set are not written. A file with no buffer answers 10Ah.
- [[measured]] At the end, `pchNext` and `pchEndRead` are both at the buffer's start.
- The rest, with what MMSYSTEM does inside, is [[topic:multimedia-files]].

## Implementation

As read out of `MMSYSTEM.DLL` seg7, the same in both engines: `src/win16/mmsystem/mmio.ts` and `crates/winbox-win16/src/mmsystem/mmio.rs`.
