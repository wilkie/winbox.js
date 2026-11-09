---
kind: function
module: USER
name: _FFFE_FARFRAME
ordinal: 341
summary: An entry that begins with INT 3, a debugger's breakpoint, then calls the far procedure at 18Ch of DS with AX its word and DX 14h, answering what it answers.
versions:
  '3.1': exact
probes: [ugaps]
records: [farframe]
source: crates/winbox-win16/src/user_internals.rs
topics: [user-internals]
---

## Observed behaviour

- [[measured]] [[probe:ugaps]]: with a far pointer to a procedure of the probe's at 18Ch of its data, the `INT 3` goes on past, the procedure is called once with AX the word and DX 14h, and its DX:AX is the answer, the word popped.

## Inside Windows

- [[read out]] `USER.EXE` seg1 `1798`: `int3`, then a routine that calls through `[18Ch]` with AX the word argument and DX 14h, popping two bytes.

## Callers

- No file of the installations or the corpus imports it (`kb/data/user-callers.json`).

## Implementation

**Implemented (a).** `[18Ch]` is read through the caller's DS, a program's own. WinBox calls the far procedure there with AX and DX as above and answer what it answers; WinBox runs no `INT 3`, which goes on past with no debugger as [[fn:KERNEL.DebugBreak]] does. See [[topic:user-internals]].
