---
kind: function
module: SYSTEM
name: Get80x87SaveSize
ordinal: 7
summary: How many bytes Save80x87State writes: 94 with a coprocessor, nought without.
versions:
  '3.1': exact
probes: [sysdrv]
records: [x87]
topics: [system-driver, floating-point]
source: crates/winbox-win16/src/system_driver.rs
---

## Observed behaviour

- [[measured]] [[probe:sysdrv]]: 94 on the oracle's machine, which has a coprocessor.

## Inside Windows

- [[read out]] `SYSTEM.DRV` seg1 `016c`: the word the driver set as it started, 5Eh where the BIOS's equipment word (`INT 11h`) has bit 1, nought where it has not (`01fe`-`021e`).

## Implementation

`src/win16/system-driver.ts`; the Rust engine's `crates/winbox-win16/src/system_driver.rs`. 94 where the machine has a coprocessor, as `__WINFLAGS` says.
