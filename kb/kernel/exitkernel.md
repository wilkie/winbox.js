---
kind: function
module: KERNEL
name: ExitKernel
ordinal: 2
summary: The end of a Windows session, which USER's ExitWindows calls last — the drivers turned off, the profiles written, DOS given back, and either a return to DOS or a restart.
versions:
  '3.1': unrecorded
source: crates/winbox-win16/src/kernel_calls/internals.rs
topics: [kernel-internals]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `9d6f`-`9e09` (`KRNL286.EXE` seg1 `951b`). One word on the stack, the code to leave DOS with. It never returns.
  1. It sets bit 2 of the byte at 328h of KERNEL's data, which marks KERNEL as ending (`9d74`).
  2. It calls a routine of its second segment (seg2 `0b7e`), which walks the chain of modules from the word at 21Ch ([[fn:KERNEL.THHOOK]]) and, for each, calls seg2 `149e` with the argument 1. That routine looks up `WEP` in a library made for Windows 3.0 or later (expected version 300h or more, flag 8000h, with code) (seg2 `149e`-`14e6`). [[inferred]] So every library's exit procedure is called as the system ends; the call itself is past `14f6` and was not read.
  3. It calls, where each was found at start-up, the mouse driver's `Disable` (`MOUSE` ordinal 3, kept at 2C8h), the keyboard driver's `Disable` (`KEYBOARD` ordinal 3, kept at 2BCh) and the system driver's `DisableSystemTimers` (`SYSTEM` ordinal 5, kept at 2B0h). KERNEL looks these up by ordinal from its own strings `#3` and `#5` while it starts (seg1 `b69b`-`b86d`).
  4. It calls [[fn:KERNEL.WriteOutProfiles]], so that `WIN.INI` and the private profile it holds are on the disk (`9daf`).
  5. It calls [[fn:KERNEL.DisableKernel]], which gives DOS back its vectors and its handles (`9dbc`).
  6. If the code is 43h, the one `ExitWindows` passes to restart the computer, it asks `INT 2Fh` 1600h whether the enhanced mode's WIN386 is there. If it is, it calls the entry point of the virtual device 9 that `INT 2Fh` 1684h gives, with AX 100h (`9dd5`-`9def`). Otherwise it resets the disks (`INT 21h` 0Dh), makes an `INT 2Fh` FE03h call with SI 4346h and DI 4E55h and the carry set, and starts the machine again with `INT 19h` (`9df3`-`9e03`).
  7. Any other code, or a restart that did not happen, ends with `INT 21h` 4Ch and that code (`9e05`-`9e09`).
- [[inferred]] The FE03h call before `INT 19h` asks a disk cache to write what it holds, so that nothing is lost when the machine restarts. Nothing in KERNEL says which cache answers to it.
- Not measured: under DOSBox it would end the recording.

## Callers

- [[read out]] `USER.EXE`'s `ExitWindows` (seg5 `0303`) calls GDI's `Death` and then this, with its own first argument as the code (seg5 `038e`-`0396`). No other file of the installations or the corpus imports it (`kb/data/kernel-callers.json`).
- KERNEL calls it itself when a fault cannot be handled while it is still starting (seg1 `5e13`).

## Implementation

**Not applicable (c): only Windows' own end reaches it.** Both engines answer a call as WinBox's own end of the session, as its `ExitWindows` ends it: the calling task ended (`ExitKernel` in `src/win16/kernel/internals.ts`, `exit_kernel` in `kernel_calls/internals.rs`). The code to leave DOS with, and the restart for 43h, have no DOS or machine beneath WinBox to go to. See [[topic:kernel-internals]].
