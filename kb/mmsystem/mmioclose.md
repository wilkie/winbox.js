---
kind: function
module: MMSYSTEM
name: mmioClose
ordinal: 1211
summary: Writes out a file's buffer, tells its I/O procedure, and frees the file.
versions:
  '3.1': exact
probes: [mmio, mmioext]
source: src/win16/mmsystem/mmio.ts
topics: [multimedia-files]
---

## Observed behaviour

- [[measured]] A handle not open answers 5. `MMIO_FHOPEN` leaves a DOS file handle the program gave open.
- [[read out]] A buffer that cannot be written is marked clean and the file closed all the same; the file is freed only if its procedure answers nought.
- [[measured]] **A file a task leaves open is closed as the task ends**, its buffer written out and its procedure sent `MMIOM_CLOSE`: [[probe:mmioext]].
- The rest, with what MMSYSTEM does inside, is [[topic:multimedia-files]].

## Implementation

As read out of `MMSYSTEM.DLL` seg7, the same in both engines: `src/win16/mmsystem/mmio.ts` and `crates/winbox-win16/src/mmsystem/mmio.rs`.
