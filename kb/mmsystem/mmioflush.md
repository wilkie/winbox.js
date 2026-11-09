---
kind: function
module: MMSYSTEM
name: mmioFlush
ordinal: 1218
summary: Writes out a file's buffer, and with MMIO_EMPTYBUF empties it.
versions:
  '3.1': exact
probes: [mmio]
source: crates/winbox-win16/src/mmsystem/mmio.rs
topics: [multimedia-files]
---

## Observed behaviour

- [[measured]] Only a dirty buffer is written, `pchBuffer` to `pchEndRead`. A flag but `MMIO_EMPTYBUF` answers 10.
- The rest, with what MMSYSTEM does inside, is [[topic:multimedia-files]].

## Implementation

As read out of `MMSYSTEM.DLL` seg7: `crates/winbox-win16/src/mmsystem/mmio.rs`.
