---
kind: function
module: MMSYSTEM
name: mmioRename
ordinal: 1226
summary: Renames a file through an I/O procedure.
versions:
  '3.1': exact
probes: [mmio]
source: src/win16/mmsystem/mmio.ts
topics: [multimedia-files]
---

## Observed behaviour

- [[measured]] The procedure is found as an open finds it, and sent `MMIOM_RENAME` with the two names. A flag answers 10.
- The rest, with what MMSYSTEM does inside, is [[topic:multimedia-files]].

## Implementation

As read out of `MMSYSTEM.DLL` seg7, the same in both engines: `src/win16/mmsystem/mmio.ts` and `crates/winbox-win16/src/mmsystem/mmio.rs`.
