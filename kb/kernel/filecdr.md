---
kind: function
module: KERNEL
name: FileCdr
ordinal: 130
summary: Sets the one procedure KERNEL tells when a file is made, deleted, renamed or changed — File Manager's — or asks which is set.
versions:
  '3.1': exact
probes: [filecdr]
source: src/win16/kernel/FileCdr.ts
---

## Observed behaviour

[[probe:filecdr]] sets a procedure of its own, asks for it back, changes files in every way it can, and clears it. winbox.js runs the probe whole on a copy of the installation's drive, and all 23 of its records agree.

- [[measured]] Given a far pointer, it sets the procedure and answers 1. Given one whose segment is FFFFh, it answers the procedure that is set, the probe's own, or nought when none is. Given nought, it clears it and answers 1.
- [[read out]] Only one procedure is kept for the whole system (`KRNL386.EXE` seg3 `888`). A task may replace or clear its own. While another task's is set, it answers nought and leaves it.
- [[measured]] The procedure is told after each of these succeeds: a create (DOS 3Ch, and 5Bh, create-new), a delete (41h), a rename (56h), a directory made (39h) or taken away (3Ah), and attributes set (4301h). It is told whether the program called DOS itself, through the C runtime, or called KERNEL's `_lcreat` or `OpenFile`.
- [[measured]] It is told nothing by a write, a close, or an open of a file that is there, nor by a delete of a file that is not.
- [[measured]] It is called with two arguments: the DOS function, and the file's whole path, such as `C:\ORACLE\ONE.TXT`. For a rename, the path is the old name.

## Nuances

- [[read out]] The first argument is all of AX as the call left it (seg1 `7f19`): the function in AH, and in AL whatever the caller had there. The C runtime passes the path as a far pointer in DX:AX and swaps the two, so AL is the low byte of the path's selector. That is Windows' own choice, and the probe keeps only AH, and AL for 43h, where it is the subfunction.
- [[read out]] The path is made whole as KERNEL makes it: the drive, the current directory unless the path begins at the root, and then the path as the program gave it. A rename's new name follows the old one's null, copied as given.
- [[read out]] The procedure is called only once DOS has succeeded, and is run by KERNEL's own handler of `int 21h`. So it is called from inside the program that made the change, whichever program that is.
- File Manager sets one as it starts, so that its windows follow what other programs do to the disk.

## Implementation

Win16 takes a task's `int 21h` itself, handling it as it does an API call: the task is halted, DOS is called, the procedure is told, and the task resumes with the registers DOS left. `Dos3Call` goes the same way. DOS's rename, `mkdir`, `rmdir` and attribute calls, which File Manager and the probe need, came with this. Not followed: what KERNEL does with the procedure when the task that set it ends.
