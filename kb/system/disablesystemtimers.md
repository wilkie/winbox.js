---
kind: function
module: SYSTEM
name: DisableSystemTimers
ordinal: 5
summary: The timer's interrupt given back: no system timer runs until it is hooked again.
versions:
  '3.1': unrecorded
topics: [system-driver]
source: crates/winbox-win16/src/system_driver.rs
---

## Inside Windows

- [[read out]] `SYSTEM.DRV` seg1 `030d`-`0329`: the INT 8 vector put back. Every system timer stops, Windows' own too -- on Windows the cursor check among them. Not recorded.

## Implementation

`src/win16/system-driver.ts`; the Rust engine's `crates/winbox-win16/src/system_driver.rs`. The flag cleared: no program's timer is called until `EnableSystemTimers`.
