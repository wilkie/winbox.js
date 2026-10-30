---
kind: function
module: USER
name: BozosLiveHere
ordinal: 301
summary: The body of the edit control's window procedure, entered with USER's data segment in AX by USER's own code: not a procedure a program can call.
probes: [userproc]
topics: [user-internals]
---

## Observed behaviour

- [[measured]] [[probe:userproc]]: it is no class's procedure -- not the desktop's, nor `#32769` to `#32772`'s, nor any control's that `GetClassInfo` gives.

## Inside Windows

- [[read out]] `USER.EXE` seg26 `0000`: `jmp short` past nothing, then `push bp`, `mov bp,sp`, `push ds`, `mov ds,ax` -- DS taken from AX, which the caller sets -- and a near call of `0c96` with the window, message, `wParam` and `lParam`. `0c96` finds the edit control's data with `GetWindowWord(hwnd, 0)` (seg2 `0b27`), answers nought where that is -1, and switches on `WM_CREATE`, `WM_ENABLE`, `WM_GETTEXT`, `WM_GETTEXTLENGTH`, `WM_SETFONT`, `WM_GETFONT`, `WM_NCCREATE`, `WM_NCDESTROY`, `WM_COPY` and the `EM_` messages: the edit control's. Segments 27 to 32 call into segment 26's routines.

## Callers

- No file of the installations or the corpus imports it (`kb/data/user-callers.json`).

## Implementation

A stub in both engines, and **not applicable**: entered from a program, DS is whatever AX holds, not USER's data segment, and nothing defined follows. WinBox's edit control is its own (`control-classes.ts`).
