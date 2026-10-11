---
kind: function
module: MMSYSTEM
name: mmioSetBuffer
ordinal: 1217
summary: Gives a file a buffer of the program's, one of MMSYSTEM's, or none.
versions:
  '3.1': exact
probes: [mmio]
source: src/win16/mmsystem/mmio.ts
topics: [multimedia-files]
---

## Observed behaviour

- [[measured]] The old buffer written out and emptied, MMSYSTEM's own freed; MMSYSTEM's own asked again with a size is reallocated where it is, what it holds kept as far as it fits.
- [[measured]] A flag answers 10.
- The rest, with what MMSYSTEM does inside, is [[topic:multimedia-files]].

## Implementation

As read out of `MMSYSTEM.DLL` seg7, the same in both engines: `src/win16/mmsystem/mmio.ts` and `crates/winbox-win16/src/mmsystem/mmio.rs`.
