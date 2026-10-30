---
kind: function
module: SHELL
name: WCI
ordinal: 32
summary: The subclass procedure of a control of SHELL's About box: its credits, shown on a double click with keys held.
topics: [user-internals]
---

## Observed behaviour

- Not measured.

## Inside Windows

- [[read out]] `SHELL.DLL` seg9 `0829`: `CallWindowProc` of the procedure kept at `[196h]` for `WM_PAINT`, then a `BitBlt` from SHELL's memory context while its state at `[1A4h]` is 3; `WM_NCDESTROY`, `WM_TIMER` and `WM_LBUTTONDBLCLK` (`0841`-`0850`) run the credits the About box shows.

## Callers

- No file of the installations or the corpus imports it (`kb/data/shell-callers.json`).

## Implementation

A stub in both engines, and **not applicable** as long as WinBox's About box ([[fn:SHELL.ShellAbout]]) has controls of its own with no subclass: called from a program, it would call a procedure SHELL never kept. Not yet done: the About box's credits.
