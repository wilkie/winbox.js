---
kind: function
module: MMSYSTEM
name: mmioWrite
ordinal: 1213
summary: Writes bytes to a file, into its buffer while they fit it.
versions:
  '3.1': exact
probes: [mmio]
source: src/win16/mmsystem/mmio.ts
topics: [multimedia-files]
---

## Observed behaviour

- [[measured]] Into the buffer, `MMIO_DIRTY` set and `pchEndRead` moved up to `pchNext`; the buffer written out while what is left fits it; what does not, written straight.
- [[measured]] A memory file grows by `adwInfo[0]` or what is wanted; where it cannot, the write answers -1 and writes nothing.
- The rest, with what MMSYSTEM does inside, is [[topic:multimedia-files]].

## Implementation

As read out of `MMSYSTEM.DLL` seg7, the same in both engines: `src/win16/mmsystem/mmio.ts` and `crates/winbox-win16/src/mmsystem/mmio.rs`.
