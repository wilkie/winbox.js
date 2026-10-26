---
kind: function
module: KERNEL
name: ValidateCodeSegments
ordinal: 100
summary: Nothing, in the retail Windows 3.1: AX and DX are left as they were.
source: src/win16/kernel/retail.ts
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg2 `2ab7`, a bare `RETF`: the debugging version's check of the code segments, which the retail one does not make.
- Not yet measured.

## Implementation

Nothing is done in either engine (`nothing`, `src/win16/kernel/retail.ts`; `kernel_calls/retail.rs`).
