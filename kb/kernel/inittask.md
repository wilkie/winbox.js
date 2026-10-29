---
kind: function
module: KERNEL
name: InitTask
ordinal: 91
summary: A program's first call, from its start-up code. It answers the registers WinMain is made from and fills the reserved words at the start of the data segment. No SDK header declares it, but every program calls it.
source: src/win16/kernel/InitTask.ts
topics: [kernel-internals, task-startup]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg2 `268d` (`KRNL286.EXE` seg2 `2688`). It is called by a program's start-up code before anything else, with its arguments in registers. It answers AX 1, with CX, DX, ES:BX, SI and DI made what `WinMain` is given. [[topic:task-startup]] covers what each register holds and what is written to the data segment's first sixteen bytes.
- [[read out]] The census reads it imported by every program of the installations and of the corpus, 37 of 37 corpus programs, and by many libraries' start-up as well (`kb/data/kernel-callers.json`). [[inferred]] It is the one undeclared export no program can run without; the start-up code the SDK supplies calls it, and so no header needs to declare it.

## Implementation

`src/win16/kernel/InitTask.ts`, and the Rust engine's own. [[topic:task-startup]] describes both. See [[topic:kernel-internals]] for where it stands among KERNEL's undeclared exports.
