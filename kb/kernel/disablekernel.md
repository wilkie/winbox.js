---
kind: function
module: KERNEL
name: DisableKernel
ordinal: 125
summary: KERNEL's hold on DOS let go as Windows ends — its DOS vectors and the processor's fault handlers put back, every program's prefix closed, DOS's current prefix KERNEL's own again.
versions:
  '3.1': unrecorded
source: src/win16/kernel/retail.ts
topics: [kernel-internals]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `9c91`-`9d6e` (`KRNL286.EXE` seg1 `943d`). No arguments, nothing answered.
  1. Bit 2 of the byte at 328h, KERNEL ending, is set (`9c99`).
  2. If KERNEL's own `INT 21h` is in (the segment of the vector it keeps at 3Ch of its code is not nought), the routine at seg1 `9bda` takes it out: it clears the byte at 281h, tells the system driver through `InquireSystem`, and puts back the vectors of `INT 21h` and the others KERNEL took (`9c9e`-`9ca8`, `9bda`-`9c28`).
  3. Through DPMI 0203h it gives the processor's exceptions 0Bh, 0Ch, 0Dh, 06h and 0Eh (segment not present, stack, general protection, invalid opcode, page fault) back the handlers it kept from before it took them (`9cb0`-`9d03`).
  4. It walks the chain of program segment prefixes from the word at 222h, each linked through its word at 42h, and for every one but KERNEL's own (220h) calls seg1 `186d`. That makes the prefix DOS's current one, takes its parent (its word at 16h) as the prefix to go back to, and ends it through DOS with function 00h (`186d`-`18b2`). [[inferred]] DOS closes a program's files as it ends it, so each prefix's files are let go (`9d05`-`9d22`).
  5. DOS's current prefix is made KERNEL's own (`INT 21h` 50h), and bit 2 of 328h is cleared (`9d24`-`9d2d`).
  6. It closes every handle of KERNEL's own prefix from 5 up, so the five DOS opened for it stay (`9d33`-`9d48`).
  7. Where 265h of its data holds an address, it keeps the far pointer found there at 269h and writes 0000h:FFFFh in its place (`9d4a`-`9d66`). The routine after [[fn:KERNEL.ReplaceInst]] (seg1 `9af2`-`9b0b`) puts it back.
- Not measured: it ends every program's DOS process, the probe's among them, and Windows with them.

## Callers

- [[read out]] [[fn:KERNEL.ExitKernel]] (seg1 `9dbc`). No file of the installations or the corpus imports it.

## Implementation

**Not applicable (c): only `ExitKernel` reaches it.** It undoes what KERNEL did to a real DOS beneath it; WinBox has none, and nothing to give back. Both engines answer a call as a bare return, AX and DX as they were (`nothing` in `src/win16/kernel/retail.ts`, `retail::nothing`). See [[topic:kernel-internals]].
