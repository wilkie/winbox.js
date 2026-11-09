---
kind: function
module: KERNEL
name: CVWBreak
ordinal: 205
summary: The debugger's break key — an interrupt routine the keyboard driver jumps to, which tells a debugger to stop the running program, or raises INT 1 if there is none.
versions:
  '3.1': exact
probes: [kgaps]
records: [cvw]
source: crates/winbox-win16/src/kernel_calls/retail.rs
topics: [kernel-internals, keyboard-driver]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `97e0`-`9834` (`KRNL286.EXE` seg1 `8f96`). It is entered as an interrupt routine, the interrupted flags, CS and IP on the stack, and it ends with `IRET`.
  1. If bit 4 of 328h is clear (no debugger hook, [[fn:KERNEL.RegisterPtrace]] or [[fn:KERNEL.ToolHelpHook]]), it raises `INT 1` itself, the single-step interrupt a debugger answers (`97e8`-`97ed`, `9824`-`9829`).
  2. If KERNEL is in a DOS call (byte 32Ah), it returns at once (`97ef`-`97f4`).
  3. Otherwise it counts down a word at 1Eh of a structure it finds through seg1 `2bbe`. Until the count reaches nought it only sets bit 0 of that structure's word 44h and returns (`97f6`-`9806`).
  4. When the count reaches nought, it calls the [[fn:KERNEL.RegisterPtrace]] procedure with AX 63h, or, where there is none and a `ToolHelpHook` procedure is set, that one (`9808`-`982d`).
- [[read out]] TOOLHELP's procedure answers code 63h by planting a breakpoint: through an alias ([[fn:KERNEL.AllocCStoDSAlias]]) it writes `INT 3` (CCh) over the instruction at the interrupted CS:IP, keeping the byte it replaced, so that the program stops there in a debugger built on TOOLHELP (TOOLHELP seg1 `1dab`-`1de4`).
- [[measured]] [[probe:kgaps]]: called far with the flags as one word and no debugger hook set, it raises `INT 1`, which goes on past, and returns with every register kept and the word popped as the flags.

## Callers

- [[read out]] `KEYBOARD.DRV` jumps to it from its keyboard interrupt when the debugger's break key is pressed and a flag of its own (byte 130h, bit 1) is set (KEYBOARD seg10 `0183`-`019e`). No other file of the installations or the corpus imports it (`kb/data/kernel-callers.json`).

## Implementation

**Not applicable (c), with the answer of a call.** Only `KEYBOARD.DRV`'s debugger key reaches it. A program's far call returns through its `IRET`, which takes one word above the return address as the flags. Both engines answer a bare return popping that word (`nothing`); WinBox calls no hook, as it calls no `RegisterPtrace` procedure. Not done: the popped word loaded into the flags. See [[topic:kernel-internals]].
