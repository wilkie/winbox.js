---
kind: function
module: MMSYSTEM
name: mmioInstallIOProc
ordinal: 1221
summary: Installs, removes or finds an I/O procedure by its four-character code.
versions:
  '3.1': exact
probes: [mmio, mmioext]
source: src/win16/mmsystem/mmio.ts
topics: [multimedia-files]
---

## Observed behaviour

- [[measured]] `DOS ` and `MEM ` are found, and `MEM ` cannot be removed. A procedure given to remove or find answers NULL.
- [[measured]] A procedure is installed for the task, or with `MMIO_GLOBALPROC` for every task.
- [[measured]] **A task's own procedure goes as the task ends**; a global one it installed is still found by another task afterwards: [[probe:mmioext]].
- The rest, with what MMSYSTEM does inside, is [[topic:multimedia-files]].

## Implementation

As read out of `MMSYSTEM.DLL` seg7, the same in both engines: `src/win16/mmsystem/mmio.ts` and `crates/winbox-win16/src/mmsystem/mmio.rs`.
