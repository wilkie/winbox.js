---
kind: function
module: MMSYSTEM
name: mmTaskCreate
ordinal: 900
summary: A procedure called on a task of its own -- MMTASK.TSK started with it and the double word in its command tail; nought and the task, or 1 or 2.
versions:
  '3.1': exact
probes: [mmtaskc]
records: [create, none]
source: crates/winbox-win16/src/mmsystem/mmtask.rs
topics: [multimedia-services]
---

## Observed behaviour

- [[read out]] `MMSYSTEM.DLL` seg4 `05fa`-`0686`: the module named by MMSYSTEM's string 7D0h, `mmtask.tsk`, is started with `LoadModule` (seg4 `068a`), shown with 4, its command tail thirteen bytes long -- the procedure, the double word and four noughts; `068a` copies the length and the twelve bytes after it and ends the tail with a carriage return (`06d9`-`06f7`). `068a` answers `LoadModule`'s DX, the new task, where the instance is 32 or more (`073b`-`0740`), and the error otherwise. A task answers nought, and is written where `lphTask` points, where it points anywhere; an answer of nought is 2, and any other 1.
- [[read out]] `MMTASK.TSK` seg1 `0000`-`007a`: the twelve bytes are kept in its data at 10h where the tail's length halved is 6, and the length cleared; then `InitTask`, `InitApp`, `SetMessageQueue(40h)` (which failing, it ends), `WaitEvent(0)`; where the procedure has a selector, `OldYield` and the procedure called with the double word, AX and DX its halves; three `OldYield`s; and DOS's function 4Ch.
- [[measured]] [[probe:mmtaskc]]: nought; the procedure runs on the task given, whose module is `MMTASK`, given 12345678h, and the task is gone once it has come back. With no place for the task, nought, and the procedure runs as before.

## Nuances

- Where the drive has no `MMTASK.TSK`, WinBox starts its own `MMTASK`, made in memory: its start-up calls `InitTask` and then a procedure of WinBox's that does what `MMTASK.TSK` does. [[measured]] `mmtask_test.ts` and `tests/mmtask.rs` run [[probe:mmtaskc]] with the file taken off: every record is Windows'.

## Implementation

`src/win16/mmsystem/mmtask.ts` (the image, `mmTaskCreate` and `MMTASK`'s procedure, kept at MMSYSTEM's ordinal 1204, where it exports nothing), and the Rust engine's `crates/winbox-win16/src/mmsystem/mmtask.rs`. Both start it through `startNamed` / `start_named`, `LoadModule`'s own work.
