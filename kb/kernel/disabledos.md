---
kind: function
module: KERNEL
name: DisableDos
ordinal: 42
summary: Nothing, in the retail Windows 3.1: AX and DX are left as they were.
source: crates/winbox-win16/src/kernel_calls/retail.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `9c8f`, a bare `RETF`.
- Not yet measured.

## Implementation

Nothing is done (`nothing`, `crates/winbox-win16/src/kernel_calls/retail.rs`).
