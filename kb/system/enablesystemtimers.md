---
kind: function
module: SYSTEM
name: EnableSystemTimers
ordinal: 4
summary: The timer's interrupt hooked, so the system timers run: USER's as Windows starts.
versions:
  '3.1': unrecorded
topics: [system-driver]
source: crates/winbox-win16/src/system_driver.rs
---

## Inside Windows

- [[read out]] `SYSTEM.DRV` seg1 `02e2`-`030c`: once only (`[5Ch]`), the INT 8 vector is kept and the driver's handler set. USER calls it as Windows starts, so for a program the timers already run. Not recorded: a program has no reason to.

## Implementation

`src/win16/system-driver.ts`; the Rust engine's `crates/winbox-win16/src/system_driver.rs`. The flag only: the timers are looked at while it is set.
