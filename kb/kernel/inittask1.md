---
kind: function
module: KERNEL
name: InitTask1
ordinal: 141
summary: Keeps a far procedure that LoadModule calls for each new task of a module with flag 08h, leaving its selector in AX; nothing in Windows 3.1 sets one.
topics: [kernel-internals, task-startup]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `8014`-`802b` (`KRNL286.EXE` seg1 `7859`). Its argument is a far pointer. It is written to 25Dh and 25Fh of KERNEL's data, and the four bytes are popped. AX is left the pointer's selector (below).
- [[read out]] `LoadModule` reads it back. Once a new task's database is made, its event count set to one (seg2 `1383`), `LoadModule` calls the procedure if the task's flags, byte 16h of its database, have 08h and the pointer's selector is not nought (seg2 `138e`-`139d`). ES is the new task's database.
- [[read out]] A task gets flag 08h as it is made, when its module's flags, word 0Ch of the module database, have 08h (seg2 `218b`-`219f`). Then its word at 18h gets 8000h too, and the prefix it is given starts from KERNEL's word at 277h rather than 220h (seg2 `21a8`-`21b2`). What the module's flag 08h stands for is not read here.
- [[read out]] It does answer something: AX is left the pointer's selector, the word it loads last (`8023`). DX is kept.
- [[measured]] [[probe:kintrnl]]: AX the selector of the procedure given, and nought for nought; DX kept, four bytes popped. With the procedure set, a second instance of the probe and a program whose header has flag 08h (`KINTRNLC.EXE`, linked `option protmode`) were started, and the procedure was not called for either. So the flag `LoadModule` tests is not the header's 08h as the file has it. What sets it is not read here.

## Callers

- No file of the installations or the corpus imports it, by ordinal or by name, and none holds its name (`kb/data/kernel-callers.json`). In Windows 3.1 nothing sets the procedure, and `LoadModule`'s call is never made.

## Implementation

Both engines answer the pointer's selector in AX and keep DX (`crates/winbox-win16/src/kernel_calls/internals.rs`). No pointer is kept. WinBox's `LoadModule` would call it only for a module of that flag, and none was found. See [[topic:kernel-internals]].
