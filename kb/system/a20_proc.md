---
kind: function
module: SYSTEM
name: A20_Proc
ordinal: 20
summary: Whether the A20 line can be switched: 2, whatever is asked.
versions:
  '3.1': exact
probes: [sysdrv]
records: [misc]
topics: [system-driver]
source: crates/winbox-win16/src/system_driver.rs
---

## Observed behaviour

- [[measured]] [[probe:sysdrv]]: 2 for nought and for 1.

## Inside Windows

- [[read out]] `SYSTEM.DRV` seg1 `018f`: `MOV AX, 2` and return, popping the word.

## Implementation

`src/win16/system-driver.ts`; the Rust engine's `crates/winbox-win16/src/system_driver.rs`.
