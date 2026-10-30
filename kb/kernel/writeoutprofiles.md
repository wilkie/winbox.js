---
kind: function
module: KERNEL
name: WriteOutProfiles
ordinal: 315
summary: Writes back any profile KERNEL holds changed in memory — WIN.INI and the one private profile it keeps — so the files on the disk are current.
topics: [kernel-internals, profile-files]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `708b`-`714f` (`KRNL286.EXE` seg1 `6925`). No arguments. KERNEL holds two profiles in memory, described at 3E4h and 47Eh of its data. [[inferred]] These are `WIN.INI` and the last private profile read. Each record has its buffer (a far pointer at 4), its length (0Ah), a DOS handle (0Ch), flags (0Eh) and the file's path (12h). For each profile whose flags have 02h, written to since it was read, the routine does four things:
  1. It opens the file with [[fn:KERNEL.OpenFile]], trying three ways in turn: to reopen it for reading and writing, denying others writes (8022h); to reopen it for reading and writing (8002h); and to create it (9000h). If none works it gives up on that profile (`70a7`-`70ed`).
  2. It writes the buffer, all but its last three bytes (`70ef`-`7115`). If the whole of that was written, it writes nought bytes after it, which cuts the file to that length (`7117`-`7122`).
  3. It clears flags 02h and 10h, calls seg1 `6b02` with the record, and closes the file (`7125`-`7133`).
  4. Last, it clears the byte at 331h, KERNEL's mark that a profile waits to be written (`7142`).
- [[read out]] KERNEL calls it itself in three places: from the scheduler when 331h is set (seg1 `803a`, `8253`-`8263`); from its `INT 21h` routine, before a program's DOS call, when either profile is marked and KERNEL is not inside the profile code itself (seg1 `1b6d`-`1b8c`); and from [[fn:KERNEL.ExitKernel]]. So a program that reads `WIN.INI` with DOS after writing it with [[fn:KERNEL.WriteProfileString]] finds the change there.
- [[measured]] What the bytes written are is [[topic:profile-files]]'s subject ([[probe:profile]]). This page only adds when they are written.
- [[read out]] With nothing to write, the routine only loads its data segment through AX (`7092`, `mov ax` with KERNEL's data selector), so AX is left KERNEL's data selector and DX as it was.
- [[measured]] [[probe:kintrnl]]: AX the selector of [[fn:KERNEL.GetLPErrMode]]'s pointer, which is KERNEL's data; DX kept; nothing left on the stack.

## Callers

- [[read out]] `USER.EXE` imports it by ordinal. Its `WNetRestoreConnection` (USER seg22 `0478`) writes an entry with [[fn:KERNEL.WriteProfileString]] and then calls this straight away (seg22 `0549`-`054e`). No other file of the installations or the corpus imports it (`kb/data/kernel-callers.json`).

## Implementation

Both engines answer KERNEL's data selector in AX and keep DX (`src/win16/kernel/internals.ts`, `crates/winbox-win16/src/kernel_calls/internals.rs`). WinBox writes a profile to its file on each write ([[topic:profile-files]]), so nothing ever waits, and that path is the one Windows takes too. If WinBox ever defers its writes, this is where they must be done. See [[topic:kernel-internals]].
