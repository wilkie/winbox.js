---
kind: function
module: KERNEL
name: InitTask1
ordinal: 141
summary: Keeps a far procedure that LoadModule calls for each new task of a module with flag 08h; nothing in Windows 3.1 sets one.
topics: [kernel-internals, task-startup]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `8014`-`802b` (`KRNL286.EXE` seg1 `7859`). Its argument is a far pointer. It is written to 25Dh and 25Fh of KERNEL's data, and the four bytes are popped. Nothing is answered.
- [[read out]] `LoadModule` reads it back. Once a new task's database is made, its event count set to one (seg2 `1383`), `LoadModule` calls the procedure if the task's flags, byte 16h of its database, have 08h and the pointer's selector is not nought (seg2 `138e`-`139d`). ES is the new task's database.
- [[read out]] A task gets flag 08h as it is made, when its module's flags, word 0Ch of the module database, have 08h (seg2 `218b`-`219f`). Then its word at 18h gets 8000h too, and the prefix it is given starts from KERNEL's word at 277h rather than 220h (seg2 `21a8`-`21b2`). What the module's flag 08h stands for is not read here.
- Not yet measured.

## Callers

- No file of the installations or the corpus imports it, by ordinal or by name, and none holds its name (`kb/data/kernel-callers.json`). In Windows 3.1 nothing sets the procedure, and `LoadModule`'s call is never made.

## Implementation

A stub in both engines. It pops the same four bytes and leaves AX and DX as they were. Windows leaves them too.

**Recommendation: implement as a no-op (already one in effect).** A program could see only the bytes popped. Keeping the pointer would matter only if WinBox's `LoadModule` called it, and no module ever sets one. Size: none; drop the stub's log line. See [[topic:kernel-internals]].
