---
kind: function
module: KERNEL
name: ValidateCodeSegments
ordinal: 100
summary: Nothing, in the retail Windows 3.1: AX and DX are left as they were.
source: crates/winbox-win16/src/kernel_calls/retail.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg2 `2ab7`, a bare `RETF`: the debugging version's check of the code segments, which the retail one does not make.
- Not yet measured.

## Implementation

Nothing is done (`nothing`, `crates/winbox-win16/src/kernel_calls/retail.rs`).
