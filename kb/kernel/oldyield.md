---
kind: function
module: KERNEL
name: OldYield
ordinal: 117
summary: The processor given up as KERNEL gives it up itself, with no look at USER's queue; FFFFh.
source: crates/winbox-win16/src/tasks.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `7d3e`-`7d6f`: unless KERNEL's byte at 24Bh is set, the running task is given an event (TDB 6), KERNEL switches tasks (`802e`), the event is taken back as the task comes back, and AX is FFFFh; with the byte set, AX is nought and nothing is switched. [[fn:KERNEL.Yield]] comes here for a task with no message queue (seg1 `7d21`-`7d3c`); `MMTASK.TSK` calls it ([[fn:MMSYSTEM.mmTaskCreate]]).
- Not yet measured.

## Implementation

`src/win16/kernel/WinExec.ts`, and the Rust engine's `tasks.rs` (`old_yield`).
