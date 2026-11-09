---
kind: function
module: SYSTEM
name: WEP
ordinal: 10
summary: The driver's exit procedure: 1.
versions:
  '3.1': exact
probes: [sysdrv]
records: [misc]
topics: [system-driver]
source: crates/winbox-win16/src/system_driver.rs
---

## Observed behaviour

- [[measured]] [[probe:sysdrv]]: 1.

## Inside Windows

- [[read out]] `SYSTEM.DRV` seg1 `0195`: `MOV AX, 1` and return.

## Implementation

`crates/winbox-win16/src/system_driver.rs`.
