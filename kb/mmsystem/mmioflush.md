---
kind: function
module: MMSYSTEM
name: mmioFlush
ordinal: 1218
summary: Writes out a file's buffer, and with MMIO_EMPTYBUF empties it.
versions:
  '3.1': exact
probes: [mmio]
source: src/win16/mmsystem/mmio.ts
topics: [multimedia-files]
---

## Observed behaviour

- [[measured]] Only a dirty buffer is written, `pchBuffer` to `pchEndRead`. A flag but `MMIO_EMPTYBUF` answers 10.
- The rest, with what MMSYSTEM does inside, is [[topic:multimedia-files]].

## Implementation

As read out of `MMSYSTEM.DLL` seg7, the same in both engines: `src/win16/mmsystem/mmio.ts` and `crates/winbox-win16/src/mmsystem/mmio.rs`.
