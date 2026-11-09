---
kind: function
module: KERNEL
name: LoadModule
ordinal: 45
summary: A program started with a parameter block; its instance in AX, or an error below 32, and the new task in DX.
versions:
  '3.1': exact
probes: [tasks2, loadenv, mmtaskc]
records: [load]
source: crates/winbox-win16/src/tasks.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg2 `1d4f`: DX is the word at BP-16h of its frame, cleared as it begins (`15f3`) and set to the task `1321` made (`1374`, `1b59`, `1c30`): the new task, or nought where none was made. A task made is given one event (`1383`).
- [[read out]] Once the task is made it gives the processor up once, by `Yield` (seg2 `13a8`, seg1 `7d21`), where the flag 10h at `[326h]` is set. [[measured]] [[probe:execpk]]: `WinExec` answers the first time the new program gives the processor up -- by `PeekMessage` with nothing there, or by `Yield` -- not when it waits for a message; one that never gives it up has ended by then ([[topic:several-programs]]).
- [[measured]] [[probe:segfree]]: a program is given its selectors in this order -- its module's database, the task's database, its program segment prefix, a second selector, its message queue, then its segments -- each the one freed last first. Its instance is its data segment's handle, whether or not the program has ended by the time the call answers ([[topic:global-and-local-memory]]).
- [[measured]] [[probe:mmtaskc]]: a program started answers an instance, and DX is a task whose module is the program's; a file that is nowhere answers 2, DX nought. [[probe:tasks2]] and [[probe:loadenv]] record the block's command tail, its showing and its environment.

## Nuances

- `PROGMAN.EXE` and `MMTASK.TSK` found nowhere are WinBox's own, made in memory ([[fn:MMSYSTEM.mmTaskCreate]]).
- The command tail is given byte for byte, its length its first byte, whatever bytes it holds.

## Implementation

`crates/winbox-win16/src/tasks.rs` (`load_module`, `start_named`).
