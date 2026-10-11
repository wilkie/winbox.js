---
kind: function
module: MMSYSTEM
name: mmioOpen
ordinal: 1210
summary: Opens a file through an I/O procedure, buffered or not, and answers its handle; or parses, looks for, deletes or names a temporary file.
versions:
  '3.1': exact
probes: [mmio]
source: src/win16/mmsystem/mmio.ts
topics: [multimedia-files]
---

## Observed behaviour

- [[measured]] A file not there answers NULL, `wErrorRet` 101h; a flag in the high word but `MMIO_ALLOCBUF` and `MMIO_GETTEMP` answers NULL with `wErrorRet` untouched.
- [[measured]] `MMIO_ALLOCBUF` with no size gives a buffer of 8192 bytes, `GlobalAlloc`ed and locked; a size with no buffer gives one of that size, flag or not.
- [[measured]] `MMIO_PARSE`, `MMIO_EXIST`, `MMIO_DELETE` and `MMIO_GETTEMP` answer TRUE and keep nothing open; the first two give the whole path back in the name's place.
- [[measured]] The I/O procedure is the structure's, or the one installed for its code, or for the extension before a `+` in the name, or the DOS one.
- The rest, with what MMSYSTEM does inside, is [[topic:multimedia-files]].

## Implementation

As read out of `MMSYSTEM.DLL` seg7, the same in both engines: `src/win16/mmsystem/mmio.ts` and `crates/winbox-win16/src/mmsystem/mmio.rs`.
