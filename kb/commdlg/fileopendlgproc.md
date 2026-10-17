---
kind: function
module: COMMDLG
name: FileOpenDlgProc
ordinal: 6
summary: The Open box's procedure, which GetOpenFileName hands to USER's DialogBoxIndirectParam — the program's hook first, even before WM_INITDIALOG, then the box's own setting up, controls, owner-drawn rows and colours.
versions:
  '3.1': partial
probes: [ofnopen]
topics: [common-dialogs, file-dialogs]
source: src/win16/commdlg/file-init.ts
---

## Observed behaviour

No program calls it. [[fn:COMMDLG.GetOpenFileName]] gives its far address to `DialogBoxIndirectParam` with the `OPENFILENAME` as the parameter, and USER calls it as the box's procedure, with the box, a message, `wParam` and `lParam`.

- [[read out]] With the box's property A000h, its block of 40Dh bytes whose first doubleword is the structure, a message goes first to the structure's `lpfnHook` where there is one; an answer not nought is the procedure's answer (`COMMDLG.DLL` seg2 `42a3`).
- [[read out]] Without the property, before `WM_INITDIALOG`, a message goes to the hook `GetOpenFileName` kept in COMMDLG's data (`[004Ah]`) for the purpose, except `WM_INITDIALOG` itself.
- [[read out]] What it handles:

| Message             | What                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WM_INITDIALOG`     | the kept hook cleared; with `[0CACh]` set, so that no wait cursor is shown, the box set up (seg2 `1153`); then the arrow ([[fn:COMMDLG.Ordinal 32]])                            |
| `WM_COMMAND`        | the controls (seg2 `31f4`, as Open)                                                                                                                                             |
| `WM_ACTIVATE`       | on each activation after the first, the drives' list filled again and its drive chosen again, or the current drive and its lists where it is gone (seg2 `2107`); answers nought |
| `WM_SYSCOLORCHANGE` | the colours read again and the pictures made again ([[fn:COMMDLG.Ordinal 42]]); answers 1                                                                                       |
| `WM_MEASUREITEM`    | the owner-drawn lists' rows (seg2 `4dcc`); answers 1                                                                                                                            |
| `WM_DRAWITEM`       | a row of the folders or drives, its picture beside it (seg2 `4e8a`); answers 1                                                                                                  |

- [[read out]] Anything else answers nought.
- [[measured]] [[probe:ofnopen]] records what the hook is sent, before `WM_INITDIALOG` too, and the box after sixteen steps: both engines agree with all its records ([[topic:file-dialogs]]).

## Nuances

- [[read out]] The hook sees what USER sends as it makes the box -- `WM_SETFONT`, `WM_GETFONT`, the lists' `WM_MEASUREITEM` -- because `GetOpenFileName` keeps it in COMMDLG's data. The Color, Find and Replace dialogs keep no such hook, or call it only after the property ([[topic:common-dialogs]]).
- [[read out]] [[fn:COMMDLG.FileSaveDlgProc]] is the same procedure with Save As's caption and Save's checks.

## Inside Windows

[[read out]] `COMMDLG.DLL` seg2 `42a3`, `retf 0Ah`; `GetOpenFileName` takes its address at seg2 `0c2d`.

## Implementation

WinBox's own: `FileOpenDlgProc` in `src/win16/commdlg/file-init.ts` and `file_open_dlg_proc` in `crates/winbox-win16/src/commdlg/file_init.rs`, given to USER at its stub's address. Its block is kept by its window, not under the property A000h ([[topic:file-dialogs]]).

## Not yet done

- The block under the property A000h: a hook that reads the property finds nothing.
