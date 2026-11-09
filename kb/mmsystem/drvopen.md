---
kind: function
module: MMSYSTEM
name: DrvOpen
ordinal: 1100
summary: USER's OpenDriver, under MMSYSTEM's name.
versions:
  '3.1': exact
probes: [mmmisc]
records: [drv]
source: crates/winbox-win16/src/drivers.rs
topics: [installable-drivers]
---

## Observed behaviour

- [[measured]] [[probe:mmmisc]] opens the timer's driver with `DrvOpen`, finds `TIMER.DRV` as its module, asks it `DRV_QUERYCONFIGURE` (nought), asks `DrvDefDriverProc` messages 1 to 11 (1 for `DRV_LOAD`, `DRV_ENABLE`, `DRV_DISABLE`, `DRV_FREE` and `DRV_INSTALL`, else nought) and closes it: 1, then nought.

## Inside Windows

- [[read out]] seg4 `57e`: a jump to [[fn:USER.OpenDriver]]; the arguments are USER's.

## Implementation

WinBox answers it with USER's own `OpenDriver`.
