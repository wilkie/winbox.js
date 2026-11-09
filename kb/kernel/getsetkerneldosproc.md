---
kind: function
module: KERNEL
name: GetSetKernelDOSProc
ordinal: 311
summary: Exchanges the far address KERNEL calls to reach DOS — the INT 21h vector it kept when it hooked DOS — answering the old one; a way to stand between KERNEL and DOS.
versions:
  '3.1': partial
probes: [kgaps]
records: [dosproc, dosprocold]
source: crates/winbox-win16/src/kernel_calls/internals.rs
topics: [kernel-internals]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `9eaf`-`9ecc` (`KRNL286.EXE` seg1 `962b`). Its argument is a far address, four bytes popped. It loads DS with the selector at 5B0h of KERNEL's data, a data selector KERNEL makes for its own code segment while it starts (seg1 `c389`-`c391`). It exchanges the argument with the far pointer at 3Ch of the code segment and answers the old one in DX:AX.
- [[read out]] That far pointer is the `INT 21h` vector KERNEL found before it put in its own. KERNEL reaches DOS through it in 28 places, with `pushf; call far [cs:3Ch]`, for its own DOS calls and for the programs' calls it passes on (seg1 `0aaa`, `187e`, `1d18`, …). [[fn:KERNEL.ReplaceInst]]'s neighbouring routine sets interrupt vectors through it, and [[fn:KERNEL.DisableKernel]] puts `INT 21h` back from it.
- [[measured]] [[probe:kgaps]]: the first answer is neither nought nor an address in KERNEL's code (the DPMI host's, beneath KERNEL); given back, the procedure set is answered.

## Callers

- No file of the installations or the corpus imports it, and none holds its name (`kb/data/kernel-callers.json`). [[inferred]] It is for something that must see KERNEL's DOS calls but that loads after KERNEL has hooked `INT 21h`, a network's or a resident program's driver.

## Implementation

**Implemented (a), the exchange.** Both engines keep the procedure given and answer the one kept (`GetSetKernelDosProc` in `src/win16/kernel/internals.ts`).

## Not yet done

- The first answer (`kgaps:dosprocold`, a known gap): WinBox has nothing beneath its KERNEL and answers nought.
- KERNEL's DOS calls, and a program's it passes on, made through the procedure set: WinBox makes its DOS calls itself and never calls it.
