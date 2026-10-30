---
kind: function
module: SHELL
name: HERETHARBETYGARS
ordinal: 100
summary: The window procedure of SHELL's windows for a DDE conversation, which ShellExecute starts for an association that asks for DDE.
topics: [user-internals]
---

## Observed behaviour

- Not measured.

## Inside Windows

- [[read out]] `SHELL.DLL` seg4 `0550`: `WM_DESTROY`, `WM_DDE_TERMINATE` and `WM_DDE_ACK`, with the conversation kept as a property of the window (`GetProp`, `SetProp` of the name at `[0A0h]`): an acknowledgement frees the command's block, and its end destroys the window.

## Callers

- No file of the installations or the corpus imports it (`kb/data/shell-callers.json`).

## Implementation

A stub in both engines, and **not applicable** while WinBox's [[fn:SHELL.ShellExecute]] does not follow an association that asks for DDE, the conversations these windows are for.
