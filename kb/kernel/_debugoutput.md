---
kind: function
module: KERNEL
name: _DEBUGOUTPUT
ordinal: 328
summary: Nothing, in the retail Windows 3.1: AX and DX are left as they were.
source: crates/winbox-win16/src/kernel_calls/retail.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `94ce`, a bare `RETF`: the caller pops its arguments.
- Not yet measured.

## Implementation

Nothing is done in either engine (`nothing`, `crates/winbox-win16/src/kernel_calls/retail.rs`).
