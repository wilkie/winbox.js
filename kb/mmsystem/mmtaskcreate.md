---
kind: function
module: MMSYSTEM
name: mmTaskCreate
ordinal: 900
summary: Starts MMTASK.TSK to run a procedure as a task of its own.
versions:
  '3.1': stub
source: src/win16/mmsystem.ts
topics: [multimedia-services]
---

## Observed behaviour

- [[read out]] Not yet recorded.

## Inside Windows

- [[read out]] seg4 `5fa`: the module named by MMSYSTEM's string 7D0h, `mmtask.tsk`, started with `LoadModule` (seg4 `68a`), its command tail thirteen bytes -- the procedure, the doubleword, and four noughts -- and shown as 4. Started, the answer is nought and the new task, `LoadModule`'s DX, is written where asked; else 2 for an answer of nought and 1 for another. `MMTASK.TSK` copies the tail, starts as a task, waits for an event, and calls the procedure with the doubleword.
- [[read out]] KERNEL's `LoadModule` leaves the new task in DX (`KRNL386.EXE` seg2 `1d4f`, `[bp-16h]`).

## Implementation

Neither engine has it yet: both engines' `LoadModule` answer only the instance, not the task in DX, and WinBox has no stand-in for `MMTASK.TSK`, which an installation without Windows' files would need.
