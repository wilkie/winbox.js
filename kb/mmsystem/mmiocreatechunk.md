---
kind: function
module: MMSYSTEM
name: mmioCreateChunk
ordinal: 1225
summary: Writes a RIFF chunk's header where the file is.
versions:
  '3.1': exact
probes: [mmio]
source: src/win16/mmsystem/mmio.ts
topics: [multimedia-files]
---

## Observed behaviour

- [[measured]] `RIFF` or `LIST` and its type, or the id and size given; the data's offset kept and the structure marked dirty.
- The rest, with what MMSYSTEM does inside, is [[topic:multimedia-files]].

## Implementation

As read out of `MMSYSTEM.DLL` seg7, the same in both engines: `src/win16/mmsystem/mmio.ts` and `crates/winbox-win16/src/mmsystem/mmio.rs`.
