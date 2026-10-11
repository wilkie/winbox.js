---
kind: function
module: MMSYSTEM
name: mmioRead
ordinal: 1212
summary: Reads bytes from a file, through its buffer while they fit it.
versions:
  '3.1': exact
probes: [mmio]
source: src/win16/mmsystem/mmio.ts
topics: [multimedia-files]
---

## Observed behaviour

- [[measured]] What the buffer holds first; the buffer filled again while what is left fits it; what does not, read straight. Answers how many, or -1.
- [[measured]] A memory file reads only what its buffer holds.
- The rest, with what MMSYSTEM does inside, is [[topic:multimedia-files]].

## Implementation

As read out of `MMSYSTEM.DLL` seg7, the same in both engines: `src/win16/mmsystem/mmio.ts` and `crates/winbox-win16/src/mmsystem/mmio.rs`.
