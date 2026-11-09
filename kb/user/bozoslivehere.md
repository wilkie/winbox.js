---
kind: function
module: USER
name: BozosLiveHere
ordinal: 301
summary: Two bytes before the edit control's window procedure, which USER's EDIT class names: the procedure itself, entered with DS from AX, as WinBox answers it with its own edit control's.
versions:
  '3.1': exact
probes: [ugaps]
records: [bozo]
source: crates/winbox-win16/src/user_internals.rs
topics: [user-internals]
---

## Observed behaviour

- [[measured]] [[probe:userproc]]: it is no class's procedure -- not the desktop's, nor `#32769` to `#32772`'s, nor any control's that `GetClassInfo` gives.
- [[read out]] USER registers its `EDIT` class with the procedure seg26 `0002`, the export's second byte, past its `jmp short` (seg3 `16d2`-`16e1`): so this is the edit control's procedure, entered with DS from AX as USER sets AX to the window's instance.
- [[measured]] [[probe:ugaps]], with AX the probe's DS on an edit control of its own: `WM_GETTEXTLENGTH` answers 5 as sent, `WM_SETTEXT` 1 and the text set, `WM_GETTEXT` of 4 three characters.

## Inside Windows

- [[read out]] `USER.EXE` seg26 `0000`: `jmp short` past nothing, then `push bp`, `mov bp,sp`, `push ds`, `mov ds,ax` -- DS taken from AX, which the caller sets -- and a near call of `0c96` with the window, message, `wParam` and `lParam`. `0c96` finds the edit control's data with `GetWindowWord(hwnd, 0)` (seg2 `0b27`), answers nought where that is -1, and switches on `WM_CREATE`, `WM_ENABLE`, `WM_GETTEXT`, `WM_GETTEXTLENGTH`, `WM_SETFONT`, `WM_GETFONT`, `WM_NCCREATE`, `WM_NCDESTROY`, `WM_COPY` and the `EM_` messages: the edit control's. Segments 27 to 32 call into segment 26's routines.

## Callers

- No file of the installations or the corpus imports it (`kb/data/user-callers.json`).

## Implementation

**Implemented (a).** WinBox answers it as the `EDIT` class's procedure with the caller's AX (`BozosLiveHere` in `crates/winbox-win16/src/user_internals.rs`). WinBox's edit control is its own and keeps the text itself, so DS does not choose where. See [[topic:user-internals]].
