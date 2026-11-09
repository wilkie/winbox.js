---
kind: function
module: KERNEL
name: DOS3Call
ordinal: 102
summary: A DOS call by a far call instead of INT 21h — the registers go to KERNEL's own INT 21h routine as they are, and come back as it leaves them.
source: crates/winbox-win16/src/kernel_calls/file_cdr.rs
topics: [kernel-internals, dos-handles]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `1d98`-`1d9d` (`KRNL286.EXE` seg1 `1be3`): `pushf; push cs; call 1b34; retf`. It enters KERNEL's own `INT 21h` routine as if by the interrupt, so the call is the same as `INT 21h` made by the program, flags included. [[fn:KERNEL.NoHookDosCall]], ordinal 101, sits just before it at seg1 `1d92`.
- [[read out]] The census reads it imported by 37 files of the installations (File Manager, Program Manager, COMMDLG, SHELL, VER, LZEXPAND and others) and by 14 of the 37 corpus programs (`kb/data/kernel-callers.json`). No SDK header declares it; programs reach it through the SDK's import library and their own assembler.

## Implementation

`src/win16/kernel/Dos3Call.ts`, which passes the registers to WinBox's DOS as they are, and the Rust engine's own. See [[topic:kernel-internals]].
