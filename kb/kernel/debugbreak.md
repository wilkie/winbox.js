---
kind: function
module: KERNEL
name: DebugBreak
ordinal: 203
summary: INT 3; with no debugger the retail Windows goes on past it, the registers as they were.
versions:
  '3.1': exact
probes: [kbreak]
records: [break]
source: crates/winbox-win16/src/kernel_calls/retail.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `946e`-`946f`: `INT 3`, `RETF`.
- [[measured]] [[probe:kbreak]]: with no debugger the probe goes on past it, AX, BX, CX and DX as they were.

## Nuances

- WinBox answers it as a bare return: no breakpoint is taken, and a procedure TOOLHELP's `InterruptRegister` set is not told of one.

## Implementation

`nothing` in `src/win16/kernel/retail.ts`, and the Rust engine's `kernel_calls/retail.rs`.
