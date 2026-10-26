---
kind: function
module: SYSTEM
name: GetSystemMSecCount
ordinal: 6
summary: The milliseconds since Windows started: what USER's GetTickCount is.
versions:
  '3.1': exact
probes: [sysdrv]
records: [msec]
topics: [system-driver, timing]
source: src/win16/system-driver.ts
---

## Observed behaviour

- [[measured]] [[probe:sysdrv]]: taken between two calls of [[fn:USER.GetTickCount]], it lies between them.

## Inside Windows

- [[read out]] USER's `GetTickCount` is a jump to it (`USER.EXE` seg1 `729f`). The driver's INT 8 handler adds 54 milliseconds and 925 thousandths a tick (`SYSTEM.DRV` seg1 `023e`-`0262`), so it steps by whole ticks.

## Implementation

`src/win16/system-driver.ts`; the Rust engine's `crates/winbox-win16/src/system_driver.rs`. `GetTickCount`'s own count.
