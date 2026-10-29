---
kind: function
module: KERNEL
name: DiagOutput
ordinal: 340
summary: Adds a line to BOOTLOG.TXT while Windows is logging its start (win /b); does nothing otherwise.
topics: [kernel-internals]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `a71d`-`a789` (`KRNL286.EXE` seg1 `96cd`). Its argument is a far pointer to a string ending in nought, four bytes popped. Nothing is answered.
  1. Unless the word at D50h of KERNEL's data is 1, it does nothing (`a729`-`a72e`).
  2. It opens the file named at D5Eh with DOS (`3Dh`, mode 22h: read and write, deny writes to others). It goes to the end, writes the string without its nought, and closes the file (`a730`-`a782`). All these DOS calls go through KERNEL's own `INT 21h` routine (seg1 `1b34`).
  3. If the open or the write fails, the word at D50h is set to nought, and no more lines are written (`a771`).
- [[read out]] KERNEL sets D50h to 1 in a routine of its start (seg1 `a78c`-`a7f5`); [[inferred]] that is when the boot log is asked for. It builds the file's path at D5Eh from `BOOTLOG.TXT`, its string at D52h (seg1 `a79a`). It writes its own lines `LoadStart =`, `LoadSuccess =` and `LoadFail =` the same way (strings at A09h-A25h of its data). [[fn:KERNEL.DiagQuery]] answers whether logging is on ([[topic:kernel-queries]]).
- Not yet measured. The installations' `BOOTLOG.TXT` shows the lines such a start writes.

## Callers

- [[read out]] `USER.EXE` imports it by ordinal. A routine of USER's (seg3 `0250`-`027a`) copies two strings into a buffer of its own with `lstrcpy`, adds a carriage return and line feed (its string at seg3 `0283`), and hands the line to it. No other file of the installations or the corpus imports it (`kb/data/kernel-callers.json`).

## Implementation

A stub in both engines. [[fn:KERNEL.DiagQuery]] answers nought, logging off, as Windows does when it was not started with `/b`.

**Recommendation: implement as a no-op.** With logging off, which `DiagQuery` already answers, Windows does nothing here. A no-op popping four bytes is exact: one line in each engine. See [[topic:kernel-internals]].
