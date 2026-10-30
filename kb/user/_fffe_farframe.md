---
kind: function
module: USER
name: _FFFE_FARFRAME
ordinal: 341
summary: An entry that begins with INT 3, a debugger's breakpoint, before a small routine: not a function a program calls.
topics: [user-internals]
---

## Observed behaviour

- Not measured: entered, it stops at a breakpoint.

## Inside Windows

- [[read out]] `USER.EXE` seg1 `1798`: `int3`, then a routine that calls through `[18Ch]` with AX the word argument and DX 14h, popping two bytes.

## Callers

- No file of the installations or the corpus imports it (`kb/data/user-callers.json`).

## Implementation

A stub in both engines, and **not applicable**: its first instruction is a breakpoint, which without a debugger is KERNEL's to report.
