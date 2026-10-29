---
kind: function
module: KERNEL
name: ToolHelpHook
ordinal: 341
summary: Exchanges the procedure KERNEL tells of its events — a task started or ended, a module loaded, a fault, a debugger break — and answers the one there before; TOOLHELP's notifications are built on it.
topics: [kernel-internals, tool-helper]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg3 `084c`-`0885` (the same offset in `KRNL286.EXE`). Its argument is a far procedure, four bytes popped.
  1. It sets bits 4 and 7 (90h) of the byte at 328h of KERNEL's data, a hook present (`0857`).
  2. If the procedure is nought, bit 7 is cleared. Bit 4 is cleared too unless [[fn:KERNEL.RegisterPtrace]] has a procedure set (`0866`-`0874`).
  3. It exchanges the procedure with the far pointer at 310h and answers the old one in DX:AX (`0879`-`087d`).
- [[read out]] KERNEL's routine that tells debuggers of an event, seg1 `9a50`, runs in three steps. AX is the event's code; for example 40h is a fault, 50h a segment defined, and 63h a break.
  1. If bit 3 of 328h is set (a system debugger), it makes `INT 41h` with the code.
  2. If bit 7 is set, it calls the procedure at 310h with the running task's prefix made current (`9a70`-`9a92`). A procedure that answers anything but nought ends the telling there.
  3. Otherwise, for codes up to 65h, the procedure [[fn:KERNEL.RegisterPtrace]] set is called (`9aa4`-`9ad8`).
- [[read out]] The [[fn:KERNEL.ToolHelpHook]] procedure is also called, with code 59h and the far pointer at 30Ch in BX and CX, from a routine at seg1 `7e77`-`7eaf`, and from [[fn:KERNEL.CVWBreak]].
- Not yet measured.

## Callers

- [[read out]] `TOOLHELP.DLL` looks it up with `GetProcAddress(GetModuleHandle("KERNEL"), 341)`. Where it is found, TOOLHELP marks that it uses it (TOOLHELP seg1 `00c6`-`00e2`). When the first `NotifyRegister` or `InterruptRegister` needs KERNEL's events, TOOLHELP gives KERNEL its own procedure (TOOLHELP seg1 `1d90`) and keeps the one answered; when none is needed any more it gives that one back (TOOLHELP seg1 `1cff`-`1d18`, `1d56`-`1d6a`). Under Windows 3.0, which has no `ToolHelpHook`, TOOLHELP uses [[fn:KERNEL.RegisterPtrace]] instead, unless `WINDEBUG` is loaded (seg1 `1d1a`-`1d34`).
- No file imports it, and no file holds its name (`kb/data/kernel-callers.json`; the lookup is by ordinal).

## Implementation

A stub in both engines, which pops the four bytes and leaves DX:AX as they were. WinBox's TOOLHELP is its own and raises its notifications from WinBox's own events ([[topic:tool-helper]]).

**Recommendation: not needed.** A program would only call it to stand where TOOLHELP stands, and a program written for Windows 3.1 uses TOOLHELP for that. If one turns up, the call is a hook to keep and call with each event's code. WinBox's TOOLHELP already knows those events, so it would mean calling the program's procedure beside its own: medium work, with the codes still to be recorded. See [[topic:kernel-internals]].
