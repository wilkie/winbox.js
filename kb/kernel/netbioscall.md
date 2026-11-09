---
kind: function
module: KERNEL
name: NetBiosCall
ordinal: 103
summary: NetBIOS's interrupt, 5Ch, with the registers as the program set them.
versions:
  '3.1': exact
probes: [kmore]
records: [netbios]
source: crates/winbox-win16/src/kernel_calls/more.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `9e19`-`9e1d`: `PUSH DS`, `INT 5Ch`, `POP DS`, `RETF`. The registers go to NetBIOS as the program set them, ES:BX its control block, and come back as NetBIOS leaves them.
- [[measured]] [[probe:kmore]]: with no network, under DOSBox, AX, BX, CX, DX and ES come back as they were given, the carry clear, and the control block (command 7Fh) untouched: the interrupt's vector is DOSBox's bare `IRET`.

## Nuances

- There is no NetBIOS here: WinBox answers as DOSBox's empty vector does, changing nothing but the carry, which it clears.

## Implementation

`src/win16/kernel/more-calls.ts`, and the Rust engine's `crates/winbox-win16/src/kernel_calls/more.rs`.
