---
kind: function
module: SYSTEM
name: KillSystemTimer
ordinal: 3
summary: A timer CreateSystemTimer made, freed: nought, or the handle itself where no timer is there.
versions:
  '3.1': exact
probes: [sysdrv]
records: [timer]
topics: [system-driver]
source: crates/winbox-win16/src/system_driver.rs
---

## Observed behaviour

- [[measured]] [[probe:sysdrv]]: a timer's handle answers nought; the same handle again answers itself, 38h; 1234h answers 1234h; nought answers nought.

## Inside Windows

- [[read out]] `SYSTEM.DRV` seg1 `0381`-`03c4`: the places are walked until one whose offset is the handle and whose rate is not FFFFh, which is freed (FFFFh and three noughts) and answers nought; past the end, the handle as given. A call of its procedure waiting is not made.

## Implementation

`src/win16/system-driver.ts`; the Rust engine's `crates/winbox-win16/src/system_driver.rs`.
