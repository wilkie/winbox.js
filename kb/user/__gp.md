---
kind: function
module: USER
name: __GP
ordinal: 484
summary: USER's table of its own fault handlers, which KERNEL reads: data, not a function.
topics: [user-internals]
---

## Observed behaviour

- Not measured.

## Inside Windows

- [[read out]] `USER.EXE` seg1 `b664`: a table of USER's code ranges and the handlers that take a fault in them, which KERNEL's [[fn:KERNEL.HasGPHandler]] reads for a module USER trusts ([[topic:kernel-internals]]). [[fn:USER.Hardware_Event]]'s nought from a program is one of them at work.

## Callers

- No file of the installations or the corpus imports it (`kb/data/user-callers.json`).

## Implementation

A stub in both engines, and **not applicable**: WinBox's USER has no code of Windows' to fault in, and KERNEL's `HasGPHandler` is a stub.
