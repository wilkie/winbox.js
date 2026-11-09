---
kind: function
module: MMSYSTEM
name: mmioSeek
ordinal: 1214
summary: Moves where a file is read or written.
versions:
  '3.1': exact
probes: [mmio]
source: crates/winbox-win16/src/mmsystem/mmio.rs
topics: [multimedia-files]
---

## Observed behaviour

- [[measured]] `SEEK_END` is the end less the offset: -4 from the end of a 74-byte file is 78.
- [[measured]] Inside what the buffer holds only `pchNext` moves; elsewhere the buffer is written out and emptied, and nothing asks the I/O procedure to seek until a read or write.
- [[measured]] An origin but 0, 1 and 2 answers -1, as does a memory file sought past its end.
- The rest, with what MMSYSTEM does inside, is [[topic:multimedia-files]].

## Implementation

As read out of `MMSYSTEM.DLL` seg7: `crates/winbox-win16/src/mmsystem/mmio.rs`.
