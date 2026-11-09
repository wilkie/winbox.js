---
kind: function
module: SYSTEM
name: Restore80x87State
ordinal: 9
summary: The coprocessor's state put back from what Save80x87State wrote.
versions:
  '3.1': exact
probes: [sysdrv]
records: [x87]
topics: [system-driver, floating-point]
source: crates/winbox-win16/src/system_driver.rs
---

## Observed behaviour

- [[measured]] [[probe:sysdrv]]: the state saved above, put back after `FNINIT`, pops π and then 1.

## Inside Windows

- [[read out]] `SYSTEM.DRV` seg1 `0183`: `FWAIT`, `FRSTOR` at the far pointer.

## Implementation

`crates/winbox-win16/src/system_driver.rs`. WIN87EM's own `FRSTOR` of the unit.
