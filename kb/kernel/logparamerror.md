---
kind: function
module: KERNEL
name: LogParamError
ordinal: 325
summary: Tells a debugger of an error, where one is there; otherwise nothing.
source: crates/winbox-win16/src/kernel_calls/retail.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `94f2`, then `9a50`-`9a75`. With a debugger there (bit 3 of the byte at 328h of KERNEL's data), it is told through `INT 41h`. Nothing else happens, and every register is kept.
- Not yet measured.

## Implementation

No debugger is ever there, so nothing is done in either engine.
