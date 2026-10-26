---
kind: function
module: MMSYSTEM
name: DrvDefDriverProc
ordinal: 1104
summary: USER's DefDriverProc, under MMSYSTEM's name.
versions:
  '3.1': exact
probes: [mmmisc]
records: [drv]
source: src/win16/mmsystem.ts
topics: [installable-drivers]
---

## Observed behaviour

- [[measured]] [[probe:mmmisc]] opens the timer's driver with `DrvOpen`, finds `TIMER.DRV` as its module, asks it `DRV_QUERYCONFIGURE` (nought), asks `DrvDefDriverProc` messages 1 to 11 (1 for `DRV_LOAD`, `DRV_ENABLE`, `DRV_DISABLE`, `DRV_FREE` and `DRV_INSTALL`, else nought) and closes it: 1, then nought.

## Inside Windows

- [[read out]] seg4 `592`: a jump to [[fn:USER.DefDriverProc]]; the arguments are USER's.

## Implementation

Both engines answer it with USER's own `DefDriverProc`.
